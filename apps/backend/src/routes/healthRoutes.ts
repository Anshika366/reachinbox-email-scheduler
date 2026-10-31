import { Router, Request, Response } from "express";
import { checkDbConnection } from "../db/index.js";
import { checkRedisConnection } from "../services/redisService.js";
import { checkElasticsearchConnection } from "../services/elasticsearchService.js";

import nodemailer from "nodemailer";

const router = Router();

router.get("/test-ethereal", async (_req: Request, res: Response) => {
  try {
    const { sendEmailViaSmtp } = await import("../services/emailService.js");
    const testResult = await sendEmailViaSmtp({
      from: "diagnostic@example.com",
      to: "recipient@example.com",
      subject: `Ethereal Verification ${Date.now()}`,
      html: "<p>Ethereal live preview verification test</p>"
    });
    res.json({
      success: true,
      messageId: testResult.messageId,
      previewUrl: testResult.previewUrl,
      isExactPreviewUrl: !!(testResult.previewUrl && testResult.previewUrl.includes("/message/"))
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
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
