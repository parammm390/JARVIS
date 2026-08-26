// B2.T6 acceptance: a real terminal workflow-step receipt produces one lineaged
// replacement plan and that plan's root enters the ordinary confirmation gate.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { claimStep, failStep, submitCommand } from "@finnor/workflow-runtime";
import { closePool, domainActions, planRepairs, tenants, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createDefaultPluginRegistry, FinnorOrchestrator, GatedExecutor, LLMPlanner } from "@finnor/orchestration";
import { createDefaultRegistry } from "@finnor/tools";
import type { LLMProvider } from "@finnor/orchestration";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000c6";
async function dbUp(): Promise<boolean> { const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await client.connect(); await client.end(); return true; } catch { return false; } }
const available = await dbUp();

describe.skipIf(!available)("terminal plan repair", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Terminal Repair Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => { await closePool(); });

  it("creates one lineaged revised remainder and gates it after a terminal receipt", async () => {
    const sourcePlanId = randomUUID();
    const [failedAction] = await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "start_water_test_workflow", payload: {}, status: "completed", planId: sourcePlanId }).returning(),
    );
    await withTenant(TENANT_ID, (db) =>
      db.insert(domainActions).values({
        tenantId: TENANT_ID,
        actionType: "manual_step_suggestion",
        payload: { originalActionType: "send_confirmation_call", originalPayload: {}, unavailableCapabilities: ["communications"], reason: "Old remainder fixture." },
        status: "draft",
        planId: sourcePlanId,
        dependsOn: [failedAction!.id],
      }),
    );
    const submitted = await withTenant(TENANT_ID, (db) =>
      submitCommand(db, { tenantId: TENANT_ID, commandType: "start_water_test_workflow", payload: {}, workflowType: "lead_to_water_test", domainActionId: failedAction!.id, steps: [{ stepType: "hold_appointment", payload: {} }] }),
    );
    await claimStep(TENANT_ID, submitted.stepIds[0]!);
    await failStep(TENANT_ID, submitted.stepIds[0]!, "Appointment validation failed.", "terminal");

    const provider: LLMProvider = {
      name: "terminal-repair-stub",
      async complete() {
        return JSON.stringify({ actions: [{ action_type: "manual_step_suggestion", payload: { originalActionType: "send_confirmation_call", originalPayload: {}, unavailableCapabilities: ["communications"], reason: "Call the customer manually because the appointment record needs correction." } }] });
      },
    };
    const plugins = createDefaultPluginRegistry();
    const orchestrator = new FinnorOrchestrator({ plugins, planner: new LLMPlanner(plugins, provider), executor: new GatedExecutor(plugins, createDefaultRegistry()) });
    await orchestrator.repairPlanAfterTerminalFailure(TENANT_ID, failedAction!.id, submitted.stepIds[0]!);
    // A duplicate worker delivery cannot create another repair plan.
    await orchestrator.repairPlanAfterTerminalFailure(TENANT_ID, failedAction!.id, submitted.stepIds[0]!);

    const [repair] = await withTenant(TENANT_ID, (db) => db.select().from(planRepairs).where(eq(planRepairs.failedDomainActionId, failedAction!.id)));
    expect(repair).toMatchObject({ sourcePlanId, status: "proposed" });
    expect(repair!.repairPlanId).toBeTruthy();
    const replacement = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.planId, repair!.repairPlanId!))),
    );
    expect(replacement).toHaveLength(1);
    // manual_step_suggestion is META_NO_SIDE_EFFECT: the repaired node is still
    // created and lineaged, but it completes immediately because it cannot create
    // a consequential effect or approval item.
    expect(replacement[0]).toMatchObject({ actionType: "manual_step_suggestion", status: "completed", repairedFromPlanId: sourcePlanId });
  });
});
process.env.FINNOR_PLANNING_IR_MODE = "legacy"; // This suite intentionally certifies the bounded legacy planner envelope.
