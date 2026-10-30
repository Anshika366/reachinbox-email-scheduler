import { Router, Request, Response } from "express";
import { checkDbConnection } from "../db/index.js";
import { checkRedisConnection } from "../services/redisService.js";
import { checkElasticsearchConnection } from "../services/elasticsearchService.js";

const router = Router();

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
