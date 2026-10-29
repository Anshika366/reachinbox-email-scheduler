import { Redis } from "ioredis";
import { config } from "../config/index.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  }
});

export function getHourlyWindowKey(timestamp: number = Date.now()): {
  windowKey: string;
  msRemaining: number;
} {
  const hourMs = 3600000;
  const currentHourBucket = Math.floor(timestamp / hourMs);
  const nextHourTimestamp = (currentHourBucket + 1) * hourMs;
  const msRemaining = Math.max(1000, nextHourTimestamp - timestamp);
  return {
    windowKey: currentHourBucket.toString(),
    msRemaining
  };
}

export async function checkAndIncrementHourlyRateLimit(
  senderId: string,
  limit: number
): Promise<{ allowed: boolean; currentCount: number; retryAfterMs: number }> {
  const { windowKey, msRemaining } = getHourlyWindowKey();
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

  const result = (await redis.eval(
    luaScript,
    1,
    redisKey,
    limit.toString(),
    msRemaining.toString()
  )) as [number, number];

  const allowed = result[0] === 1;
  const currentCount = result[1];

  return {
    allowed,
    currentCount,
    retryAfterMs: allowed ? 0 : msRemaining
  };
}

export async function acquireSenderSendSlot(
  senderId: string,
  minDelayMs: number
): Promise<number> {
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

  const waitTime = (await redis.eval(
    luaScript,
    1,
    key,
    now.toString(),
    minDelayMs.toString()
  )) as number;

  return waitTime;
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const res = await redis.ping();
    return res === "PONG";
  } catch {
    return false;
  }
}
