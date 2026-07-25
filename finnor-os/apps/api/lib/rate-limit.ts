// Fixed-window rate limiting against api_rate_limits (packages/db/migrations/
// 0006_security_controls.sql) — a real composite PK (bucket_key, window_started_at)
// makes the increment atomic under concurrent requests, not just app-level counting.

import { getPool } from "@finnor/db";
import Redis from "ioredis";

const DEFAULT_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
type RedisCounter = { incr(key: string): Promise<number>; pexpire(key: string, ms: number): Promise<unknown> };
let redis: RedisCounter | null | undefined;
let redisOverride: RedisCounter | null | undefined;
const memoryCounts = new Map<string, { count: number; expiresAt: number }>();

/** Test seam + explicit resilience behavior: Redis is preferred whenever REDIS_URL is
 * configured. A connection/command failure falls back to process-local counting and
 * emits an alerting console error; an outage therefore narrows distributed accuracy,
 * never availability. */
export function setRateLimitRedisForTesting(value: RedisCounter | null | undefined): void { redisOverride = value; redis = undefined; }

function redisClient(): RedisCounter | null {
  if (redisOverride !== undefined) return redisOverride;
  if (redis !== undefined) return redis;
  if (!process.env.REDIS_URL) return (redis = null);
  const client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 1_000 });
  client.on("error", () => undefined); // failure is handled at the call boundary below
  return (redis = client);
}

function memoryCheck(key: string, limit: number): boolean {
  const now = Date.now();
  const existing = memoryCounts.get(key);
  const row = !existing || existing.expiresAt <= now ? { count: 0, expiresAt: now + WINDOW_MS } : existing;
  row.count += 1; memoryCounts.set(key, row);
  return row.count <= limit;
}

export async function checkRateLimit(bucketKey: string, limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_LIMIT_PER_MINUTE)): Promise<boolean> {
  const windowStartedAt = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
  const key = `rate:${bucketKey}:${windowStartedAt.toISOString()}`;
  const client = redisClient();
  if (client) {
    try {
      const count = await client.incr(key);
      if (count === 1) await client.pexpire(key, WINDOW_MS);
      return count <= limit;
    } catch (error) {
      console.error("[rate-limit] Redis unavailable; using in-memory fallback", error instanceof Error ? error.message : error);
      return memoryCheck(key, limit);
    }
  }
  try {
    const { rows } = await getPool().query(
      `INSERT INTO finnor_os.api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key, window_started_at) DO UPDATE SET count = finnor_os.api_rate_limits.count + 1
       RETURNING count`, [bucketKey, windowStartedAt],
    );
    return (rows[0]?.count ?? 0) <= limit;
  } catch (error) {
    console.error("[rate-limit] durable fallback unavailable; using in-memory fallback", error instanceof Error ? error.message : error);
    return memoryCheck(key, limit);
  }
}

/** A4.T5: how long until the CURRENT fixed window rolls over — the honest Retry-After
 *  value for a 429 (this window is fixed-size, not sliding, so "wait until it resets"
 *  is exactly this many seconds, never an estimate). Pure arithmetic, no DB round trip. */
export function secondsUntilWindowReset(): number {
  const elapsedInWindow = Date.now() % WINDOW_MS;
  return Math.ceil((WINDOW_MS - elapsedInWindow) / 1000);
}
