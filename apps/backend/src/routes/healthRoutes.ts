import { Router, Request, Response } from "express";
import { checkDbConnection } from "../db/index.js";
import { checkRedisConnection } from "../services/redisService.js";
import { checkElasticsearchConnection } from "../services/elasticsearchService.js";

import nodemailer from "nodemailer";

const router = Router();

router.get("/test-ethereal", async (_req: Request, res: Response) => {
  try {
    const testAccount = await nodemailer.createTestAccount();
    const mailer = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
    const info = await mailer.sendMail({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test Ethereal on Render",
      text: "Hello from Render",
      html: "<p>Hello from Render</p>"
    });
    const previewUrl = nodemailer.getTestMessageUrl(info);
    res.json({ success: true, messageId: info.messageId, previewUrl });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err), stack: err?.stack });
  }
});

router.get("/", async (_req: Request, res: Response) => {
  const [dbOk, redisOk, esOk] = await Promise.all([
    checkDbConnection(),
    checkRedisConnection(),
    checkElasticsearchConnection()
  ]);

  const healthy = dbOk;

  const payload = {
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
      elasticsearch: esOk ? "connected" : "disconnected"
    }
  };

  res.status(healthy ? 200 : 503).json(payload);
});

export default router;
