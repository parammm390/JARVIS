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
 * point of view. Strip the param and configure ssl explicitly instead — except
 * `sslmode=disable` is read as an explicit override before stripping (the standard
 * Postgres convention for "this endpoint genuinely doesn't speak TLS, don't ask it to").
 *
 * `.railway.internal` hosts (Phase 6 staging: a session-mode PgBouncer sitting between
 * the app and Postgres) are Railway's own private network — already an isolated,
 * non-public transport, same trust level as localhost — and the plain Postgres image
 * behind it doesn't terminate TLS, so requesting SSL there fails outright ("the server
 * does not support SSL connections") rather than just being redundant. The same
 * PgBouncer, reached via Railway's *public* TCP proxy for Task 6.4's Vercel-side load
 * test, has the identical no-TLS limitation but crosses the public internet — the
 * hostname heuristic alone can't tell that case apart safely (a real public Postgres
 * host should still get SSL), so that caller passes `sslmode=disable` explicitly rather
 * than this function guessing from the domain.
 */
export function pgConnectionConfig(url: string): pg.ClientConfig {
  const sslDisabled = /[?&]sslmode=disable\b/.test(url);
  const cleaned = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const skipSsl = sslDisabled || cleaned.includes("localhost") || cleaned.includes("127.0.0.1") || cleaned.includes(".railway.internal");
  return {
    connectionString: cleaned,
    ...(skipSsl ? {} : { ssl: { rejectUnauthorized: false } }),
  };
}

/**
 * "Skip SSL" and "safe to hold many connections per invocation" are NOT the same
 * question, and treating them as one was a real bug found running the Task 6.4 load
 * test at scale, 2026-07-20. `localhost`/`127.0.0.1` is the only genuinely unshared,
 * unpooled target (local dev, CI's own ephemeral single-tenant container) — every
 * other target in this system, including `.railway.internal` (the worker's private
 * PgBouncer) and the public PgBouncer proxy (`sslmode=disable`, Task 6.4), is a shared
 * pooled resource, exactly like Supabase's Supavisor pooler already was. A generous
 * per-invocation `max` against a shared pool multiplies with every concurrent
 * serverless invocation — under real load this starved PgBouncer's own pool far faster
 * than raising PgBouncer's pool size alone could fix.
 */
function isUnpooledLocal(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

let pool: pg.Pool | null = null;
let poolConnectionString: string | null = null;

export function getPool(): pg.Pool {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Managed-secret boot can replace DATABASE_URL after an import-time helper has
  // already touched the pool. Never keep the pre-secret connection alive: it may be
  // a migration/owner URL rather than the restricted application role. New callers
  // get a pool for the current environment while the old pool drains safely.
  if (pool && poolConnectionString !== url) {
    const stalePool = pool;
    pool = null;
    poolConnectionString = null;
    void stalePool.end().catch(() => undefined);
  }
  if (!pool) {
    // Cloud (Vercel + Supabase store): POSTGRES_URL_NON_POOLING is a direct session-mode
    // connection — required because we set search_path per session, which a transaction-
    // mode pooler would reset between clients. We run our own small pg.Pool regardless.
    const cfg = pgConnectionConfig(url);
    // Every session-mode pooler this app talks to (Supabase Supavisor, and now
    // PgBouncer whether private or public) caps total concurrent backend connections
    // low relative to how many serverless invocations can run at once. A generous
    // per-invocation max against a shared pool multiplies with concurrency and starves
    // it fast — only a genuinely unshared localhost/127.0.0.1 target gets to be
    // generous. See isUnpooledLocal()'s own comment for the real bug this fixed.
    const unpooledLocal = isUnpooledLocal(url);
    // The REAL root cause found running Task 6.4's load test at scale, 2026-07-20 --
    // not pool size, a missing timeout. Neither `connectionTimeoutMillis` nor a
    // statement_timeout was ever set, so node-postgres's default is "wait forever" for
    // both "get a client from the pool" and "how long can one query run." Under real
    // overload this doesn't degrade gracefully — it queues WITHOUT BOUND: a client
    // that's already given up (k6's own 60s HTTP timeout) doesn't stop the server-side
    // handler from still running and still holding its spot in a pooled connection's
    // queue, so the backlog only grows, never drains, confirmed directly against
    // PgBouncer's own admin console (`SHOW POOLS`) staying pinned at cl_active=sv_
    // active=pool_size with a 100+ second maxwait, unchanged 20+ seconds after the
    // load generator had already stopped sending new requests. avg_query_time was a
    // healthy 87ms the whole time — the database was never actually the bottleneck.
    // Fail fast under saturation instead: a real, bounded error the app already
    // handles gracefully (degraded/SAMPLE DATA badges) beats an unbounded queue that
    // makes every other request wait behind requests nobody is listening for anymore.
    pool = new pg.Pool({
      ...cfg,
      // Vercel can run enough API instances concurrently that even two sessions per
      // instance exhaust Supavisor's 40-session production pool (observed as
      // EMAXCONNSESSION under Bridge polling). Production functions therefore use
      // one short-lived session each; localhost/CI remains intentionally generous.
      max: unpooledLocal ? 10 : 1,
      idleTimeoutMillis: unpooledLocal ? undefined : 1_000,
      // CI and local test runners must fail with a real connection error when their
      // disposable database is unavailable. Leaving localhost unbounded made Vitest
      // stall before collection forever after a stopped dev database.
      connectionTimeoutMillis: 5_000,
    });
    // Do not issue client.query() from the pool's connect event: node-postgres does
    // not await it, so a first caller can race that setup query. Restricted runtime
    // roles receive their default search_path when provisioned; tenant paths set their
    // own search_path and timeout synchronously inside the transaction below.
    // node-postgres's own docs: an idle client's background 'error' event (e.g. the
    // pooler or network dropping a connection that's just sitting in the pool, not
    // mid-query) has no other listener and crashes the ENTIRE process if unhandled --
    // found running this for real (a real staging chaos test crashed outright on
    // exactly this, `Connection terminated unexpectedly`, an idle-pool background
    // error, not a query failure). More likely now that pooled connections carry a
    // real idleTimeoutMillis instead of living forever. Every in-flight query already
    // gets its own real error from its own call site (withTenant's try/catch etc.) --
    // this handler exists solely so a background idle-connection drop degrades
    // (that one connection gets recycled) instead of taking the whole process down.
    pool.on("error", (err) => {
      console.error("[db] idle pooled connection error (non-fatal, connection recycled):", err.message);
    });
    poolConnectionString = url;
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
  userId?: string,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    await client.query("SET LOCAL statement_timeout = 10000");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    // D6.T1: only user-scoped tables opt into this second RLS dimension. It stays
    // transaction-local alongside tenant_id, so it cannot leak through a pooled
    // connection into a later request.
    if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const context = await client.query<{ tenant_id: string | null }>("SELECT current_setting('app.tenant_id', true) AS tenant_id");
    if (context.rows[0]?.tenant_id !== tenantId) {
      throw new Error("Tenant RLS context was not established on the query connection");
    }
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
    poolConnectionString = null;
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
  lane: "interactive" | "batch" = "batch",
  priority = 0,
): Promise<void> {
  const fullPayload = correlationId ? { ...payload, _correlationId: correlationId } : payload;
  await getPool().query(
    `INSERT INTO jobs (type, payload, idempotency_key, lane, priority) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [type, JSON.stringify(fullPayload), idempotencyKey ?? null, lane, priority],
  );
}
