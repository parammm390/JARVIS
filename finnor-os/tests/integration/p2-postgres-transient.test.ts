// P2.T1/T3: a disposable local connection is deliberately terminated to model a
// transient Postgres/network failure. This file is only valid in the guarded local
// chaos context; it never targets staging or production.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closePool, getPool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
})();

const chaosAvailable = available && process.env.NODE_ENV !== "production" && process.env.FINNOR_CHAOS_TEST_CONTEXT === "1";

describe.skipIf(!chaosAvailable)("Phase 2 local Postgres transient fault", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  });

  afterAll(async () => {
    await closePool();
  });

  it("recovers a pooled client after its backend is terminated once", async () => {
    const pool = getPool();
    const killer = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
    await killer.connect();
    const victim = await pool.connect();
    try {
      const row = (await victim.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0];
      if (!row) throw new Error("Postgres backend probe returned no pid");
      const { pid } = row;
      const terminated = await killer.query<{ pg_terminate_backend: boolean }>("SELECT pg_terminate_backend($1)", [pid]);
      expect(terminated.rows[0]?.pg_terminate_backend).toBe(true);
      await expect(victim.query("SELECT 1")).rejects.toThrow();
    } finally {
      victim.release();
      await killer.end();
    }

    // The next application query must obtain a fresh client rather than carrying a
    // dead connection forward. No data mutation or provider call is involved.
    const recovered = await pool.query<{ value: number }>("SELECT 1 AS value");
    expect(recovered.rows[0]?.value).toBe(1);
  });
});
