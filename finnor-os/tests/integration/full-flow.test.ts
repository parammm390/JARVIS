// THE safety-critical integration test (§23): instruction → plan → confirmation-required
// draft → approve → execute → audit log entry, against a test tenant, for BOTH
// schedule_water_test and renew_maintenance_agreement. Requires Postgres (docker-compose
// or CI service). Skips cleanly when no database is reachable.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { z } from "zod";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainActions, domainPolicies, actionLog } from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { ToolRegistry } from "@finnor/tools";
import { appendEpisode } from "@finnor/memory";
import { and, eq } from "drizzle-orm";
import type { DomainAction, TenantContext } from "@finnor/shared-types";

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

// Mock tool registry: succeeds like GHL would, and records every call so we can assert
// the confirmation gate let NOTHING through before approval.
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

const ctx: TenantContext = {
  tenantId: SEED_TENANT_ID,
  userId: "00000000-0000-4000-8000-0000000000aa",
  role: "owner",
};

async function createDraftAction(actionType: string, payload: Record<string, unknown>): Promise<DomainAction> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [policy] = await db
      .select()
      .from(domainPolicies)
      .where(eq(domainPolicies.actionType, actionType))
      .limit(1);
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

/** Mirrors POST /actions/:id/confirm semantics: audit row FIRST, then approve, then run. */
async function approveAndRun(orchestrator: FinnorOrchestrator, actionId: string) {
  await appendEpisode(SEED_TENANT_ID, actionId, "confirmed", { by: ctx.userId, role: ctx.role }, {});
  await withTenant(SEED_TENANT_ID, (db) =>
    db.update(domainActions).set({ status: "approved" }).where(eq(domainActions.id, actionId)),
  );
  return orchestrator.runAction(actionId, SEED_TENANT_ID);
}

describe.skipIf(!available)("full gated flow (§32.6, §32.11)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });

  afterAll(async () => {
    await closePool();
  });

  it("schedule_water_test: gates before any tool call, executes after approve, audits every step", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });

    const action = await createDraftAction("schedule_water_test", {
      address: "412 Maple Ridge Rd, Cedar Falls, IA",
      contactPhone: "+13195550142",
      contactName: "The Hendersons",
      requestedAt: "2026-07-20T10:00:00Z",
    });

    // Executor must halt at the gate: pending status, ZERO tool calls (§32.6).
    const policy = await orchestrator.loadPolicy(action);
    const gated = await orchestrator.executor.execute(action, policy);
    expect(gated.output.gated).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await getAction(action.id)).status).toBe("pending");
    expect((await getAction(action.id)).summary).toContain("412 Maple Ridge Rd");

    // Approve → execution actually happens.
    const result = await approveAndRun(orchestrator, action.id);
    expect(result.status).toBe("success");
    expect(calls.map((c) => c.tool)).toEqual(["ghl_create_contact", "ghl_book_appointment"]);
    expect((await getAction(action.id)).status).toBe("completed");

    // Audit trail: validate, draft, gate, confirmed, execute all present (§32.11).
    const steps = await getLogSteps(action.id);
    for (const s of ["validate", "draft", "gate", "confirmed", "execute", "reflection"]) {
      expect(steps).toContain(s);
    }
  });

  it("renew_maintenance_agreement: same gate, same guarantees", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });

    const action = await createDraftAction("renew_maintenance_agreement", {
      householdLabel: "The Hendersons",
      contactPhone: "+13195550142",
      cadence: "annual",
    });

    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy);
    expect(calls).toHaveLength(0);
    expect((await getAction(action.id)).status).toBe("pending");

    const result = await approveAndRun(orchestrator, action.id);
    expect(result.status).toBe("success");
    expect(calls.map((c) => c.tool)).toEqual(["ghl_create_contact", "ghl_send_sms"]);
    expect((await getAction(action.id)).status).toBe("completed");
  });

  it("reject halts execution permanently: no tool ever fires", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });

    const action = await createDraftAction("renew_maintenance_agreement", {
      householdLabel: "Ruth Alvarez",
      contactPhone: "+13195550177",
      cadence: "annual",
    });
    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy);

    // Reject (audit first, §19).
    await appendEpisode(SEED_TENANT_ID, action.id, "rejected", { by: ctx.userId }, { reason: "not now" });
    await withTenant(SEED_TENANT_ID, (db) =>
      db.update(domainActions).set({ status: "rejected" }).where(eq(domainActions.id, action.id)),
    );

    // Attempting to run a rejected action must refuse.
    const result = await orchestrator.runAction(action.id, SEED_TENANT_ID);
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/confirmation gate/);
    expect(calls).toHaveLength(0);
  });

  it("failing integration → retry once → escalate to needs_human_review, never silent (§9, §30)", async () => {
    const reg = new ToolRegistry();
    let attempts = 0;
    reg.register({
      name: "ghl_create_contact",
      description: "always-down mock",
      integration: "mock-ghl",
      inputSchema: z.object({}).passthrough(),
      retryPolicy: { attempts: 1, baseDelayMs: 1, timeoutMs: 500 },
      async run() {
        attempts++;
        throw new Error("GHL is down");
      },
    });
    const orchestrator = new FinnorOrchestrator({ tools: reg });

    const action = await createDraftAction("renew_maintenance_agreement", {
      householdLabel: "The Hendersons",
      contactPhone: "+13195550142",
      cadence: "annual",
    });
    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy);
    await approveAndRun(orchestrator, action.id);

    const row = await getAction(action.id);
    expect(row.status).toBe("needs_human_review");
    expect(attempts).toBeGreaterThanOrEqual(2); // original + exactly one reflection retry
    const steps = await getLogSteps(action.id);
    expect(steps).toContain("reflection_retry");
  });
});

describe.skipIf(!available)("action_log immutability (§19)", () => {
  it("UPDATE and DELETE on action_log are rejected by the database itself", async () => {
    const action = await createDraftAction("renew_maintenance_agreement", {
      householdLabel: "x",
      contactPhone: "+13195550100",
      cadence: "annual",
    });
    await appendEpisode(SEED_TENANT_ID, action.id, "test_step", {}, {});
    await expect(
      withTenant(SEED_TENANT_ID, (db) =>
        db.update(actionLog).set({ step: "tampered" }).where(eq(actionLog.domainActionId, action.id)),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withTenant(SEED_TENANT_ID, (db) => db.delete(actionLog).where(eq(actionLog.domainActionId, action.id))),
    ).rejects.toThrow(/append-only/);
  });
});
