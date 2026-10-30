import { Router, Request, Response } from "express";
import { checkDbConnection } from "../db/index.js";
import { checkRedisConnection } from "../services/redisService.js";
import { checkElasticsearchConnection } from "../services/elasticsearchService.js";

import nodemailer from "nodemailer";

const router = Router();

router.get("/test-ethereal", async (_req: Request, res: Response) => {
  const ports = [2525, 587, 25];
  const results: any[] = [];
  for (const port of ports) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      const mailer = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000
      });
      const info = await mailer.sendMail({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: `Test Port ${port}`,
        text: "hi"
      });
      const previewUrl = nodemailer.getTestMessageUrl(info);
      results.push({ port, success: true, messageId: info.messageId, previewUrl });
      res.json({ success: true, workingPort: port, previewUrl, results });
      return;
    } catch (e: any) {
      results.push({ port, error: e.message });
    }
  }
  res.status(500).json({ success: false, results });
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
