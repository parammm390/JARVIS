// Postgres-backed job queue (§15–16): FOR UPDATE SKIP LOCKED polling, retry with
// backoff, dead-letter after max attempts. Every handler idempotent.

import { getPool } from "@finnor/db";
import type { Job } from "@finnor/shared-types";
import { Sentry, logWithTrace } from "@finnor/tools";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
export type JobLane = "interactive" | "batch";

/** A process-level cap: the database claim remains the cross-process boundary. */
export function workerConcurrency(value = process.env.WORKER_CONCURRENCY): number {
  const parsed = Number.parseInt(value ?? "2", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 2;
}

export function reservedInteractiveConcurrency(total: number, value = process.env.WORKER_INTERACTIVE_RESERVED_CONCURRENCY): number {
  if (total < 2) return 0;
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed < total ? parsed : 1;
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();

  constructor(
    readonly instanceId = process.env.FINNOR_WORKER_INSTANCE_ID?.trim()
      || `${hostname()}:${process.pid}:${randomUUID()}`,
    readonly leaseSeconds = Math.max(process.env.NODE_ENV === "test" ? 3 : 30, Number(process.env.WORKER_JOB_LEASE_SECONDS ?? 300)),
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, idempotencyKey?: string, lane: JobLane = "batch", priority = 0): Promise<void> {
    await getPool().query(
      `INSERT INTO jobs (type, payload, idempotency_key, lane, priority) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [type, JSON.stringify(payload), idempotencyKey ?? null, lane, priority],
    );
  }

  /**
   * A worker can disappear after changing a job to `running` and before its handler
   * returns. Reclaim only work whose lease has expired; never assume it failed or
   * silently discard it. A reclaimed job consumes an attempt exactly like a normal
   * failed run, so poison jobs still reach the dead-letter queue.
   */
  async recoverExpiredRunningJobs(leaseSeconds = this.leaseSeconds): Promise<number> {
    const { rowCount } = await getPool().query(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
           last_error = 'Worker lease expired before the job completed',
           run_at = CASE
             WHEN attempts >= max_attempts THEN run_at
             ELSE now() + (LEAST(300, 30 * power(2, GREATEST(attempts, 1))) || ' seconds')::interval
           END,
           started_at = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           lease_heartbeat_at = NULL
       WHERE status = 'running'
         AND coalesce(lease_expires_at, started_at + ($1 || ' seconds')::interval) <= now()`,
      [String(leaseSeconds)],
    );
    return rowCount ?? 0;
  }

  /** Claim and run one due job. Returns false when the queue is empty. */
  async tick(lane: "any" | "interactive" = "any"): Promise<boolean> {
    await this.recoverExpiredRunningJobs();
    // A queue instance may intentionally host only a subset of handlers (tests,
    // lane-specific workers, rolling deploys). It must never claim and poison a job
    // it cannot execute; leave that row queued for a capable worker instead.
    const registeredTypes = [...this.handlers.keys()];
    if (registeredTypes.length === 0) return false;
    const client = await getPool().connect();
    let job: Job | null = null;
    try {
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id, type, payload, attempts, max_attempts FROM jobs
           WHERE status = 'queued' AND run_at <= now() AND type = ANY($1::text[])
             AND ($2::text = 'any' OR lane = $2::text)
           ORDER BY CASE lane WHEN 'interactive' THEN 0 ELSE 1 END, priority DESC, run_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [registeredTypes, lane],
        );
        if (rows.length === 0) {
          await client.query("COMMIT");
          return false;
        }
        job = rows[0] as Job;
        const claimed = await client.query(
          `UPDATE jobs
              SET status = 'running', attempts = attempts + 1, started_at = now(),
                  lease_owner = $2,
                  lease_expires_at = now() + ($3 || ' seconds')::interval,
                  lease_heartbeat_at = now()
            WHERE id = $1 AND status = 'queued'
          RETURNING id,type,payload,attempts,max_attempts AS "maxAttempts"`,
          [job.id, this.instanceId, String(this.leaseSeconds)],
        );
        if (claimed.rows.length !== 1) {
          await client.query("ROLLBACK");
          return false;
        }
        job = claimed.rows[0] as Job;
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    } finally {
      // The empty-queue path used to return before this ran, leaking one pooled
      // connection per idle poll — with production's max:2 (ssl) pool, two
      // consecutive empty ticks (~4s) permanently exhausted it and every later
      // getPool().connect() call hung forever waiting for a connection that was
      // never coming back, silently wedging the entire queue.
      client.release();
    }

    const handler = this.handlers.get(job.type);
    // Phase 16(e): correlation id rides inside payload as _correlationId (enqueueJob's
    // doing) — fall back to the job's own id so every dispatch is greppable even when
    // no caller had a ctx to thread one through (draftKnownAction/system scans).
    const payload = job.payload as Record<string, unknown>;
    const correlationId = (payload._correlationId as string | undefined) ?? job.id;
    // A2.T2: every job's log line carries the same trace/tenant/action fields its
    // Sentry breadcrumb and the eventual DecisionReceipt do — the id printed here is
    // the one to grep for in Axiom/Sentry/the receipt for this exact execution.
    const log = logWithTrace({
      traceId: correlationId,
      tenantId: (payload.tenantId as string | undefined) ?? undefined,
      actionId: (payload.actionId as string | undefined) ?? undefined,
      jobType: job.type,
      jobId: job.id,
    });
    const start = Date.now();
    const renewEveryMs = Math.max(1_000, Math.floor(this.leaseSeconds * 1_000 / 3));
    let leaseLost = false;
    const renewLease = async (): Promise<void> => {
      const result = await getPool().query(
        `UPDATE jobs
            SET lease_expires_at=now()+($3 || ' seconds')::interval,lease_heartbeat_at=now()
          WHERE id=$1 AND status='running' AND lease_owner=$2`,
        [job!.id, this.instanceId, String(this.leaseSeconds)],
      );
      if (result.rowCount !== 1) leaseLost = true;
    };
    const renewal = setInterval(() => {
      void renewLease().catch((error) => {
        leaseLost = true;
        log.error({ err: error instanceof Error ? error.message : String(error) }, "job lease renewal failed");
      });
    }, renewEveryMs);
    try {
      await Sentry.withScope(async (scope) => {
        scope.setTag("correlation_id", correlationId);
        scope.setTag("job_type", job.type);
        if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
        await handler(payload);
      });
      const ms = Date.now() - start;
      Sentry.addBreadcrumb({ category: "job", message: job.type, data: { ok: true, ms, correlationId } });
      log.info({ ok: true, ms }, `job ${job.type} completed`);
      if (leaseLost) throw new Error("Worker lost the durable job lease before completion could be committed");
      const completed = await getPool().query(
        `UPDATE jobs SET status='completed',completed_at=now(),started_at=NULL,
                         lease_owner=NULL,lease_expires_at=NULL,lease_heartbeat_at=NULL
          WHERE id=$1 AND status='running' AND lease_owner=$2`,
        [job.id, this.instanceId],
      );
      if (completed.rowCount !== 1) throw new Error("Worker no longer owns the durable job lease");
    } catch (err) {
      const ms = Date.now() - start;
      Sentry.addBreadcrumb({ category: "job", message: job.type, data: { ok: false, ms, correlationId } });
      Sentry.captureException(err);
      log.error({ ok: false, ms, err: err instanceof Error ? err.message : String(err) }, `job ${job.type} failed`);
      const attempts = Number(job.attempts);
      const max = Number(job.maxAttempts ?? 3);
      const dead = attempts >= max;
      const errDetail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      await getPool().query(
        `UPDATE jobs SET status=$3,last_error=$4,run_at=now()+($5 || ' seconds')::interval,
                         started_at=NULL,lease_owner=NULL,lease_expires_at=NULL,lease_heartbeat_at=NULL
          WHERE id=$1 AND status='running' AND lease_owner=$2`,
        [job.id, this.instanceId, dead ? "dead_letter" : "queued", errDetail, String(30 * 2 ** attempts)],
      );
    } finally {
      clearInterval(renewal);
    }
    return true;
  }

  async runLoop(pollMs = 2000, signal?: AbortSignal, concurrency = workerConcurrency()): Promise<void> {
    // Each slot claims through FOR UPDATE SKIP LOCKED. The cap prevents one process
    // from turning an outage into an unbounded set of in-flight provider calls.
    const reserved = reservedInteractiveConcurrency(concurrency);
    await Promise.all([
      ...Array.from({ length: reserved }, () => this.runSlot(pollMs, signal, "interactive")),
      ...Array.from({ length: concurrency - reserved }, () => this.runSlot(pollMs, signal, "any")),
    ]);
  }

  private async runSlot(pollMs: number, signal?: AbortSignal, lane: "any" | "interactive" = "any"): Promise<void> {
    while (!signal?.aborted) {
      let worked = false;
      try {
        worked = await this.tick(lane);
      } catch (err) {
        console.error("[worker] tick failed:", err);
      }
      if (!worked) await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
