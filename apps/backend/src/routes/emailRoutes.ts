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

// Public email preview endpoint (Accessible on any device/laptop without login)
router.get("/preview/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await query<EmailRecord>("SELECT * FROM emails WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Email Not Found</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb;">
            <div style="text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="color: #111827; margin-bottom: 0.5rem;">Email Not Found</h2>
              <p style="color: #6b7280; margin-bottom: 1.5rem;">The email ID does not exist or has been removed.</p>
              <a href="${config.clientUrl}" style="background: #00A86B; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 14px;">Open ReachInbox</a>
            </div>
          </body>
        </html>
      `);
      return;
    }

    const email = result.rows[0];

    if (req.query.format === "json" || req.headers.accept?.includes("application/json")) {
      res.json(email);
      return;
    }

    const sentDate = new Date(email.sent_at || email.scheduled_at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    });

    const isDelivered = email.status === "sent";

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${email.subject} - ReachInbox Preview</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background-color: #F8F9FA;
              color: #1F2937;
              padding: 24px 16px;
              min-height: 100vh;
            }
            .container {
              max-width: 760px;
              margin: 0 auto;
              background: #FFFFFF;
              border: 1px solid #E5E7EB;
              border-radius: 12px;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
              overflow: hidden;
            }
            .banner {
              background: #0B0F19;
              color: #FFFFFF;
              padding: 14px 24px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: 13px;
            }
            .brand {
              display: flex;
              align-items: center;
              gap: 8px;
              font-weight: 600;
              letter-spacing: -0.2px;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 4px 10px;
              border-radius: 9999px;
              font-size: 11px;
              font-weight: 600;
              background: ${isDelivered ? "#059669" : "#D97706"};
              color: #FFFFFF;
            }
            .header {
              padding: 24px 28px;
              border-bottom: 1px solid #F3F4F6;
            }
            .subject {
              font-size: 20px;
              font-weight: 700;
              color: #111827;
              margin-bottom: 16px;
              line-height: 1.3;
            }
            .meta-grid {
              display: flex;
              flex-direction: column;
              gap: 6px;
              font-size: 13px;
              color: #4B5563;
            }
            .meta-row {
              display: flex;
              align-items: center;
            }
            .meta-label {
              width: 60px;
              font-weight: 600;
              color: #9CA3AF;
              font-size: 12px;
              text-transform: uppercase;
            }
            .meta-value {
              color: #1F2937;
              font-weight: 500;
            }
            .body {
              padding: 28px;
              min-height: 240px;
              font-size: 15px;
              line-height: 1.6;
              color: #1F2937;
              background: #FFFFFF;
            }
            .footer {
              background: #F9FAFB;
              border-top: 1px solid #E5E7EB;
              padding: 16px 28px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: 12px;
              color: #6B7280;
            }
            .open-app-btn {
              background: #00A86B;
              color: #FFFFFF;
              padding: 8px 16px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              font-size: 12px;
              transition: background 0.15s ease;
            }
            .open-app-btn:hover {
              background: #008f5b;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="banner">
              <div class="brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A86B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z"/>
                  <path d="M22 2 11 13"/>
                </svg>
                <span>ReachInbox Email Preview</span>
              </div>
              <div class="badge">
                <span>&#10003;</span>
                <span>${email.status.toUpperCase()}</span>
              </div>
            </div>

            <div class="header">
              <h1 class="subject">${email.subject || "(No Subject)"}</h1>
              <div class="meta-grid">
                <div class="meta-row">
                  <span class="meta-label">From:</span>
                  <span class="meta-value">${email.sender_email}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">To:</span>
                  <span class="meta-value">${email.recipient}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">Date:</span>
                  <span class="meta-value">${sentDate}</span>
                </div>
              </div>
            </div>

            <div class="body">
              ${email.body}
            </div>

            <div class="footer">
              <span>Message ID: ${email.smtp_message_id || email.id}</span>
              <a href="${config.clientUrl}" class="open-app-btn">Open ReachInbox App &rarr;</a>
            </div>
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    res.status(500).send("Error loading preview: " + (err?.message || err));
  }
});

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
