import { Redis } from "ioredis";
import { config } from "../config/index.js";

const isTls = config.redisUrl.startsWith("rediss://");

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  connectTimeout: 2000,
  tls: isTls ? { rejectUnauthorized: false } : undefined,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  }
});

redis.on("error", () => {
  // Gracefully silence reconnection noise when running in cloud environments without local Redis
});

export const bullmqConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: isTls ? { rejectUnauthorized: false } : undefined,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  }
});

bullmqConnection.on("error", () => {
  // Gracefully silence reconnection noise when running in cloud environments without local Redis
});

export function getHourlyWindowKey(timestamp: number = Date.now()): {
  windowKey: string;
  msRemaining: number;
  hourStartDate: Date;
} {
  const hourMs = 3600000;
  const currentHourBucket = Math.floor(timestamp / hourMs);
  const nextHourTimestamp = (currentHourBucket + 1) * hourMs;
  const msRemaining = Math.max(1000, nextHourTimestamp - timestamp);
  const hourStartDate = new Date(currentHourBucket * hourMs);
  return {
    windowKey: currentHourBucket.toString(),
    msRemaining,
    hourStartDate
  };
}

import { pool } from "../db/index.js";

/**
 * In-memory pacing slot tracker.
 * NOTE: This fallback provides safe pacing within a single Node.js instance.
 * It does NOT claim globally coordinated pacing across multiple horizontally scaled instances.
 * If running in a multi-instance deployment without Redis, sending is paused (safe fail-closed).
 */
const inMemorySenderSlots = new Map<string, number>();

function acquireSenderSendSlotMemoryFallback(senderId: string, minDelayMs: number): number {
  // If explicitly configured for multi-instance deployment without Redis, pause sending (fail-closed)
  // to prevent uncoordinated concurrent sends across independent container processes
  const isMultiInstance =
    process.env.MULTI_INSTANCE === "true" ||
    (Boolean(process.env.INSTANCE_COUNT) && parseInt(process.env.INSTANCE_COUNT || "1", 10) > 1);

  if (isMultiInstance) {
    console.warn(
      `[Pacing] Multi-instance deployment detected without Redis. Pausing sender ${senderId} to prevent uncoordinated concurrent sending.`
    );
    return 30000; // Pause 30s until Redis recovers
  }

  const now = Date.now();
  const safeMinDelay = Math.max(minDelayMs || 2000, 500);
  const lastSlot = inMemorySenderSlots.get(senderId) || 0;

  let nextSlot = now + safeMinDelay;
  if (lastSlot + safeMinDelay > nextSlot) {
    nextSlot = lastSlot + safeMinDelay;
  }

  // Add jitter to avoid thundering herd across concurrent worker ticks
  const jitterMs = Math.floor(Math.random() * 150) + 25;
  const assignedSlot = nextSlot + jitterMs;
  inMemorySenderSlots.set(senderId, assignedSlot);

  // Guarantee waitTime is never 0ms when Redis is unavailable and single-instance workers are spaced out
  const waitTime = Math.max(safeMinDelay, assignedSlot - now);
  return waitTime;
}

/**
 * Atomic PostgreSQL Hourly Rate Limit Fallback.
 * QUOTA MODEL: Fixed UTC calendar-hour bucket (e.g. 10:00:00 to 10:59:59 UTC).
 * Resets automatically at the top of each UTC hour.
 *
 * Atomicity: Uses row-level lock on 'senders' (SELECT ... FOR UPDATE) to serialize
 * concurrent requests for the sender, and stores atomic increments in idempotency_records.
 */
export async function checkAndIncrementHourlyRateLimitDbFallback(
  senderId: string,
  limit: number,
  msRemaining: number
): Promise<{ allowed: boolean; currentCount: number; retryAfterMs: number }> {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Atomic row-level lock on the sender identity serializes concurrent rate limit checks for this sender
    const senderLock = await client.query(
      "SELECT id FROM senders WHERE id = $1 FOR UPDATE",
      [senderId]
    );

    if (senderLock.rows.length === 0) {
      await client.query("ROLLBACK");
      return { allowed: false, currentCount: limit, retryAfterMs: msRemaining };
    }

    const { windowKey, hourStartDate } = getHourlyWindowKey();
    const rateLimitKey = `ratelimit:sender:${senderId}:${windowKey}`;

    // Lock and retrieve or initialize the hourly counter in idempotency_records
    const counterRes = await client.query<{ response_payload: string }>(
      "SELECT response_payload FROM idempotency_records WHERE key = $1 FOR UPDATE",
      [rateLimitKey]
    );

    let currentCount = 0;
    if (counterRes.rows.length > 0) {
      currentCount = parseInt(counterRes.rows[0].response_payload, 10) || 0;
    } else {
      // Seed counter: count emails sent within the current UTC hour using sent_at,
      // and emails currently claimed into processing using processing-start timestamp (updated_at).
      // This strictly prevents counting unrelated updates to older emails.
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM emails
         WHERE sender_id = $1
           AND (
             (status = 'sent' AND sent_at >= $2)
             OR
             (status = 'processing' AND updated_at >= $2)
           )`,
        [senderId, hourStartDate]
      );
      currentCount = parseInt(countRes.rows[0]?.count || "0", 10);
    }

    if (currentCount >= limit) {
      await client.query("COMMIT");
      return {
        allowed: false,
        currentCount,
        retryAfterMs: Math.max(1000, msRemaining)
      };
    }

    const newCount = currentCount + 1;
    await client.query(
      `INSERT INTO idempotency_records (key, response_payload, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
       SET response_payload = EXCLUDED.response_payload, created_at = NOW()`,
      [rateLimitKey, newCount.toString()]
    );

    await client.query("COMMIT");
    return {
      allowed: true,
      currentCount: newCount,
      retryAfterMs: 0
    };
  } catch (err: any) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    // Strict fail-closed: If both Redis and Database fallback encounter an error, do NOT allow unrestricted sends
    return {
      allowed: false,
      currentCount: limit,
      retryAfterMs: Math.max(1000, msRemaining)
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function checkAndIncrementHourlyRateLimit(
  senderId: string,
  limit: number
): Promise<{ allowed: boolean; currentCount: number; retryAfterMs: number }> {
  const { windowKey, msRemaining } = getHourlyWindowKey();

  if (redis.status !== "ready") {
    return checkAndIncrementHourlyRateLimitDbFallback(senderId, limit, msRemaining);
  }

  try {
    const redisKey = `ratelimit:sender:${senderId}:${windowKey}`;

    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      local limit = tonumber(ARGV[1])
      local ttl = tonumber(ARGV[2])

      if current and tonumber(current) >= limit then
        return {0, tonumber(current)}
      end

      local newCount = redis.call('INCR', KEYS[1])
      if newCount == 1 then
        redis.call('PEXPIRE', KEYS[1], ttl)
      end

      return {1, newCount}
    `;

    const evalPromise = redis.eval(
      luaScript,
      1,
      redisKey,
      limit.toString(),
      msRemaining.toString()
    ) as Promise<[number, number]>;

    const timeoutPromise = new Promise<[number, number]>((_, reject) =>
      setTimeout(() => reject(new Error("Redis rate limit timeout")), 1000)
    );

    const result = await Promise.race([evalPromise, timeoutPromise]);
    const allowed = result[0] === 1;
    const currentCount = result[1];

    return {
      allowed,
      currentCount,
      retryAfterMs: allowed ? 0 : msRemaining
    };
  } catch {
    return checkAndIncrementHourlyRateLimitDbFallback(senderId, limit, msRemaining);
  }
}

export async function acquireSenderSendSlot(
  senderId: string,
  minDelayMs: number
): Promise<number> {
  if (redis.status !== "ready") {
    return acquireSenderSendSlotMemoryFallback(senderId, minDelayMs);
  }

  try {
    const key = `pacing:sender:${senderId}`;
    const now = Date.now();

    const luaScript = `
      local lastSlot = redis.call('GET', KEYS[1])
      local now = tonumber(ARGV[1])
      local minDelay = tonumber(ARGV[2])

      local nextSlot = now
      if lastSlot then
        local lastSlotNum = tonumber(lastSlot)
        if (lastSlotNum + minDelay) > now then
          nextSlot = lastSlotNum + minDelay
        end
      end

      local waitTime = nextSlot - now
      local ttl = math.max(minDelay * 2, waitTime + minDelay * 2)
      redis.call('SET', KEYS[1], nextSlot, 'PX', ttl)
      return waitTime
    `;

    const evalPromise = redis.eval(
      luaScript,
      1,
      key,
      now.toString(),
      minDelayMs.toString()
    ) as Promise<number>;

    const timeoutPromise = new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error("Redis pacing timeout")), 1000)
    );

    const waitTime = await Promise.race([evalPromise, timeoutPromise]);
    return waitTime;
  } catch {
    return acquireSenderSendSlotMemoryFallback(senderId, minDelayMs);
  }
}

export async function checkRedisConnection(): Promise<boolean> {
  if (redis.status !== "ready") {
    return false;
  }
  try {
    const res = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 1000)
      )
    ]);
    return res === "PONG";
  } catch {
    return false;
  }
}
