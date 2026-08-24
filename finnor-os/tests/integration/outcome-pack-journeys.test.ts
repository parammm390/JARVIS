import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  appointments,
  businessEffects,
  closePool,
  domainActions,
  households,
  invoices,
  outcomePackRuns,
  tenants,
  users,
  withTenant,
  workflowSteps,
  workAggregate,
  workOrders,
} from "@finnor/db";
import {
  FinnorOrchestrator,
  startOutcomePack,
  type ObjectiveDecision,
  type ObjectiveDecisionPlanner,
  type ObjectiveInspection,
} from "@finnor/orchestration";
import type { ObjectiveSuccessCondition, OutcomePackId } from "@finnor/shared-types";
import { runWorkflowStep } from "../../apps/worker/src/handlers/run-workflow-step";
import { citeObservedObjectiveEvidence } from "./helpers/objective-completion-evidence";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
process.env.DATABASE_URL = DB_URL;

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

class EffectThenCompletePlanner implements ObjectiveDecisionPlanner {
  providerName = "phase5-five-pack-certifier";
  calls = 0;
  constructor(private householdId: string) {}

  async decide({ inspection }: { inspection: ObjectiveInspection }): Promise<ObjectiveDecision> {
    this.calls += 1;
    const decision: ObjectiveDecision = this.calls === 1
      ? {
          kind: "action",
          actionType: "send_follow_up",
          payload: {
            householdId: this.householdId,
            context: "the exact certified Phase 5 outcome scope",
          },
          reason: "Perform one exact governed customer effect before evaluating the externally observed terminal state.",
          nextStep: "Re-inspect canonical outcome truth.",
        }
      : {
          kind: "complete",
          outcome: { verifiedPackJourney: true },
          reason: "The governed effect and exact canonical terminal outcome are now both observed.",
        };
    return citeObservedObjectiveEvidence(decision, inspection);
  }
}

describe.skipIf(!available).sequential("Phase 5 complete five-pack Objective journeys", () => {
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  const householdId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();
  const ctx = { tenantId, userId: ownerId, employeeId: ownerId, role: "owner" as const };

  beforeAll(async () => {
    process.env.SECRETS_PROVIDER = "env";
    process.env.COMMS_MODE = "sandbox";
    process.env.FINNOR_ENVIRONMENT = "test";
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(tenantId, async (db) => {
      await db.insert(tenants).values({ id: tenantId, name: "Phase 5 Five Pack Dealer" });
      await db.insert(users).values({ id: ownerId, tenantId, email: `phase5-five-pack-${tenantId}@example.test`, role: "owner" });
      await db.insert(households).values({ id: householdId, tenantId, address: "55 Outcome Certification Road", contactInfo: { name: "Five Pack Household", phone: "+15550105555" }, marketingConsent: true });
      await db.insert(workOrders).values({ id: workOrderId, tenantId, householdId, type: "install", status: "in_progress", scheduledAt: new Date() });
      await db.insert(invoices).values({ id: invoiceId, tenantId, householdId, amountUsd: "425.00", status: "overdue", dueDate: new Date(Date.now() - 86_400_000) });
    });
  });

  afterAll(async () => { await closePool(); });

  async function certifyJourney(packId: OutcomePackId, input: Record<string, unknown>, observeTerminalTruth: () => Promise<void>): Promise<void> {
    const runtime = new FinnorOrchestrator({ objectiveDecisionPlanner: new EffectThenCompletePlanner(householdId) });
    const started = await startOutcomePack(packId, { ...input, mode: "approval" }, ctx, { idempotencyKey: `phase5-five-pack:${packId}:${randomUUID()}` });
    expect(await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId })).toBe("awaiting_approval");
    const [action] = await withTenant(tenantId, (db) => db.select().from(domainActions).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.workId, started.workId))).limit(1));
    expect(action).toBeTruthy();
    expect(action?.status).toBe("pending");
    const approved = await runtime.decide(action!.id, tenantId, "approve", ownerId, { role: "owner" });
    expect(approved).toMatchObject({ status: "success", output: { queued: true, durable: true } });
    const [approvedStep] = await withTenant(tenantId, (db) => db.select().from(workflowSteps).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.domainActionId, action!.id))).limit(1));
    expect(approvedStep).toBeTruthy();
    await runWorkflowStep({ tenantId, workflowStepId: approvedStep!.id });
    await observeTerminalTruth();
    let terminal = await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId });
    if (terminal === "continue") terminal = await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId });
    if (terminal !== "completed") {
      const aggregate = await workAggregate(tenantId, started.workId);
      throw new Error(`Pack ${packId} did not verify: ${JSON.stringify(aggregate?.objectiveLoop?.successVerification)}`);
    }
    const state = await withTenant(tenantId, async (db) => ({
      pack: (await db.select().from(outcomePackRuns).where(eq(outcomePackRuns.workId, started.workId)).limit(1))[0],
      effect: (await db.select().from(businessEffects).where(eq(businessEffects.domainActionId, action!.id)).limit(1))[0],
    }));
    expect(state.effect?.status).toBe("verified");
    expect(state.pack).toMatchObject({ packId, status: "completed", finalVerification: { state: "verified" } });
  }

  it("certifies Lead → verified water-test booking against a confirmed canonical appointment", async () => {
    await certifyJourney("lead_to_verified_water_test_booking", { householdId }, async () => {
      await withTenant(tenantId, (db) => db.insert(appointments).values({
        tenantId,
        subjectType: "household",
        subjectId: householdId,
        status: "confirmed",
        scheduledAt: new Date(Date.now() + 86_400_000),
      }));
    });
  });

  it("certifies a stuck installation only after the exact work order is completed", async () => {
    await withTenant(tenantId, (db) => db.update(workOrders).set({ status: "in_progress", completedAt: null }).where(eq(workOrders.id, workOrderId)));
    await certifyJourney("stuck_installation_service_resolution", { target: { entityType: "work_order", entityId: workOrderId } }, async () => {
      await withTenant(tenantId, (db) => db.update(workOrders).set({ status: "completed", completedAt: new Date() }).where(eq(workOrders.id, workOrderId)));
    });
  });

  it("certifies overdue collection only after canonical invoice truth is paid", async () => {
    await withTenant(tenantId, (db) => db.update(invoices).set({ status: "overdue" }).where(eq(invoices.id, invoiceId)));
    await certifyJourney("overdue_receivable_collection", { invoiceId }, async () => {
      await withTenant(tenantId, (db) => db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId)));
    });
  });

  it("certifies the service-due lifecycle only after a confirmed canonical booking", async () => {
    await certifyJourney("service_due_lifecycle", { householdId, desiredOutcome: "booked" }, async () => {
      await withTenant(tenantId, (db) => db.insert(appointments).values({
        tenantId,
        subjectType: "household",
        subjectId: householdId,
        status: "confirmed",
        scheduledAt: new Date(Date.now() + 172_800_000),
      }));
    });
  });

  it("certifies a general bounded operator objective from an explicit canonical success contract", async () => {
    const successCondition: ObjectiveSuccessCondition = {
      version: 1,
      statement: "The exact installation work order is completed and every bounded effect is verified.",
      mode: "all",
      source: "explicit",
      criteria: [
        { kind: "no_open_execution" },
        { kind: "all_objective_effects_verified", minimumCount: 1 },
        {
          kind: "canonical_query",
          request: { intent: "company_context", anchor: { entityType: "work_order", entityId: workOrderId } },
          assertion: { path: ["context", "nodes"], operator: "array_contains", expected: { entityType: "work_order", entityId: workOrderId, status: "completed" } },
        },
        { kind: "decision_evidence", minimumCount: 1, accepted: ["canonical_query", "business_effect"] },
      ],
    };
    await certifyJourney("general_operator_objective", {
      objective: "Verify the completed installation and preserve exact governed evidence without expanding scope.",
      subjectRefs: [{ entityType: "work_order", entityId: workOrderId }],
      successCondition,
    }, async () => {
      await withTenant(tenantId, (db) => db.update(workOrders).set({ status: "completed", completedAt: new Date() }).where(eq(workOrders.id, workOrderId)));
    });
  });
});
