// Database client factory. Two access modes:
//  - tenantDb(tenantId): sets the RLS GUC `app.tenant_id` per transaction — every query
//    in application code paths that touch tenant data goes through this. No service-role bypass.
//  - adminDb(): migrations/seed/queue only (jobs table is not tenant data; payloads carry tenant_id).

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = NodePgDatabase<typeof schema>;

/**
 * node-postgres quirk: an `sslmode=` query param in the connection string overrides
 * an explicit `ssl` config object, and Supabase's chain is self-signed from Node's
 * point of view. Strip the param and configure ssl explicitly instead.
 */
export function pgConnectionConfig(url: string): pg.ClientConfig {
  const cleaned = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const isLocal = cleaned.includes("localhost") || cleaned.includes("127.0.0.1");
  return {
    connectionString: cleaned,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  };
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    // Cloud (Vercel + Supabase store): POSTGRES_URL_NON_POOLING is a direct session-mode
    // connection — required because we set search_path per session, which a transaction-
    // mode pooler would reset between clients. We run our own small pg.Pool regardless.
    const url =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const cfg = pgConnectionConfig(url);
    // Session-mode poolers (Supabase Supavisor) cap total concurrent clients low
    // (15 on the default tier). Every serverless invocation opens its own pg.Pool, so
    // a small per-invocation max plus a short idle timeout is what keeps that shared
    // budget from being exhausted under real concurrent traffic — 5 was too generous.
    pool = new pg.Pool({ ...cfg, max: cfg.ssl ? 2 : 10, idleTimeoutMillis: cfg.ssl ? 8_000 : undefined });
    // All Finnor tables live in the finnor_os schema; raw SQL in the app is unqualified.
    // Setting the path per connection keeps the shared role's defaults untouched.
    pool.on("connect", (client) => {
      client.query("SET search_path = finnor_os, public").catch(() => undefined);
    });
  }
  return pool;
}

export function adminDb(): Db {
  return drizzle(getPool(), { schema });
}

/**
 * Run `fn` inside a transaction with the tenant RLS context set.
 * RLS policies (migrations/0000_init.sql) scope every tenant table to
 * current_setting('app.tenant_id') — set with set_config(..., true) so it is
 * transaction-local and cannot leak across pooled connections.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Idempotent job enqueue — safe to call twice with the same key (§16). `correlationId`
 *  (Phase 16e) rides inside payload as `_correlationId` rather than a new column — the
 *  worker reads it back off `job.payload` at dispatch time (see apps/worker/src/queue.ts),
 *  so no migration is needed and every existing caller that omits it is unaffected. */
export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
  correlationId?: string,
): Promise<void> {
  const fullPayload = correlationId ? { ...payload, _correlationId: correlationId } : payload;
  await getPool().query(
    `INSERT INTO jobs (type, payload, idempotency_key) VALUES ($1, $2, $3)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [type, JSON.stringify(fullPayload), idempotencyKey ?? null],
  );
}
