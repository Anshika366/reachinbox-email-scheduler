import { Router, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { query } from "../db/index.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { scheduleEmailSchema } from "../validators/emailValidator.js";
import { addEmailToQueue } from "../queues/emailQueue.js";
import { indexEmailDocument, searchEmailsInEs } from "../services/elasticsearchService.js";
import { EmailRecord, Sender } from "../types/index.js";
import { config } from "../config/index.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth);

router.post("/schedule", async (req: Request, res: Response, next) => {
  try {
    const parseResult = scheduleEmailSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
      return;
    }

  const {
    senderId,
    recipients,
    subject,
    body,
    scheduledAt,
    minDelayMs = config.minDelayMs,
    hourlyLimit = config.maxEmailsPerHourPerSender,
    idempotencyKey
  } = parseResult.data;

  const userId = req.user!.id;

  if (idempotencyKey) {
    const existingRecord = await query(
      "SELECT response_payload FROM idempotency_records WHERE key = $1",
      [idempotencyKey]
    );

    if (existingRecord.rows.length > 0) {
      res.json(JSON.parse(existingRecord.rows[0].response_payload));
      return;
    }
  }

  const senderRes = await query<Sender>(
    "SELECT * FROM senders WHERE id = $1 AND user_id = $2",
    [senderId, userId]
  );

  if (senderRes.rows.length === 0) {
    res.status(403).json({ error: "Sender not found or not owned by user" });
    return;
  }

  const sender = senderRes.rows[0];
  const scheduledTimeMs = new Date(scheduledAt).getTime();
  const createdEmailIds: string[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i].trim();
    const emailId = crypto.randomUUID();
    const recipientScheduledTimeMs = scheduledTimeMs + i * minDelayMs;
    const recipientScheduledAt = new Date(recipientScheduledTimeMs);

    const emailRes = await query<EmailRecord>(
      `INSERT INTO emails (
        id, user_id, sender_id, sender_email, recipient, subject, body,
        scheduled_at, status, min_delay_ms, hourly_limit, idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $11, NOW(), NOW())
      RETURNING *`,
      [
        emailId,
        userId,
        sender.id,
        sender.email,
        recipient,
        subject,
        body,
        recipientScheduledAt,
        minDelayMs,
        hourlyLimit,
        idempotencyKey ? `${idempotencyKey}-${i}` : null
      ]
    );

    const emailRecord = emailRes.rows[0];

    try {
      const queueTimeout = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Queue timeout")), 1500)
      );
      const jobId = await Promise.race([
        addEmailToQueue(
          {
            emailId,
            userId,
            senderId: sender.id,
            senderEmail: sender.email,
            recipient,
            subject,
            body,
            scheduledAt: recipientScheduledAt.toISOString(),
            minDelayMs,
            hourlyLimit,
            idempotencyKey: emailRecord.idempotency_key || undefined
          },
          recipientScheduledTimeMs
        ),
        queueTimeout
      ]);

      await query("UPDATE emails SET bullmq_job_id = $1 WHERE id = $2", [jobId, emailId]);
    } catch (qErr: any) {
      console.warn("Queue notice (database dispatcher will handle delivery):", qErr?.message);
    }

    await indexEmailDocument(emailRecord);
    createdEmailIds.push(emailId);
  }

  const responsePayload = {
    success: true,
    count: createdEmailIds.length,
    emailIds: createdEmailIds
  };

  if (idempotencyKey) {
    await query(
      "INSERT INTO idempotency_records (key, response_payload, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING",
      [idempotencyKey, JSON.stringify(responsePayload)]
    );
  }

    res.status(201).json(responsePayload);
  } catch (err) {
    next(err);
  }
});

router.get("/scheduled", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string || "1", 10);
  const limit = parseInt(req.query.limit as string || "50", 10);
  const offset = (page - 1) * limit;

  const listRes = await query<EmailRecord>(
    `SELECT * FROM emails 
     WHERE user_id = $1 AND status IN ('scheduled', 'processing')
     ORDER BY scheduled_at ASC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countRes = await query(
    "SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('scheduled', 'processing')",
    [userId]
  );

  res.json({
    emails: listRes.rows,
    total: parseInt(countRes.rows[0].count, 10),
    page,
    limit
  });
});

router.get("/sent", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string || "1", 10);
  const limit = parseInt(req.query.limit as string || "50", 10);
  const offset = (page - 1) * limit;

  const listRes = await query<EmailRecord>(
    `SELECT * FROM emails 
     WHERE user_id = $1 AND status IN ('sent', 'failed')
     ORDER BY COALESCE(sent_at, updated_at) DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countRes = await query(
    "SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('sent', 'failed')",
    [userId]
  );

  res.json({
    emails: listRes.rows,
    total: parseInt(countRes.rows[0].count, 10),
    page,
    limit
  });
});

router.get("/counts", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const scheduledCountRes = await query(
    "SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('scheduled', 'processing')",
    [userId]
  );

  const sentCountRes = await query(
    "SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('sent', 'failed')",
    [userId]
  );

  res.json({
    scheduled: parseInt(scheduledCountRes.rows[0].count, 10),
    sent: parseInt(sentCountRes.rows[0].count, 10)
  });
});

router.get("/search", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const q = (req.query.q as string || "").trim();
  const status = req.query.status as string;

  const esResult = await searchEmailsInEs(userId, q, status);

  if (esResult.total > 0) {
    res.json({ emails: esResult.hits, total: esResult.total, source: "elasticsearch" });
    return;
  }

  let sql = "SELECT * FROM emails WHERE user_id = $1";
  const params: any[] = [userId];

  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }

  if (q) {
    params.push(`%${q}%`);
    const qIndex = params.length;
    sql += ` AND (recipient ILIKE $${qIndex} OR subject ILIKE $${qIndex} OR body ILIKE $${qIndex} OR sender_email ILIKE $${qIndex})`;
  }

  sql += " ORDER BY created_at DESC LIMIT 50";
  const dbRes = await query<EmailRecord>(sql, params);

  res.json({
    emails: dbRes.rows,
    total: dbRes.rows.length,
    source: "database"
  });
});

router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const emailRes = await query<EmailRecord>(
    "SELECT * FROM emails WHERE id = $1 AND user_id = $2",
    [id, userId]
  );

  if (emailRes.rows.length === 0) {
    res.status(404).json({ error: "Email not found" });
    return;
  }

  res.json({ email: emailRes.rows[0] });
});

router.post("/upload-csv", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const fileContent = req.file.buffer.toString("utf8");
    const records = parse(fileContent, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    }) as string[][];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validEmails = new Set<string>();
    const invalidEntries: string[] = [];

    for (const row of records) {
      for (const cell of row) {
        const val = cell.trim();
        if (!val) continue;

        if (emailRegex.test(val)) {
          validEmails.add(val.toLowerCase());
        } else if (val.toLowerCase() !== "email" && val.toLowerCase() !== "recipient") {
          invalidEntries.push(val);
        }
      }
    }

    res.json({
      validRecipients: Array.from(validEmails),
      invalidEntries,
      totalValid: validEmails.size,
      totalInvalid: invalidEntries.length
    });
  } catch (err: any) {
    res.status(400).json({ error: "Failed to parse CSV file", details: err.message });
  }
});

export default router;
