// Phase 8 (§8.2 failure-injection calendar, §8.3 daily scorecard): real Postgres,
// real rows — proves the daily_scorecard job writes/upserts a real row from the real
// reliability() read-model (never a divergent computation), proves both new tables'
// RLS actually isolates tenants (this phase's own §8.1 "RLS-by-test on every
// tenant-scoped table added since Phase 1" requirement, applied to the tables added
// in this exact phase), and proves the route layer is tenant-scoped end to end.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, readinessLog, failureInjections } from "@finnor/db";
import { readinessTrend, failureInjectionLog } from "@finnor/read-models";
import { dailyScorecard } from "../../apps/worker/src/handlers/daily-scorecard";
import { GET } from "../../apps/api/app/api/read-models/[view]/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000e1";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-0000000000e2";

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

function req(tenantId: string, view: string, qs = ""): Request {
  return new Request(`http://localhost/api/read-models/${view}${qs}`, {
    headers: { "x-tenant-id": tenantId, "x-user-role": "owner" },
  });
}

describe.skipIf(!available)("readiness_log + failure_injections (Phase 8)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Readiness Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Readiness Decoy Tenant') ON CONFLICT (id) DO NOTHING`, [OTHER_TENANT_ID]);
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, (db) => db.delete(readinessLog).where(eq(readinessLog.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) => db.delete(failureInjections).where(eq(failureInjections.tenantId, TENANT_ID)));
    await closePool();
  });

  it("daily_scorecard writes a real row from the real reliability() read-model, and re-running upserts instead of duplicating", async () => {
    await dailyScorecard({ tenantId: TENANT_ID });
    const first = await readinessTrend(TENANT_ID, 5);
    expect(first).toHaveLength(1);
    expect(first[0]!.reconciliationBacklog).toBe(0);
    expect(first[0]!.dlqDepth).toBe(0);
    // Empty tenant -> no terminal runs -> rates null, never a fabricated 0.
    expect(first[0]!.workflowSuccessRate).toBeNull();

    await dailyScorecard({ tenantId: TENANT_ID }); // same calendar day, second run
    const second = await readinessTrend(TENANT_ID, 5);
    expect(second).toHaveLength(1); // still exactly one row for today, not two
  });

  it("readiness_log RLS: a decoy tenant sees zero of another tenant's rows", async () => {
    const decoy = await readinessTrend(OTHER_TENANT_ID, 5);
    expect(decoy).toHaveLength(0);
  });

  it("GET /api/read-models/readiness requires auth and is tenant-scoped", async () => {
    const anonRes = await GET(new Request("http://localhost/api/read-models/readiness"), { params: { view: "readiness" } });
    expect(anonRes.status).toBe(401);

    const res = await GET(req(TENANT_ID, "readiness"), { params: { view: "readiness" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);

    const otherRes = await GET(req(OTHER_TENANT_ID, "readiness"), { params: { view: "readiness" } });
    const otherBody = await otherRes.json();
    expect(otherBody.data).toHaveLength(0);
  });

  it("failure_injections: real row insert, RLS-isolated, and readable via the route", async () => {
    await withTenant(TENANT_ID, (db) =>
      db.insert(failureInjections).values({
        tenantId: TENANT_ID,
        kind: "approval_expiry_pileup",
        outcome: "pass",
        detail: { note: "test injection" },
      }),
    );

    const mine = await failureInjectionLog(TENANT_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.kind).toBe("approval_expiry_pileup");
    expect(mine[0]!.outcome).toBe("pass");

    const decoy = await failureInjectionLog(OTHER_TENANT_ID);
    expect(decoy).toHaveLength(0);

    const res = await GET(req(TENANT_ID, "failure-injections"), { params: { view: "failure-injections" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });
});
