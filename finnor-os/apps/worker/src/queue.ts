// Postgres-backed job queue (§15–16): FOR UPDATE SKIP LOCKED polling, retry with
// backoff, dead-letter after max attempts. Every handler idempotent.

import { getPool } from "@finnor/db";
import type { Job } from "@finnor/shared-types";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export class JobQueue {
  private handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, idempotencyKey?: string): Promise<void> {
    await getPool().query(
      `INSERT INTO jobs (type, payload, idempotency_key) VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [type, JSON.stringify(payload), idempotencyKey ?? null],
    );
  }

  /** Claim and run one due job. Returns false when the queue is empty. */
  async tick(): Promise<boolean> {
    const client = await getPool().connect();
    let job: Job | null = null;
    try {
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id, type, payload, attempts, max_attempts FROM jobs
           WHERE status = 'queued' AND run_at <= now()
           ORDER BY run_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
        );
        if (rows.length === 0) {
          await client.query("COMMIT");
          return false;
        }
        job = rows[0] as Job;
        await client.query(`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = $1`, [job.id]);
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
    try {
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      await handler(job.payload as Record<string, unknown>);
      await getPool().query(`UPDATE jobs SET status = 'completed' WHERE id = $1`, [job.id]);
    } catch (err) {
      const attempts = Number(job.attempts) + 1;
      const max = Number((job as unknown as { max_attempts: number }).max_attempts ?? 3);
      const dead = attempts >= max;
      await getPool().query(
        `UPDATE jobs SET status = $2, last_error = $3, run_at = now() + ($4 || ' seconds')::interval WHERE id = $1`,
        [job.id, dead ? "dead_letter" : "queued", (err as Error).message, String(30 * 2 ** attempts)],
      );
    }
    return true;
  }

  async runLoop(pollMs = 2000, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      let worked = false;
      try {
        worked = await this.tick();
      } catch (err) {
        console.error("[worker] tick failed:", err);
      }
      if (!worked) await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
