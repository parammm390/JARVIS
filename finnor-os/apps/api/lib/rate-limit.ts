// Fixed-window rate limiting against api_rate_limits (packages/db/migrations/
// 0006_security_controls.sql) — a real composite PK (bucket_key, window_started_at)
// makes the increment atomic under concurrent requests, not just app-level counting.

import { getPool } from "@finnor/db";

const DEFAULT_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

export async function checkRateLimit(bucketKey: string, limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_LIMIT_PER_MINUTE)): Promise<boolean> {
  const windowStartedAt = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);
  const { rows } = await getPool().query(
    `INSERT INTO api_rate_limits (bucket_key, window_started_at, count) VALUES ($1, $2, 1)
     ON CONFLICT (bucket_key, window_started_at) DO UPDATE SET count = api_rate_limits.count + 1
     RETURNING count`,
    [bucketKey, windowStartedAt],
  );
  return (rows[0]?.count ?? 0) <= limit;
}

/** A4.T5: how long until the CURRENT fixed window rolls over — the honest Retry-After
 *  value for a 429 (this window is fixed-size, not sliding, so "wait until it resets"
 *  is exactly this many seconds, never an estimate). Pure arithmetic, no DB round trip. */
export function secondsUntilWindowReset(): number {
  const elapsedInWindow = Date.now() % WINDOW_MS;
  return Math.ceil((WINDOW_MS - elapsedInWindow) / 1000);
}
