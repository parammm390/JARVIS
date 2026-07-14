// LangGraph proof slice (Part 1 of the engine-upgrade plan): schedule_water_test routed
// through the new graph engine must reproduce every guarantee full-flow.test.ts already
// proves for the legacy GatedExecutor — PLUS the actual point of this migration: a
// human approval must still resume correctly even when the process that gated the
// action is gone and a completely fresh executor/checkpointer/graph instance (sharing
// no in-memory state with the first) is the one that resumes it.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, getPool, domainActions, domainPolicies, actionLog } from "@finnor/db";
import {
  FinnorOrchestrator,
  AllowlistExecutor,
  LangGraphExecutor,
  GatedExecutor,
  buildGateGraph,
  createDefaultPluginRegistry,
} from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import { eq } from "drizzle-orm";
import type { DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const GRAPH_ACTION_TYPES = new Set(["schedule_water_test"]);

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

// Mock tool registry: succeeds like GHL would, and records every call so we can assert
// the confirmation gate let NOTHING through before approval — identical harness to
// full-flow.test.ts, so any difference in observable behavior is attributable to the
// engine swap, not a different test setup.
function mockTools() {
  const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const reg = new ToolRegistry();
  for (const name of ["ghl_create_contact", "ghl_book_appointment", "ghl_send_sms"]) {
    reg.register({
      name,
      description: "mock",
      integration: "mock-ghl",
      inputSchema: z.object({}).passthrough(),
      async run(input) {
        calls.push({ tool: name, input });
        return { contactId: "mock-contact-1", booked: true, sent: true };
      },
    });
  }
  return { reg, calls };
}

/** Builds a fresh orchestrator wired to a brand-new graph/checkpointer instance —
 *  never reusing the module-level getCheckpointer() singleton — so "construct a fresh
 *  instance" in the restart-proof test genuinely shares no in-memory state with the
 *  instance that gated the action, matching what a real process restart would look like. */
function freshGraphOrchestrator(tools: ToolRegistry): FinnorOrchestrator {
  const plugins = createDefaultPluginRegistry();
  const checkpointer = new PostgresSaver(getPool(), undefined, { schema: "finnor_langgraph" });
  const graph = buildGateGraph(plugins, tools, checkpointer);
  const executor = new AllowlistExecutor(new GatedExecutor(plugins, tools), new LangGraphExecutor(graph), GRAPH_ACTION_TYPES);
  return new FinnorOrchestrator({ plugins, tools, executor });
}

async function createDraftAction(actionType: string, payload: Record<string, unknown>): Promise<DomainAction> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [policy] = await db.select().from(domainPolicies).where(eq(domainPolicies.actionType, actionType)).limit(1);
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: SEED_TENANT_ID, actionType, payload, policyId: policy?.id ?? null, status: "draft" })
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
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [row] = await db.select().from(domainActions).where(eq(domainActions.id, id));
    return row!;
  });
}

async function getLogSteps(id: string): Promise<string[]> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const rows = await db.select().from(actionLog).where(eq(actionLog.domainActionId, id));
    return rows.map((r) => r.step);
  });
}

describe.skipIf(!available)("LangGraph gate flow — schedule_water_test on the new engine", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
    await new PostgresSaver(getPool(), undefined, { schema: "finnor_langgraph" }).setup();
  });
  afterAll(async () => {
    await closePool();
  });

  it("gates before any tool call, executes after approve via decide(), audits every step — same guarantees as the legacy engine", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = freshGraphOrchestrator(reg);

    const action = await createDraftAction("schedule_water_test", {
      address: "412 Maple Ridge Rd, Cedar Falls, IA",
      contactPhone: "+13195550142",
      contactName: "The Hendersons",
      requestedAt: "2026-07-20T10:00:00Z",
    });

    const policy = await orchestrator.loadPolicy(action);
    const gated = await orchestrator.executor.execute(action, policy);
    expect(gated.output.gated).toBe(true);
    expect(calls).toHaveLength(0); // nothing ran before the gate cleared
    expect((await getAction(action.id)).status).toBe("pending");
    expect((await getAction(action.id)).summary).toContain("412 Maple Ridge Rd");

    const result = await orchestrator.decide(action.id, SEED_TENANT_ID, "approve", "test:owner");
    expect(result.status).toBe("success");
    expect(calls.map((c) => c.tool)).toEqual(["ghl_create_contact", "ghl_book_appointment"]);
    expect((await getAction(action.id)).status).toBe("completed");

    const steps = await getLogSteps(action.id);
    for (const s of ["validate", "draft", "gate", "confirmed", "execute"]) {
      expect(steps).toContain(s);
    }
  });

  it("reject halts execution permanently: no tool ever fires, thread is closed not left dangling", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = freshGraphOrchestrator(reg);

    const action = await createDraftAction("schedule_water_test", {
      address: "88 Birchwood Ln, Cedar Falls, IA",
      contactPhone: "+13195550177",
      contactName: "Ruth Alvarez",
    });
    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy);
    expect((await getAction(action.id)).status).toBe("pending");

    const result = await orchestrator.decide(action.id, SEED_TENANT_ID, "reject", "test:owner");
    expect(result.status).toBe("success");
    expect((await getAction(action.id)).status).toBe("rejected");
    expect(calls).toHaveLength(0);

    // Idempotent: deciding an already-rejected action again is a safe no-op.
    const again = await orchestrator.decide(action.id, SEED_TENANT_ID, "reject", "test:owner");
    expect(again.output.idempotent).toBe(true);
  });

  it("THE ACTUAL POINT: a gate survives a full instance restart — a completely fresh executor/checkpointer/graph, sharing no in-memory state with the one that gated the action, resumes it correctly purely from Postgres", async () => {
    const { reg: gatingTools } = mockTools();
    const gatingOrchestrator = freshGraphOrchestrator(gatingTools);

    const action = await createDraftAction("schedule_water_test", {
      address: "1 LangGraph Test Way, Cedar Falls, IA",
      contactPhone: "+19995551234",
      contactName: "LangGraph Restart Test Subject",
    });
    const policy = await gatingOrchestrator.loadPolicy(action);
    const gated = await gatingOrchestrator.executor.execute(action, policy);
    expect(gated.output.gated).toBe(true);
    expect((await getAction(action.id)).status).toBe("pending");

    // "Restart": a brand-new mock tool registry, brand-new plugin registry, brand-new
    // PostgresSaver, brand-new compiled graph, brand-new executor, brand-new
    // orchestrator — nothing here is the same JS object as above. The only thing
    // connecting them is the tenant/action IDs and the shared Postgres database.
    const { reg: resumeTools, calls: resumeCalls } = mockTools();
    const resumeOrchestrator = freshGraphOrchestrator(resumeTools);

    const result = await resumeOrchestrator.decide(action.id, SEED_TENANT_ID, "approve", "test:owner-after-restart");
    expect(result.status).toBe("success");
    expect(resumeCalls.map((c) => c.tool)).toEqual(["ghl_create_contact", "ghl_book_appointment"]);
    expect((await getAction(action.id)).status).toBe("completed");
  });
});
