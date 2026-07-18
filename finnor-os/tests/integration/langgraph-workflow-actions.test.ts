// Phase 13 Part A restart proof. Per ground-truth §7-8 in
// docs/jarvis-99-phase-10-16-execution-plan.md, putting a vertical-workflow action
// type on the LangGraph engine only checkpoints the GATE around it — the durable
// workflow-runtime machinery (commands/workflow_runs/workflow_steps, leases, outbox)
// underneath stays untouched. What this test proves is that the gate itself survives
// a genuine process boundary: paused at the gate on one orchestrator instance, a
// completely fresh orchestrator/executor/graph/checkpointer instance (sharing no
// in-memory state, only the same Postgres) resumes it, and the plugin's submitCommand
// fires exactly once even though it's now being invoked from a brand-new process's
// perspective. This mirrors langgraph-gate-flow.test.ts's structure and IS an honest
// process-restart equivalent for checkpoint state: no in-memory object is reused
// between the "before" and "after" halves of each test, only actionId/tenantId and
// the shared database — a real process.kill/respawn would observe nothing more.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { migrate } from "../../packages/db/migrate";
import {
  withTenant,
  closePool,
  getPool,
  tenants,
  households,
  invoices,
  domainActions,
  domainPolicies,
  actionLog,
  commands,
  workflowRuns,
} from "@finnor/db";
import {
  FinnorOrchestrator,
  AllowlistExecutor,
  LangGraphExecutor,
  GatedExecutor,
  buildGateGraph,
  createDefaultPluginRegistry,
} from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import { eq, and } from "drizzle-orm";
import type { DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000fe";
const GRAPH_ACTION_TYPES = new Set(["start_invoice_to_cash_workflow"]);

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

/** Builds a fresh orchestrator wired to a brand-new graph/checkpointer instance —
 *  never reusing any module-level singleton — so "construct a fresh instance" in the
 *  restart-proof test genuinely shares no in-memory state with whatever gated the
 *  action, matching what a real process restart would look like. Same pattern as
 *  langgraph-gate-flow.test.ts's freshGraphOrchestrator(). */
function freshGraphOrchestrator(): FinnorOrchestrator {
  const plugins = createDefaultPluginRegistry();
  const tools = new ToolRegistry();
  const checkpointer = new PostgresSaver(getPool(), undefined, { schema: "finnor_langgraph" });
  const graph = buildGateGraph(plugins, tools, checkpointer);
  const executor = new AllowlistExecutor(new GatedExecutor(plugins, tools), new LangGraphExecutor(graph), GRAPH_ACTION_TYPES);
  return new FinnorOrchestrator({ plugins, tools, executor });
}

async function seedInvoice(): Promise<{ householdId: string; invoiceId: string }> {
  return withTenant(TENANT_ID, async (db) => {
    const [hh] = await db.insert(households).values({ tenantId: TENANT_ID, address: "1 Restart Proof Way", contactInfo: {} }).returning();
    const [inv] = await db.insert(invoices).values({ tenantId: TENANT_ID, householdId: hh!.id, amountUsd: "425.00", status: "sent" }).returning();
    return { householdId: hh!.id, invoiceId: inv!.id };
  });
}

async function createDraftAction(payload: Record<string, unknown>): Promise<DomainAction> {
  return withTenant(TENANT_ID, async (db) => {
    const [policy] = await db.select().from(domainPolicies).where(and(eq(domainPolicies.tenantId, TENANT_ID), eq(domainPolicies.actionType, "start_invoice_to_cash_workflow"))).limit(1);
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: TENANT_ID, actionType: "start_invoice_to_cash_workflow", payload, policyId: policy?.id ?? null, status: "draft" })
      .returning();
    return {
      id: row!.id,
      tenantId: row!.tenantId,
      actionType: row!.actionType,
      payload: row!.payload as Record<string, unknown>,
      policyId: row!.policyId,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
    };
  });
}

async function getAction(id: string) {
  return withTenant(TENANT_ID, async (db) => {
    const [row] = await db.select().from(domainActions).where(eq(domainActions.id, id));
    return row!;
  });
}

async function countLogSteps(actionId: string, step: string): Promise<number> {
  return withTenant(TENANT_ID, async (db) => {
    const rows = await db.select().from(actionLog).where(and(eq(actionLog.domainActionId, actionId), eq(actionLog.step, step)));
    return rows.length;
  });
}

async function countCommands(idempotencyKey: string): Promise<number> {
  return withTenant(TENANT_ID, async (db) => {
    const rows = await db.select().from(commands).where(and(eq(commands.tenantId, TENANT_ID), eq(commands.idempotencyKey, idempotencyKey)));
    return rows.length;
  });
}

describe.skipIf(!available)("LangGraph restart proof — start_invoice_to_cash_workflow on the graph engine", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Phase 13 Restart Proof Dealer" }).onConflictDoNothing());
    // Idempotent — creates the finnor_langgraph checkpoint schema/tables if a prior
    // suite run (or `npm run setup:langgraph`) hasn't already.
    await new PostgresSaver(getPool(), undefined, { schema: "finnor_langgraph" }).setup();
  });
  afterAll(async () => {
    await closePool();
  });

  it("gate survives a full instance restart: paused on instance A, approved through a brand-new instance B, submitCommand fires exactly once, re-approve is idempotent", async () => {
    const gatingOrchestrator = freshGraphOrchestrator();
    const { invoiceId } = await seedInvoice();
    const idempotencyKey = `invoice-to-cash:${invoiceId}`;

    const action = await createDraftAction({ invoiceId });
    const policy = await gatingOrchestrator.loadPolicy(action);
    expect(policy.requiresConfirmation).toBe(true); // no policy row seeded for this tenant → default-deny fallback

    const gated = await gatingOrchestrator.executor.execute(action, policy);
    expect(gated.output.gated).toBe(true);
    expect((await getAction(action.id)).status).toBe("pending");
    // Nothing submitted yet — the gate wraps only the SUBMISSION (ground-truth §8),
    // and it hasn't cleared.
    expect(await countCommands(idempotencyKey)).toBe(0);

    // "Restart": brand-new plugin registry, tool registry, PostgresSaver, compiled
    // graph, executor, orchestrator. Nothing here is the same JS object as above —
    // only the tenant/action IDs and the shared Postgres database connect them.
    const resumeOrchestratorA = freshGraphOrchestrator();
    const result = await resumeOrchestratorA.decide(action.id, TENANT_ID, "approve", "test:owner-after-restart");
    expect(result.status).toBe("success");
    expect((await getAction(action.id)).status).toBe("completed");

    // (a) resumed from the checkpoint, not re-derived: exactly one validate and one
    // draft episode — a re-run from the top would have produced two of each.
    expect(await countLogSteps(action.id, "validate")).toBe(1);
    expect(await countLogSteps(action.id, "draft")).toBe(1);

    // (b) the plugin's submitCommand fired exactly once for this invoice's
    // idempotencyKey — the double-fire check the restart is actually guarding against.
    expect(await countCommands(idempotencyKey)).toBe(1);
    const runRow = await withTenant(TENANT_ID, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.tenantId, TENANT_ID)));
    const thisRun = runRow.find((r) => r.workflowType === "invoice_to_cash");
    expect(thisRun).toBeDefined();

    // (c) a second decide(approve) — via yet another fresh instance — is idempotent:
    // no second submitCommand, action stays completed.
    const resumeOrchestratorB = freshGraphOrchestrator();
    const again = await resumeOrchestratorB.decide(action.id, TENANT_ID, "approve", "test:owner-second-attempt");
    expect(again.output.idempotent).toBe(true);
    expect((await getAction(action.id)).status).toBe("completed");
    expect(await countCommands(idempotencyKey)).toBe(1);
  });

  it("reject path: thread closed via a fresh instance, no commands row ever created", async () => {
    const gatingOrchestrator = freshGraphOrchestrator();
    const { invoiceId } = await seedInvoice();
    const idempotencyKey = `invoice-to-cash:${invoiceId}`;

    const action = await createDraftAction({ invoiceId });
    const policy = await gatingOrchestrator.loadPolicy(action);
    const gated = await gatingOrchestrator.executor.execute(action, policy);
    expect(gated.output.gated).toBe(true);
    expect((await getAction(action.id)).status).toBe("pending");

    const resumeOrchestrator = freshGraphOrchestrator();
    const result = await resumeOrchestrator.decide(action.id, TENANT_ID, "reject", "test:owner-after-restart");
    expect(result.status).toBe("success");
    expect((await getAction(action.id)).status).toBe("rejected");
    expect(await countCommands(idempotencyKey)).toBe(0);

    // Idempotent on the reject side too.
    const again = await resumeOrchestrator.decide(action.id, TENANT_ID, "reject", "test:owner-second-attempt");
    expect(again.output.idempotent).toBe(true);
  });
});
