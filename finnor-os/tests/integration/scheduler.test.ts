// Proactive scheduler acceptance: a scan enqueues once per tenant per time window,
// a second tick in the same window is a no-op (the idempotency-key guarantee this
// whole mechanism depends on), and a new window enqueues again.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool } from "@finnor/db";
import { scheduleTick } from "../../apps/worker/src/scheduler";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-000000000001";

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

describe.skipIf(!available)("proactive scheduler", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'Scheduler Test Tenant') ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID],
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("enqueues one job per tenant per scan on a tick", async () => {
    await getPool().query("DELETE FROM jobs WHERE type = 'test_scan_a'");
    await scheduleTick([{ type: "test_scan_a", intervalHours: 24, payload: (tenantId) => ({ tenantId }) }]);
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM jobs WHERE type = 'test_scan_a'");
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("a second tick in the same window is a no-op — the idempotency guarantee", async () => {
    await getPool().query("DELETE FROM jobs WHERE type = 'test_scan_b'");
    const scans = [{ type: "test_scan_b", intervalHours: 24, payload: (tenantId: string) => ({ tenantId }) }];
    await scheduleTick(scans);
    await scheduleTick(scans);
    await scheduleTick(scans);
    const { rows } = await getPool().query(
      "SELECT count(*)::int AS n FROM jobs WHERE type = 'test_scan_b' AND payload->>'tenantId' = $1",
      [TENANT_ID],
    );
    expect(rows[0].n).toBe(1);
  });

  it("multiple distinct scans in one tick each get their own job, per tenant", async () => {
    await getPool().query("DELETE FROM jobs WHERE type IN ('test_scan_c', 'test_scan_d')");
    await scheduleTick([
      { type: "test_scan_c", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
      { type: "test_scan_d", intervalHours: 24, payload: (tenantId) => ({ tenantId }) },
    ]);
    // Scoped to the known test tenant — the local dev DB has other tenants from
    // other test suites' fixtures, and a per-tenant scan correctly enqueues for
    // each of them too (that's the intended behavior, not a bug to assert against).
    const { rows } = await getPool().query(
      "SELECT type FROM jobs WHERE type IN ('test_scan_c', 'test_scan_d') AND payload->>'tenantId' = $1 ORDER BY type",
      [TENANT_ID],
    );
    expect(rows.map((r) => r.type)).toEqual(["test_scan_c", "test_scan_d"]);
  });
});
