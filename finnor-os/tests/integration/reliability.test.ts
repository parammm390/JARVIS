// Reliability read-model acceptance (Phase 6, JARVIS 95% MAESTRO PACK §6.6): real
// Postgres, real workflow_runs/workflow_steps/domain_actions/decision_receipts/
// dead_letters/reconciliation_cases rows — proves every metric is a real computed
// aggregate, not a placeholder, and that the route enforces tenant isolation.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  getPool,
  closePool,
  withTenant,
  commands,
  workflowRuns,
  workflowSteps,
  domainActions,
  decisionReceipts,
  deadLetters,
  reconciliationCases,
} from "@finnor/db";
import { reliability } from "@finnor/read-models";
import { GET } from "../../apps/api/app/api/read-models/[view]/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000d5";
const OTHER_TENANT_ID = "00000000-0000-4000-8000-0000000000d6";

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

function req(tenantId: string, qs = ""): Request {
  return new Request(`http://localhost/api/read-models/reliability${qs}`, {
    headers: { "x-tenant-id": tenantId, "x-user-role": "owner" },
  });
}

describe.skipIf(!available)("reliability read-model (Phase 6)", () => {
  let runIdCompleted: string;
  let runIdFailed: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Reliability Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Reliability Decoy Tenant') ON CONFLICT (id) DO NOTHING`, [OTHER_TENANT_ID]);

    await withTenant(TENANT_ID, async (db) => {
      const [cmdOk] = await db.insert(commands).values({ tenantId: TENANT_ID, commandType: "reliability_test" }).returning();
      const [runOk] = await db.insert(workflowRuns).values({ tenantId: TENANT_ID, commandId: cmdOk!.id, workflowType: "test_flow", status: "completed" }).returning();
      runIdCompleted = runOk!.id;
      // One clean step, one retried step (attempts=2) — both completed, so retryRate should be 1/2.
      await db.insert(workflowSteps).values([
        { tenantId: TENANT_ID, workflowRunId: runOk!.id, stepType: "step_a", sequence: 1, status: "completed", idempotencyKey: "rel-a", attempts: 1 },
        { tenantId: TENANT_ID, workflowRunId: runOk!.id, stepType: "step_b", sequence: 2, status: "completed", idempotencyKey: "rel-b", attempts: 2 },
      ]);

      const [cmdFail] = await db.insert(commands).values({ tenantId: TENANT_ID, commandType: "reliability_test" }).returning();
      const [runFail] = await db.insert(workflowRuns).values({ tenantId: TENANT_ID, commandId: cmdFail!.id, workflowType: "test_flow", status: "failed" }).returning();
      runIdFailed = runFail!.id;
      await db.insert(workflowSteps).values({ tenantId: TENANT_ID, workflowRunId: runFail!.id, stepType: "step_c", sequence: 1, status: "failed", idempotencyKey: "rel-c", attempts: 1 });

      // A still-running run must NOT count toward the terminal success-rate denominator.
      const [cmdRunning] = await db.insert(commands).values({ tenantId: TENANT_ID, commandType: "reliability_test" }).returning();
      await db.insert(workflowRuns).values({ tenantId: TENANT_ID, commandId: cmdRunning!.id, workflowType: "test_flow", status: "running" });

      // 1 of 3 domain_actions needs human review -> humanInterventionRate = 1/3.
      await db.insert(domainActions).values([
        { tenantId: TENANT_ID, actionType: "reliability_test_action", status: "completed" },
        { tenantId: TENANT_ID, actionType: "reliability_test_action", status: "completed" },
        { tenantId: TENANT_ID, actionType: "reliability_test_action", status: "needs_human_review" },
      ]);

      // 1 of 2 receipts finalized -> receiptCompleteness = 1/2.
      await db.insert(decisionReceipts).values([
        { tenantId: TENANT_ID, workflowRunId: runOk!.id, objective: "test", finalizedAt: new Date() },
        { tenantId: TENANT_ID, workflowRunId: runFail!.id, objective: "test", finalizedAt: null },
      ]);

      await db.insert(reconciliationCases).values({ tenantId: TENANT_ID, caseType: "unknown_delivery", status: "open" });
      await db.insert(deadLetters).values({ tenantId: TENANT_ID, envelope: {}, errorKind: "terminal", lastError: "test", status: "open" });
    });
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(deadLetters).where(eq(deadLetters.tenantId, TENANT_ID));
      await db.delete(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID));
      await db.delete(decisionReceipts).where(eq(decisionReceipts.tenantId, TENANT_ID));
      // domain_actions has action_log rows referencing it via FK, and action_log is
      // append-only (migration 0015) — same test-only GUC escape hatch household-360's
      // own cleanup uses (never set by application code).
      await db.execute(sql`SELECT set_config('app.allow_audit_mutation', 'true', true)`);
      await db.execute(sql`DELETE FROM finnor_os.action_log WHERE tenant_id = ${TENANT_ID}`);
      await db.delete(domainActions).where(eq(domainActions.tenantId, TENANT_ID));
      await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, TENANT_ID));
      await db.delete(workflowRuns).where(eq(workflowRuns.tenantId, TENANT_ID));
      await db.delete(commands).where(eq(commands.tenantId, TENANT_ID));
    });
    await closePool();
  });

  it("computes real success rate, retry rate, human-intervention rate, receipt completeness from actual rows", async () => {
    const metrics = await reliability(TENANT_ID, 30);
    expect(metrics.tenantId).toBe(TENANT_ID);
    // 1 completed / (1 completed + 1 failed) terminal runs — the still-`running` run excluded.
    expect(metrics.workflowSuccessRate).toBeCloseTo(0.5, 5);
    expect(metrics.retryRate).toBeCloseTo(1 / 3, 5); // 1 retried (attempts>1) of 3 terminal steps
    expect(metrics.humanInterventionRate).toBeCloseTo(1 / 3, 5);
    expect(metrics.receiptCompleteness).toBeCloseTo(0.5, 5);
    expect(metrics.reconciliationBacklog).toBe(1);
    expect(metrics.dlqDepth).toBe(1);
    expect(metrics.stepLatencyMs.sampleSize).toBe(2); // step_a + step_b, both completed
    expect(metrics.stepLatencyMs.p50).not.toBeNull();
  });

  it("returns null (not zero) for rates with no denominator, instead of guessing", async () => {
    const metrics = await reliability(OTHER_TENANT_ID, 30);
    expect(metrics.workflowSuccessRate).toBeNull();
    expect(metrics.retryRate).toBeNull();
    expect(metrics.humanInterventionRate).toBeNull();
    expect(metrics.receiptCompleteness).toBeNull();
    expect(metrics.reconciliationBacklog).toBe(0);
    expect(metrics.dlqDepth).toBe(0);
  });

  it("GET /api/read-models/reliability requires auth and is tenant-scoped", async () => {
    const anonRes = await GET(new Request("http://localhost/api/read-models/reliability"), { params: { view: "reliability" } });
    expect(anonRes.status).toBe(401);

    const res = await GET(req(TENANT_ID, "?windowDays=30"), { params: { view: "reliability" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tenantId).toBe(TENANT_ID);
    expect(body.data.reconciliationBacklog).toBe(1);

    const otherRes = await GET(req(OTHER_TENANT_ID, "?windowDays=30"), { params: { view: "reliability" } });
    const otherBody = await otherRes.json();
    expect(otherBody.data.reconciliationBacklog).toBe(0);
  });
});
