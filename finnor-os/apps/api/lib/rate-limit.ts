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
