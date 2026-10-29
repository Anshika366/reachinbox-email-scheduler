import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query } from "../db/index.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSenderSchema } from "../validators/emailValidator.js";
import { Sender } from "../types/index.js";
import { config } from "../config/index.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const result = await query<Sender>(
    "SELECT * FROM senders WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  );
  res.json({ senders: result.rows });
});

router.post("/", async (req: Request, res: Response) => {
  const parseResult = createSenderSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
    return;
  }

  const { name, email, hourlyLimit = config.maxEmailsPerHourPerSender } = parseResult.data;
  const userId = req.user!.id;
  const senderId = crypto.randomUUID();

  try {
    const result = await query<Sender>(
      `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [senderId, userId, email, name, hourlyLimit]
    );

    res.status(201).json({ sender: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Sender email already exists for this user" });
      return;
    }
    res.status(500).json({ error: "Failed to create sender" });
  }
});

export default router;
