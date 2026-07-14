// Queue/worker acceptance (§32.7): a job is picked up, retried on simulated failure per
// its retry policy, and dead-letters after max attempts instead of looping forever.
// Also proves idempotent enqueue.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool } from "@finnor/db";
import { JobQueue } from "../../apps/worker/src/queue";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("postgres job queue (§32.7)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query("DELETE FROM jobs");
  });

  afterAll(async () => {
    await closePool();
  });

  it("runs a queued job to completion", async () => {
    const queue = new JobQueue();
    let ran = 0;
    queue.register("test_ok", async () => {
      ran++;
    });
    await queue.enqueue("test_ok", { hello: "world" });
    expect(await queue.tick()).toBe(true);
    expect(ran).toBe(1);
    const { rows } = await getPool().query("SELECT status FROM jobs WHERE type = 'test_ok'");
    expect(rows[0].status).toBe("completed");
  });

  it("idempotency key makes double-enqueue a no-op", async () => {
    const queue = new JobQueue();
    queue.register("test_idem", async () => undefined);
    await queue.enqueue("test_idem", {}, "same-key");
    await queue.enqueue("test_idem", {}, "same-key");
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM jobs WHERE type = 'test_idem'");
    expect(rows[0].n).toBe(1);
  });

  it("failing job retries with backoff and dead-letters after max attempts", async () => {
    await getPool().query("DELETE FROM jobs"); // isolate from earlier tests' leftover jobs
    const queue = new JobQueue();
    let attempts = 0;
    queue.register("test_fail", async () => {
      attempts++;
      throw new Error("simulated failure");
    });
    await getPool().query(
      `INSERT INTO jobs (type, payload, max_attempts) VALUES ('test_fail', '{}', 2)`,
    );
    await queue.tick(); // attempt 1 → requeued with backoff
    let { rows } = await getPool().query("SELECT status FROM jobs WHERE type = 'test_fail'");
    expect(rows[0].status).toBe("queued");
    // Pull the retry forward instead of waiting out the backoff.
    await getPool().query("UPDATE jobs SET run_at = now() WHERE type = 'test_fail'");
    await queue.tick(); // attempt 2 → dead letter
    ({ rows } = await getPool().query("SELECT status, last_error FROM jobs WHERE type = 'test_fail'"));
    expect(rows[0].status).toBe("dead_letter");
    expect(rows[0].last_error).toMatch(/simulated failure/);
    expect(attempts).toBe(2);
  });

  it("reclaims an expired worker lease instead of leaving a crashed job running forever", async () => {
    await getPool().query("DELETE FROM jobs");
    const queue = new JobQueue();
    await getPool().query(
      `INSERT INTO jobs (type, payload, status, attempts, max_attempts, started_at)
       VALUES ('crashed_worker', '{}', 'running', 1, 3, now() - interval '10 minutes')`,
    );
    expect(await queue.recoverExpiredRunningJobs(60)).toBe(1);
    const { rows } = await getPool().query("SELECT status, started_at, last_error FROM jobs WHERE type = 'crashed_worker'");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].started_at).toBeNull();
    expect(rows[0].last_error).toMatch(/lease expired/i);
  });

  it("dead-letters an expired lease that already exhausted its attempts", async () => {
    await getPool().query("DELETE FROM jobs");
    const queue = new JobQueue();
    await getPool().query(
      `INSERT INTO jobs (type, payload, status, attempts, max_attempts, started_at)
       VALUES ('crashed_poison_job', '{}', 'running', 3, 3, now() - interval '10 minutes')`,
    );
    expect(await queue.recoverExpiredRunningJobs(60)).toBe(1);
    const { rows } = await getPool().query("SELECT status FROM jobs WHERE type = 'crashed_poison_job'");
    expect(rows[0].status).toBe("dead_letter");
  });

  it("does not leak a pooled connection on an empty queue (regression: tick() used to return before releasing its client on the empty-queue path — fine locally where the pool caps at 10, but in production's ssl pool, capped at 2, two consecutive empty ticks permanently exhausted it and every later tick hung forever)", async () => {
    await getPool().query("DELETE FROM jobs");
    const queue = new JobQueue();
    // Local dev's pool caps at 10 connections (non-ssl, packages/db/index.ts). Call
    // tick() on a genuinely empty queue more times than that — before the fix, each
    // empty tick leaked one connection and the 11th call would hang forever waiting
    // for a free one that was never coming back.
    for (let i = 0; i < 15; i++) {
      expect(await queue.tick()).toBe(false);
    }
  });
});
