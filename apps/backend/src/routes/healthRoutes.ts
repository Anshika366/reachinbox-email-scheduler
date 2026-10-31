import { Router, Request, Response } from "express";
import { checkDbConnection } from "../db/index.js";
import { checkRedisConnection } from "../services/redisService.js";
import { checkElasticsearchConnection } from "../services/elasticsearchService.js";

import nodemailer from "nodemailer";

const router = Router();

router.get("/test-ethereal", async (_req: Request, res: Response) => {
  const net = await import("net");
  try {
    const socket = net.connect(587, "smtp.ethereal.email", () => {
      socket.once("data", (data) => {
        res.json({ port587: "CONNECTED!", banner: data.toString().trim() });
        socket.end();
      });
    });
    socket.on("error", (err) => {
      res.json({ port587: "ERROR", message: err.message });
    });
    socket.on("timeout", () => {
      res.json({ port587: "TIMEOUT" });
      socket.destroy();
    });
    socket.setTimeout(6000);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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
