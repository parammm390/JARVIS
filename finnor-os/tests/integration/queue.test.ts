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
});
