// Database client factory. Two access modes:
//  - tenantDb(tenantId): sets the RLS GUC `app.tenant_id` per transaction — every query
//    in application code paths that touch tenant data goes through this. No service-role bypass.
//  - adminDb(): migrations/seed/queue only (jobs table is not tenant data; payloads carry tenant_id).

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

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
    const idleTimeoutOverride = Number(process.env.FINNOR_DB_IDLE_TIMEOUT_MS);
    const idleTimeoutMillis = Number.isFinite(idleTimeoutOverride) && idleTimeoutOverride > 0
      ? Math.min(idleTimeoutOverride, 60_000)
      : unpooledLocal
        ? undefined
        : 1_000;
    pool = new pg.Pool({
      ...cfg,
      // Vercel can run enough API instances concurrently that even two sessions per
      // instance exhaust Supavisor's 40-session production pool (observed as
      // EMAXCONNSESSION under Bridge polling). Production functions therefore use
      // one short-lived session each; localhost/CI remains intentionally generous.
      max: unpooledLocal ? 10 : 1,
      idleTimeoutMillis,
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

// ---------------------------------------------------------------------------
// Upgrade 6: additive durable business-operation primitives. Approval code uses the
// in-transaction authorizer below so an approved cohort and its first worker job can
// never be separated by a process crash.
// ---------------------------------------------------------------------------

export interface FrozenBusinessOperationTarget {
  targetId: string;
  frozenSnapshot: Record<string, unknown>;
  preparedPayload: Record<string, unknown>;
}

export interface CreateBusinessOperationParams {
  tenantId: string;
  workId?: string | null;
  domainActionId: string;
  operationType: "customer_winback";
  configuration: Record<string, unknown>;
  cohortDefinition: Record<string, unknown>;
  targets: FrozenBusinessOperationTarget[];
  summary: string;
  policyApplied: { id: string; version: number } | null;
  correlationId?: string | null;
}

async function appendBusinessOperationEventTx(
  db: Db,
  params: { tenantId: string; operationId: string; targetId?: string | null; eventType: string; payload?: Record<string, unknown> },
): Promise<void> {
  await db.execute(sql`SELECT id FROM ${schema.businessOperations} WHERE ${schema.businessOperations.id} = ${params.operationId} FOR UPDATE`);
  const [latest] = await db
    .select({ maxSequence: sql<number>`coalesce(max(${schema.businessOperationEvents.sequence}), 0)::int` })
    .from(schema.businessOperationEvents)
    .where(eq(schema.businessOperationEvents.operationId, params.operationId));
  await db.insert(schema.businessOperationEvents).values({
    tenantId: params.tenantId,
    operationId: params.operationId,
    targetId: params.targetId ?? null,
    sequence: (latest?.maxSequence ?? 0) + 1,
    eventType: params.eventType,
    payload: params.payload ?? {},
  });
}

/** Freeze the exact proposal cohort once. Re-drafting an already-pending action is
 * idempotent and can never replace its approved targets with a freshly queried set. */
export async function createBusinessOperation(params: CreateBusinessOperationParams): Promise<{ id: string; created: boolean; status: string }> {
  return withTenant(params.tenantId, async (db) => {
    const [action] = await db.select({ id: schema.domainActions.id, workId: schema.domainActions.workId })
      .from(schema.domainActions)
      .where(and(eq(schema.domainActions.id, params.domainActionId), eq(schema.domainActions.tenantId, params.tenantId)))
      .limit(1);
    if (!action) throw new Error("Cannot prepare a durable operation for an unknown action");
    if ((params.workId ?? null) !== (action.workId ?? null)) throw new Error("Durable operation Work does not match its action");

    const [existing] = await db.select().from(schema.businessOperations)
      .where(and(eq(schema.businessOperations.tenantId, params.tenantId), eq(schema.businessOperations.domainActionId, params.domainActionId)))
      .limit(1);
    if (existing) {
      const rows = await db.select({ targetId: schema.businessOperationTargets.targetId })
        .from(schema.businessOperationTargets)
        .where(eq(schema.businessOperationTargets.operationId, existing.id))
        .orderBy(asc(schema.businessOperationTargets.ordinal));
      const frozen = rows.map((row) => row.targetId);
      const proposed = params.targets.map((target) => target.targetId);
      if (canonicalJson(frozen) !== canonicalJson(proposed)) {
        throw new Error("Durable operation cohort is already frozen and cannot be replaced");
      }
      return { id: existing.id, created: false, status: existing.status };
    }

    const [operation] = await db.insert(schema.businessOperations).values({
      tenantId: params.tenantId,
      workId: params.workId ?? null,
      domainActionId: params.domainActionId,
      operationType: params.operationType,
      status: "awaiting_approval",
      configuration: params.configuration,
      cohortDefinition: params.cohortDefinition,
      targetCount: params.targets.length,
      pendingCount: params.targets.length,
    }).returning();
    if (!operation) throw new Error("Failed to create durable business operation");

    if (params.targets.length > 0) {
      await db.insert(schema.businessOperationTargets).values(params.targets.map((target, ordinal) => ({
        tenantId: params.tenantId,
        operationId: operation.id,
        targetId: target.targetId,
        ordinal,
        frozenSnapshot: target.frozenSnapshot,
        preparedPayload: target.preparedPayload,
        idempotencyKey: `${operation.id}:target:${target.targetId}`,
      })));
    }
    await appendBusinessOperationEventTx(db, {
      tenantId: params.tenantId,
      operationId: operation.id,
      eventType: "cohort_frozen",
      payload: { targetCount: params.targets.length, domainActionId: params.domainActionId },
    });
    await db.insert(schema.decisionReceipts).values({
      tenantId: params.tenantId,
      workId: params.workId ?? null,
      domainActionId: params.domainActionId,
      operationId: operation.id,
      objective: params.summary,
      evidence: params.targets.map((target) => ({ source: "households", ref: target.targetId, timestamp: operation.cohortFrozenAt.toISOString() })),
      policyApplied: params.policyApplied,
      riskTier: "high",
      proposedAction: {
        operationId: operation.id,
        operationType: params.operationType,
        configuration: params.configuration,
        cohortDefinition: params.cohortDefinition,
        frozenTargetIds: params.targets.map((target) => target.targetId),
      },
      approval: { required: true },
      expectedResult: { targetCount: params.targets.length, perTargetState: true, durableWorkerExecution: true },
      correlationId: params.correlationId ?? null,
    });
    return { id: operation.id, created: true, status: operation.status };
  });
}

export interface AuthorizedBusinessOperation {
  id: string;
  status: string;
  authorized: boolean;
}

/** Must be called inside the same transaction that writes the immutable approval
 * episode. It moves the operation to queued and inserts the first dispatcher job as
 * one atomic commit. */
export async function authorizeBusinessOperationTx(
  db: Db,
  params: { tenantId: string; domainActionId: string; approvedBy: string; correlationId?: string | null },
): Promise<AuthorizedBusinessOperation | null> {
  const [operation] = await db.select().from(schema.businessOperations)
    .where(and(eq(schema.businessOperations.tenantId, params.tenantId), eq(schema.businessOperations.domainActionId, params.domainActionId)))
    .limit(1);
  if (!operation) return null;
  if (operation.status !== "awaiting_approval") return { id: operation.id, status: operation.status, authorized: false };
  const now = new Date();
  const [queued] = await db.update(schema.businessOperations).set({
    status: "queued",
    approvedBy: params.approvedBy,
    approvedAt: now,
    updatedAt: now,
  }).where(and(eq(schema.businessOperations.id, operation.id), eq(schema.businessOperations.status, "awaiting_approval"))).returning();
  if (!queued) {
    const [raced] = await db.select().from(schema.businessOperations).where(eq(schema.businessOperations.id, operation.id)).limit(1);
    return raced ? { id: raced.id, status: raced.status, authorized: false } : null;
  }
  await db.update(schema.decisionReceipts).set({ approval: { required: true, approvedBy: params.approvedBy, at: now.toISOString() } })
    .where(and(eq(schema.decisionReceipts.tenantId, params.tenantId), eq(schema.decisionReceipts.operationId, operation.id)));
  await appendBusinessOperationEventTx(db, {
    tenantId: params.tenantId,
    operationId: operation.id,
    eventType: "execution_authorized",
    payload: { approvedBy: params.approvedBy, domainActionId: params.domainActionId },
  });
  await db.insert(schema.jobs).values({
    type: "dispatch_business_operation",
    payload: {
      tenantId: params.tenantId,
      operationId: operation.id,
      actionId: params.domainActionId,
      ...(params.correlationId ? { _correlationId: params.correlationId } : {}),
    },
    idempotencyKey: `business-operation:${operation.id}:dispatch:authorized`,
    lane: "batch",
    priority: 10,
  }).onConflictDoNothing({ target: schema.jobs.idempotencyKey });
  return { id: queued.id, status: queued.status, authorized: true };
}

export async function businessOperationAggregate(tenantId: string, operationId: string): Promise<Record<string, unknown> | null> {
  return withTenant(tenantId, async (db) => {
    const [operation] = await db.select().from(schema.businessOperations)
      .where(and(eq(schema.businessOperations.tenantId, tenantId), eq(schema.businessOperations.id, operationId))).limit(1);
    if (!operation) return null;
    const targets = await db.select().from(schema.businessOperationTargets)
      .where(and(eq(schema.businessOperationTargets.tenantId, tenantId), eq(schema.businessOperationTargets.operationId, operationId)))
      .orderBy(asc(schema.businessOperationTargets.ordinal));
    const events = await db.select().from(schema.businessOperationEvents)
      .where(and(eq(schema.businessOperationEvents.tenantId, tenantId), eq(schema.businessOperationEvents.operationId, operationId)))
      .orderBy(asc(schema.businessOperationEvents.sequence));
    const [receipt] = await db.select().from(schema.decisionReceipts)
      .where(and(eq(schema.decisionReceipts.tenantId, tenantId), eq(schema.decisionReceipts.operationId, operationId))).limit(1);
    return { operation, targets, events, receipt: receipt ?? null };
  });
}

export async function retryBusinessOperation(params: {
  tenantId: string;
  operationId: string;
  requestedBy: string;
  recoveryKey: string;
}): Promise<{ retried: number; duplicate: boolean; workId: string | null; actionType: string }> {
  if (!params.recoveryKey.trim() || params.recoveryKey.length > 200) throw new Error("recoveryKey must be non-empty and at most 200 characters");
  return withTenant(params.tenantId, async (db) => {
    const [operation] = await db.select().from(schema.businessOperations).where(and(
      eq(schema.businessOperations.tenantId, params.tenantId),
      eq(schema.businessOperations.id, params.operationId),
    )).limit(1);
    if (!operation) throw new Error("Business operation not found");
    const [action] = await db.select({ actionType: schema.domainActions.actionType }).from(schema.domainActions).where(and(
      eq(schema.domainActions.tenantId, params.tenantId),
      eq(schema.domainActions.id, operation.domainActionId),
    )).limit(1);
    if (!action) throw new Error("Business operation action not found");
    const jobKey = `business-operation:${operation.id}:manual-retry:${params.recoveryKey}`;
    const [existingJob] = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.idempotencyKey, jobKey)).limit(1);
    if (existingJob) return { retried: 0, duplicate: true, workId: operation.workId, actionType: action.actionType };
    if (!["needs_human_review", "completed_with_failures", "failed"].includes(operation.status)) {
      throw new Error(`Business operation is ${operation.status}; it is not recoverable`);
    }
    const targets = await db.update(schema.businessOperationTargets).set({
      status: "retry",
      attempts: 0,
      jobKey: null,
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
      failureClass: "retryable",
      errorKind: "retryable",
      lastError: "A human authorized recovery after reviewing the prior failure.",
      completedAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.businessOperationTargets.operationId, operation.id),
      eq(schema.businessOperationTargets.status, "failed"),
      inArray(schema.businessOperationTargets.failureClass, ["retryable", "configuration", "human_review"]),
    )).returning({ id: schema.businessOperationTargets.id });
    if (targets.length === 0) throw new Error("Business operation has no retryable or reviewable failed targets");
    await db.update(schema.businessOperations).set({ status: "queued", completedAt: null, failure: null, updatedAt: new Date() })
      .where(eq(schema.businessOperations.id, operation.id));
    await db.update(schema.domainActions).set({ status: "executing", executionStartedAt: new Date() })
      .where(eq(schema.domainActions.id, operation.domainActionId));
    await db.update(schema.decisionReceipts).set({ failure: null, finalizedAt: null })
      .where(and(eq(schema.decisionReceipts.tenantId, params.tenantId), eq(schema.decisionReceipts.operationId, operation.id)));
    await appendBusinessOperationEventTx(db, {
      tenantId: params.tenantId,
      operationId: operation.id,
      eventType: "recovery_authorized",
      payload: { requestedBy: params.requestedBy, recoveryKey: params.recoveryKey, targetCount: targets.length },
    });
    await db.insert(schema.jobs).values({
      type: "dispatch_business_operation",
      payload: { tenantId: params.tenantId, operationId: operation.id, actionId: operation.domainActionId },
      idempotencyKey: jobKey,
      lane: "batch",
      priority: 10,
    });
    return { retried: targets.length, duplicate: false, workId: operation.workId, actionType: action.actionType };
  });
}

// ---------------------------------------------------------------------------
// Upgrade 2: durable Work kernel. These primitives live beside withTenant so the
// API, orchestrator, voice intake, and workflow runtime can share one transactional
// lifecycle implementation without creating package dependency cycles.
// ---------------------------------------------------------------------------

export const WORK_STATUSES = [
  "received", "understanding", "planning", "ready", "actionable",
  "awaiting_approval", "executing", "completed", "failed", "recovery",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export interface ReceiveWorkParams {
  tenantId: string;
  instruction: string;
  channel: "voice" | "text" | "console";
  sessionId?: string;
  instructionId?: string;
  workId?: string;
  userId?: string;
  idempotencyKey?: string;
  activeContext?: Record<string, unknown>;
}

export interface ReceivedWork {
  workId: string;
  workInputId: string;
  instructionId: string;
  created: boolean;
  duplicate: boolean;
  status: WorkStatus;
  finalOutcome: unknown;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

/** The load-bearing intake claim. A Work and its first input are committed before
 * any caller may invoke the planner. Both client instruction ids and explicit
 * idempotency keys are unique claims, so a network retry cannot create a second Work. */
export async function receiveWork(params: ReceiveWorkParams): Promise<ReceivedWork> {
  const desiredWorkId = params.workId ?? params.instructionId ?? randomUUID();
  const desiredInstructionId = params.instructionId ?? randomUUID();
  return withTenant(params.tenantId, async (db) => {
    const [validUser] = isUuid(params.userId)
      ? await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, params.tenantId), eq(schema.users.id, params.userId))).limit(1)
      : [];

    let [work] = params.idempotencyKey
      ? await db.select().from(schema.works).where(and(eq(schema.works.tenantId, params.tenantId), eq(schema.works.idempotencyKey, params.idempotencyKey))).limit(1)
      : [];
    if (!work && params.workId) {
      [work] = await db.select().from(schema.works).where(and(eq(schema.works.tenantId, params.tenantId), eq(schema.works.id, params.workId))).limit(1);
      if (!work) {
        const [foreign] = await db.select({ id: schema.works.id }).from(schema.works).where(eq(schema.works.id, params.workId)).limit(1);
        if (foreign) throw new Error("Work not found");
      }
    }

    let created = false;
    if (!work) {
      const [inserted] = await db
        .insert(schema.works)
        .values({
          id: desiredWorkId,
          tenantId: params.tenantId,
          status: "received",
          sessionId: params.sessionId ?? null,
          initialChannel: params.channel,
          initialInstruction: params.instruction,
          createdBy: validUser?.id ?? null,
          activeContext: params.activeContext ?? {},
          idempotencyKey: params.idempotencyKey ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        work = inserted;
        created = true;
        await db.insert(schema.workEvents).values({
          tenantId: params.tenantId,
          workId: inserted.id,
          seq: 1,
          eventType: "received",
          fromStatus: null,
          toStatus: "received",
          payload: { channel: params.channel, sessionId: params.sessionId ?? null },
        });
      } else {
        [work] = await db.select().from(schema.works).where(and(
          eq(schema.works.tenantId, params.tenantId),
          params.idempotencyKey ? eq(schema.works.idempotencyKey, params.idempotencyKey) : eq(schema.works.id, desiredWorkId),
        )).limit(1);
      }
    }
    if (!work) throw new Error("Unable to create or resolve durable Work");

    const [existingInput] = await db.select().from(schema.workInputs).where(and(
      eq(schema.workInputs.tenantId, params.tenantId),
      params.idempotencyKey
        ? eq(schema.workInputs.idempotencyKey, params.idempotencyKey)
        : eq(schema.workInputs.instructionId, desiredInstructionId),
    )).limit(1);
    if (existingInput) {
      return {
        workId: work.id,
        workInputId: existingInput.id,
        instructionId: existingInput.instructionId,
        created,
        duplicate: true,
        status: work.status,
        finalOutcome: work.finalOutcome,
      };
    }

    const inputId = desiredInstructionId;
    const [input] = await db.insert(schema.workInputs).values({
      id: inputId,
      tenantId: params.tenantId,
      workId: work.id,
      instructionId: desiredInstructionId,
      channel: params.channel,
      sessionId: params.sessionId ?? work.sessionId,
      instructionText: params.instruction,
      createdBy: validUser?.id ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
    }).onConflictDoNothing().returning();
    if (!input) {
      const [raced] = await db.select().from(schema.workInputs).where(and(eq(schema.workInputs.tenantId, params.tenantId), eq(schema.workInputs.instructionId, desiredInstructionId))).limit(1);
      if (!raced) throw new Error("Unable to persist Work input");
      return { workId: raced.workId, workInputId: raced.id, instructionId: raced.instructionId, created, duplicate: true, status: work.status, finalOutcome: work.finalOutcome };
    }

    // instruction_sessions remains the backward-compatible trace projection. Every
    // new voice and text input now gets one, including server-minted voice inputs.
    await db.insert(schema.instructionSessions).values({
      id: desiredInstructionId,
      tenantId: params.tenantId,
      workId: work.id,
      sessionId: params.sessionId ?? work.sessionId,
      userId: validUser?.id ?? null,
      instructionText: params.instruction,
      source: params.channel === "voice" ? "voice" : "typed",
    }).onConflictDoUpdate({
      target: schema.instructionSessions.id,
      set: { workId: work.id, updatedAt: new Date() },
    });

    let currentStatus = work.status;
    if (!created) {
      await db.execute(sql`SELECT id FROM ${schema.works} WHERE ${schema.works.id} = ${work.id} FOR UPDATE`);
      const [latest] = await db.select({ maxSeq: sql<number>`coalesce(max(${schema.workEvents.seq}), 0)::int` }).from(schema.workEvents).where(eq(schema.workEvents.workId, work.id));
      const resumesFailure = work.status === "failed";
      if (resumesFailure) currentStatus = "recovery";
      await db.insert(schema.workEvents).values({
        tenantId: params.tenantId,
        workId: work.id,
        seq: (latest?.maxSeq ?? 0) + 1,
        eventType: resumesFailure ? "recovery_input_received" : "input_received",
        fromStatus: work.status,
        toStatus: resumesFailure ? "recovery" : work.status,
        payload: { workInputId: input.id, instructionId: desiredInstructionId, channel: params.channel },
      });
      await db.update(schema.works).set({
        ...(resumesFailure ? {
          status: "recovery" as const,
          recovery: { status: "input_received", workInputId: input.id, at: new Date().toISOString() },
        } : {}),
        ...(params.activeContext && Object.keys(params.activeContext).length > 0
          ? { activeContext: { ...jsonObject(work.activeContext), ...params.activeContext } }
          : {}),
        updatedAt: new Date(),
      }).where(eq(schema.works.id, work.id));
    }

    return { workId: work.id, workInputId: input.id, instructionId: desiredInstructionId, created, duplicate: false, status: currentStatus, finalOutcome: work.finalOutcome };
  });
}

export async function transitionWork(
  tenantId: string,
  workId: string,
  toStatus: WorkStatus,
  eventType: string,
  payload: Record<string, unknown> = {},
  patch: { finalOutcome?: unknown; failure?: unknown; recovery?: unknown; activeContext?: Record<string, unknown> } = {},
): Promise<void> {
  await withTenant(tenantId, async (db) => {
    await db.execute(sql`SELECT id FROM ${schema.works} WHERE ${schema.works.id} = ${workId} AND ${schema.works.tenantId} = ${tenantId} FOR UPDATE`);
    const [work] = await db.select().from(schema.works).where(and(eq(schema.works.id, workId), eq(schema.works.tenantId, tenantId))).limit(1);
    if (!work) throw new Error("Work not found");
    const [latest] = await db.select({ maxSeq: sql<number>`coalesce(max(${schema.workEvents.seq}), 0)::int` }).from(schema.workEvents).where(eq(schema.workEvents.workId, workId));
    await db.update(schema.works).set({
      status: toStatus,
      updatedAt: new Date(),
      ...(patch.finalOutcome !== undefined ? { finalOutcome: patch.finalOutcome as object } : {}),
      ...(patch.failure !== undefined ? { failure: patch.failure as object } : {}),
      ...(patch.recovery !== undefined ? { recovery: patch.recovery as object } : {}),
      ...(patch.activeContext ? { activeContext: { ...jsonObject(work.activeContext), ...patch.activeContext } } : {}),
    }).where(eq(schema.works.id, workId));
    await db.insert(schema.workEvents).values({
      tenantId,
      workId,
      seq: (latest?.maxSeq ?? 0) + 1,
      eventType,
      fromStatus: work.status,
      toStatus,
      payload,
    });
  });
}

/** Persist the exact backward-compatible API response without manufacturing a
 * lifecycle transition. Intake retries can therefore replay the original shape. */
export async function recordWorkResponse(tenantId: string, workId: string, response: Record<string, unknown>): Promise<void> {
  await withTenant(tenantId, async (db) => {
    const [work] = await db.select({ finalOutcome: schema.works.finalOutcome }).from(schema.works).where(and(eq(schema.works.id, workId), eq(schema.works.tenantId, tenantId))).limit(1);
    if (!work) throw new Error("Work not found");
    await db.update(schema.works).set({
      finalOutcome: { ...jsonObject(work.finalOutcome), response },
      updatedAt: new Date(),
    }).where(and(eq(schema.works.id, workId), eq(schema.works.tenantId, tenantId)));
  });
}

export async function beginWorkPlannerAttempt(params: {
  tenantId: string;
  workId: string;
  workInputId: string;
  attemptKey: string;
}): Promise<{ id: string; attempt: number; claimed: boolean; status: "planning" | "succeeded" | "failed" | "timed_out" }> {
  return withTenant(params.tenantId, async (db) => {
    await db.execute(sql`SELECT id FROM ${schema.works} WHERE ${schema.works.id} = ${params.workId} AND ${schema.works.tenantId} = ${params.tenantId} FOR UPDATE`);
    const [existing] = await db.select().from(schema.workPlannerAttempts).where(and(eq(schema.workPlannerAttempts.workId, params.workId), eq(schema.workPlannerAttempts.attemptKey, params.attemptKey))).limit(1);
    if (existing) return { id: existing.id, attempt: existing.attempt, claimed: false, status: existing.status };
    const [latest] = await db.select({ maxAttempt: sql<number>`coalesce(max(${schema.workPlannerAttempts.attempt}), 0)::int` }).from(schema.workPlannerAttempts).where(eq(schema.workPlannerAttempts.workId, params.workId));
    const [created] = await db.insert(schema.workPlannerAttempts).values({
      tenantId: params.tenantId,
      workId: params.workId,
      workInputId: params.workInputId,
      attempt: (latest?.maxAttempt ?? 0) + 1,
      attemptKey: params.attemptKey,
      status: "planning",
    }).returning();
    return { id: created!.id, attempt: created!.attempt, claimed: true, status: created!.status };
  });
}

export async function finishWorkPlannerAttempt(params: {
  tenantId: string;
  attemptId: string;
  status: "succeeded" | "failed" | "timed_out";
  plannerResult?: Record<string, unknown>;
  failure?: Record<string, unknown>;
}): Promise<void> {
  await withTenant(params.tenantId, (db) => db.update(schema.workPlannerAttempts).set({
    status: params.status,
    plannerResult: params.plannerResult ?? null,
    failure: params.failure ?? null,
    completedAt: new Date(),
  }).where(and(eq(schema.workPlannerAttempts.id, params.attemptId), eq(schema.workPlannerAttempts.tenantId, params.tenantId))));
}

export async function latestWorkInput(tenantId: string, workId: string): Promise<typeof schema.workInputs.$inferSelect | null> {
  const [row] = await withTenant(tenantId, (db) => db.select().from(schema.workInputs).where(and(eq(schema.workInputs.tenantId, tenantId), eq(schema.workInputs.workId, workId))).orderBy(desc(schema.workInputs.createdAt)).limit(1));
  return row ?? null;
}

/** Recomputes Work from durable child records. This is called after every existing
 * executor/workflow transition, so Work never claims completion while a real run is
 * active or an approval is still outstanding. */
export async function reconcileWorkStatus(tenantId: string, workId: string): Promise<WorkStatus> {
  const snapshot = await withTenant(tenantId, async (db) => {
    const actions = await db.select({ id: schema.domainActions.id, status: schema.domainActions.status }).from(schema.domainActions).where(and(eq(schema.domainActions.tenantId, tenantId), eq(schema.domainActions.workId, workId)));
    const runs = await db.select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status }).from(schema.workflowRuns).where(and(eq(schema.workflowRuns.tenantId, tenantId), eq(schema.workflowRuns.workId, workId)));
    const repairs = await db.select({ id: schema.planRepairs.id, status: schema.planRepairs.status }).from(schema.planRepairs).where(and(eq(schema.planRepairs.tenantId, tenantId), eq(schema.planRepairs.workId, workId)));
    const operations = await db.select({ id: schema.businessOperations.id, status: schema.businessOperations.status }).from(schema.businessOperations).where(and(eq(schema.businessOperations.tenantId, tenantId), eq(schema.businessOperations.workId, workId)));
    const [work] = await db.select().from(schema.works).where(and(eq(schema.works.tenantId, tenantId), eq(schema.works.id, workId))).limit(1);
    return { actions, runs, repairs, operations, work };
  });
  if (!snapshot.work) throw new Error("Work not found");
  if (snapshot.actions.length === 0 && snapshot.runs.length === 0) return snapshot.work.status;

  const actionStatuses = snapshot.actions.map((row) => row.status);
  const runStatuses = snapshot.runs.map((row) => row.status);
  const operationStatuses = snapshot.operations.map((row) => row.status);
  let status: WorkStatus;
  if (snapshot.repairs.some((row) => row.status === "planning" || row.status === "proposed") || operationStatuses.some((value) => value === "needs_human_review")) status = "recovery";
  else if (operationStatuses.some((value) => ["queued", "running"].includes(value)) || runStatuses.some((value) => ["running", "compensating"].includes(value)) || actionStatuses.some((value) => value === "approved" || value === "executing")) status = "executing";
  else if (actionStatuses.some((value) => value === "pending" || value === "needs_human_review") || runStatuses.some((value) => value === "paused" || value === "escalated")) status = "awaiting_approval";
  else if (actionStatuses.some((value) => value === "draft")) status = "actionable";
  else if (actionStatuses.some((value) => value === "failed" || value === "blocked_integration_unavailable") || runStatuses.some((value) => value === "failed") || operationStatuses.some((value) => value === "failed")) status = "failed";
  else if (actionStatuses.length > 0 && actionStatuses.every((value) => value === "completed" || value === "rejected") && runStatuses.every((value) => ["completed", "compensated", "cancelled"].includes(value)) && operationStatuses.every((value) => ["completed", "completed_with_failures", "cancelled"].includes(value))) status = "completed";
  else status = snapshot.work.status;

  const counts = {
    actions: actionStatuses.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}),
    workflows: runStatuses.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}),
    operations: operationStatuses.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}),
  };
  if (status !== snapshot.work.status) {
    await transitionWork(tenantId, workId, status, "children_reconciled", counts, status === "completed" ? { finalOutcome: counts } : status === "failed" ? { failure: counts } : {});
  }
  return status;
}

export type WorkAggregate = Record<string, unknown> & {
  queryExecutions: Array<typeof schema.workQueryExecutions.$inferSelect>;
  operations: Array<typeof schema.businessOperations.$inferSelect>;
  operationTargets: Array<typeof schema.businessOperationTargets.$inferSelect>;
  operationEvents: Array<typeof schema.businessOperationEvents.$inferSelect>;
};

export async function workAggregate(tenantId: string, workId: string): Promise<WorkAggregate | null> {
  return withTenant(tenantId, async (db) => {
    const [work] = await db.select().from(schema.works).where(and(eq(schema.works.tenantId, tenantId), eq(schema.works.id, workId))).limit(1);
    if (!work) return null;
    const inputs = await db.select().from(schema.workInputs).where(eq(schema.workInputs.workId, workId)).orderBy(asc(schema.workInputs.createdAt));
    const plannerAttempts = await db.select().from(schema.workPlannerAttempts).where(eq(schema.workPlannerAttempts.workId, workId)).orderBy(asc(schema.workPlannerAttempts.attempt));
    const events = await db.select().from(schema.workEvents).where(eq(schema.workEvents.workId, workId)).orderBy(asc(schema.workEvents.seq));
    const actions = await db.select().from(schema.domainActions).where(eq(schema.domainActions.workId, workId)).orderBy(asc(schema.domainActions.createdAt));
    const actionIds = actions.map((row) => row.id);
    const approvals = actionIds.length === 0 ? [] : await db.select().from(schema.actionLog).where(and(inArray(schema.actionLog.domainActionId, actionIds), inArray(schema.actionLog.step, ["gate", "confirmed", "rejected", "escalated", "policy_ungated_authorized"])) ).orderBy(asc(schema.actionLog.timestamp));
    const workflowRuns = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workId, workId)).orderBy(asc(schema.workflowRuns.createdAt));
    const runIds = workflowRuns.map((row) => row.id);
    const workflowSteps = runIds.length === 0 ? [] : await db.select().from(schema.workflowSteps).where(inArray(schema.workflowSteps.workflowRunId, runIds)).orderBy(asc(schema.workflowSteps.sequence));
    const receipts = await db.select().from(schema.decisionReceipts).where(eq(schema.decisionReceipts.workId, workId)).orderBy(asc(schema.decisionReceipts.createdAt));
    const repairs = await db.select().from(schema.planRepairs).where(eq(schema.planRepairs.workId, workId)).orderBy(asc(schema.planRepairs.createdAt));
    const queryExecutions = await db.select().from(schema.workQueryExecutions).where(and(
      eq(schema.workQueryExecutions.tenantId, tenantId),
      eq(schema.workQueryExecutions.workId, workId),
    )).orderBy(asc(schema.workQueryExecutions.startedAt));
    const operations = await db.select().from(schema.businessOperations).where(and(eq(schema.businessOperations.tenantId, tenantId), eq(schema.businessOperations.workId, workId))).orderBy(asc(schema.businessOperations.createdAt));
    const operationIds = operations.map((operation) => operation.id);
    const operationTargets = operationIds.length === 0 ? [] : await db.select().from(schema.businessOperationTargets).where(and(eq(schema.businessOperationTargets.tenantId, tenantId), inArray(schema.businessOperationTargets.operationId, operationIds))).orderBy(asc(schema.businessOperationTargets.ordinal));
    const operationEvents = operationIds.length === 0 ? [] : await db.select().from(schema.businessOperationEvents).where(and(eq(schema.businessOperationEvents.tenantId, tenantId), inArray(schema.businessOperationEvents.operationId, operationIds))).orderBy(asc(schema.businessOperationEvents.sequence));
    return { work, inputs, plannerAttempts, actions, approvals, workflowRuns, workflowSteps, receipts, repairs, events, queryExecutions, operations, operationTargets, operationEvents };
  });
}

// ---------------------------------------------------------------------------
// Upgrade 3: durable operational-query execution receipts. These are deliberately
// separate from beginWorkPlannerAttempt/finishWorkPlannerAttempt: a direct typed
// read is never an LLM planner attempt, even when it is attached to a Work.
// ---------------------------------------------------------------------------

export type WorkQueryIntent =
  | "customer_lookup"
  | "customer_cohort"
  | "schedule_range"
  | "money_summary"
  | "work_list"
  | "inventory_status"
  | "agent_activity"
  | "business_state";

export interface BeginWorkQueryExecutionParams {
  tenantId: string;
  workId: string;
  workInputId?: string | null;
  intent: WorkQueryIntent;
  request: Record<string, unknown>;
  executionKey: string;
}

export interface WorkQueryExecutionClaim {
  id: string;
  workId: string;
  workInputId: string | null;
  executionKey: string;
  status: "running" | "succeeded" | "failed";
  claimed: boolean;
  resultSummary: unknown;
  rowCount: number;
}

function boundedJson(value: unknown, maxBytes: number): unknown {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized && Buffer.byteLength(serialized, "utf8") <= maxBytes) return value;
  } catch {
    // A non-serializable error/result must not prevent the durable failure receipt.
  }
  return { bounded: true, truncated: true };
}

/** Canonical JSON comparison for the request portion of an idempotency receipt.
 * Request objects are small typed values, so sorting object keys is sufficient;
 * array order remains meaningful and undefined object members are omitted just as
 * JSONB serialization omits them. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertSameWorkQueryExecution(
  existing: { intent: string; request: unknown; workInputId: string | null },
  params: BeginWorkQueryExecutionParams,
): void {
  if (existing.intent !== params.intent || existing.workInputId !== (params.workInputId ?? null) || canonicalJson(existing.request) !== canonicalJson(params.request)) {
    throw new Error("executionKey is already bound to a different operational query");
  }
}

function validateWorkQueryExecutionKey(executionKey: string): void {
  if (!executionKey.trim() || executionKey.length > 256) throw new Error("executionKey must be non-empty and at most 256 characters");
}

/** Claims one idempotent query execution under a tenant Work. The Work/Input
 * ownership checks are explicit even though RLS also protects these tables. */
export async function beginWorkQueryExecution(params: BeginWorkQueryExecutionParams): Promise<WorkQueryExecutionClaim> {
  validateWorkQueryExecutionKey(params.executionKey);
  return withTenant(params.tenantId, async (db) => {
    const [work] = await db.select({ id: schema.works.id }).from(schema.works).where(and(
      eq(schema.works.id, params.workId),
      eq(schema.works.tenantId, params.tenantId),
    )).limit(1);
    if (!work) throw new Error("Work not found");

    if (params.workInputId) {
      const [input] = await db.select({ id: schema.workInputs.id }).from(schema.workInputs).where(and(
        eq(schema.workInputs.id, params.workInputId),
        eq(schema.workInputs.workId, params.workId),
        eq(schema.workInputs.tenantId, params.tenantId),
      )).limit(1);
      if (!input) throw new Error("Work input not found");
    }

    const [existing] = await db.select().from(schema.workQueryExecutions).where(and(
      eq(schema.workQueryExecutions.tenantId, params.tenantId),
      eq(schema.workQueryExecutions.workId, params.workId),
      eq(schema.workQueryExecutions.executionKey, params.executionKey),
    )).limit(1);
    if (existing) {
      assertSameWorkQueryExecution(existing, params);
      return {
        id: existing.id,
        workId: existing.workId,
        workInputId: existing.workInputId,
        executionKey: existing.executionKey,
        status: existing.status,
        claimed: false,
        resultSummary: existing.resultSummary,
        rowCount: existing.rowCount,
      };
    }

    const [created] = await db.insert(schema.workQueryExecutions).values({
      tenantId: params.tenantId,
      workId: params.workId,
      workInputId: params.workInputId ?? null,
      intent: params.intent,
      request: params.request,
      executionKey: params.executionKey,
      status: "running",
      rowCount: 0,
    }).onConflictDoNothing().returning();
    if (created) {
      return {
        id: created.id,
        workId: created.workId,
        workInputId: created.workInputId,
        executionKey: created.executionKey,
        status: created.status,
        claimed: true,
        resultSummary: created.resultSummary,
        rowCount: created.rowCount,
      };
    }

    // A concurrent claimant won the unique (work_id, execution_key) race. Resolve
    // the winner within the same tenant transaction rather than creating a second
    // durable row or treating the race as a query failure.
    const [raced] = await db.select().from(schema.workQueryExecutions).where(and(
      eq(schema.workQueryExecutions.tenantId, params.tenantId),
      eq(schema.workQueryExecutions.workId, params.workId),
      eq(schema.workQueryExecutions.executionKey, params.executionKey),
    )).limit(1);
    if (!raced) throw new Error("Unable to resolve work query execution claim");
    assertSameWorkQueryExecution(raced, params);
    return {
      id: raced.id,
      workId: raced.workId,
      workInputId: raced.workInputId,
      executionKey: raced.executionKey,
      status: raced.status,
      claimed: false,
      resultSummary: raced.resultSummary,
      rowCount: raced.rowCount,
    };
  });
}

export interface FinishWorkQueryExecutionParams {
  tenantId: string;
  executionId: string;
  status: "succeeded" | "failed";
  rowCount: number;
  durationMs: number;
  resultSummary?: unknown;
  failure?: unknown;
}

/** Completes a query execution with a bounded summary and no raw result payload. */
export async function finishWorkQueryExecution(params: FinishWorkQueryExecutionParams): Promise<void> {
  if (!Number.isInteger(params.rowCount) || params.rowCount < 0) throw new Error("rowCount must be a non-negative integer");
  if (!Number.isFinite(params.durationMs) || params.durationMs < 0) throw new Error("durationMs must be non-negative");
  await withTenant(params.tenantId, async (db) => {
    await db.update(schema.workQueryExecutions).set({
      status: params.status,
      resultSummary: params.status === "succeeded" ? boundedJson(params.resultSummary, 16_000) as object : null,
      rowCount: params.rowCount,
      durationMs: Math.round(params.durationMs),
      failure: params.status === "failed" ? boundedJson(params.failure, 8_000) as object : null,
      completedAt: new Date(),
    }).where(and(
      eq(schema.workQueryExecutions.id, params.executionId),
      eq(schema.workQueryExecutions.tenantId, params.tenantId),
    ));
  });
}
