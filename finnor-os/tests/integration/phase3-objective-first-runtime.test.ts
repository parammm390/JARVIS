import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  businessEffects,
  closePool,
  domainActions,
  households,
  tasks,
  tenants,
  users,
  withTenant,
  workAggregate,
  workEventWaits,
  workEvents,
} from "@finnor/db";
import type { BusinessEffectSet, ObjectiveSuccessCondition } from "@finnor/shared-types";
import {
  controlWorkObjective,
  FinnorOrchestrator,
  recordBusinessEffectOutcome,
  type ObjectiveDecision,
  type ObjectiveDecisionPlanner,
  type ObjectiveInspection,
} from "@finnor/orchestration";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

class ScriptedPlanner implements ObjectiveDecisionPlanner {
  providerName = "phase3-outcome-contract-test";
  calls = 0;
  constructor(private readonly script: Array<ObjectiveDecision | ((inspection: ObjectiveInspection) => ObjectiveDecision)>) {}
  async decide(input: { inspection: ObjectiveInspection }): Promise<ObjectiveDecision> {
    const decision = this.script[this.calls++];
    if (!decision) throw new Error("Phase 3 scripted planner exhausted");
    return typeof decision === "function" ? decision(input.inspection) : decision;
  }
}

describe.skipIf(!available)("Phase 3 objective-first business outcome runtime", () => {
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  const subjectId = randomUUID();
  const taskId = randomUUID();
  const ctx = { tenantId, userId: ownerId, employeeId: ownerId, role: "owner" as const };

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.SECRETS_PROVIDER = "env";
    process.env.FINNOR_ENVIRONMENT = "test";
    await migrate(DB_URL);
    await withTenant(tenantId, async (db) => {
      await db.insert(tenants).values({ id: tenantId, name: "Phase 3 Outcome Contract Dealer" });
      await db.insert(users).values({ id: ownerId, tenantId, email: `phase3-objective-${ownerId}@example.test`, role: "owner", displayName: "Outcome Owner" });
      await db.insert(tasks).values({ id: taskId, tenantId, subjectType: "installation", subjectId, title: "Unstick Peterson installation", status: "open" });
    });
  });

  afterAll(async () => { await closePool(); });

  it("keeps Work open until the persisted canonical business condition becomes true", async () => {
    const successCondition: ObjectiveSuccessCondition = {
      version: 1,
      statement: "The scoped installation task is recorded done in canonical business state.",
      mode: "all",
      source: "explicit",
      criteria: [
        { kind: "no_open_execution" },
        { kind: "all_objective_effects_verified", minimumCount: 0 },
        {
          kind: "canonical_query",
          request: { intent: "business_state" },
          assertion: { path: ["operations", "tasks"], operator: "array_contains", expected: { status: "done", count: 1 } },
        },
      ],
    };
    const complete: ObjectiveDecision = { kind: "complete", outcome: { installation: "operational" }, reason: "Request deterministic outcome verification." };
    const runtime = new FinnorOrchestrator({ objectiveDecisionPlanner: new ScriptedPlanner([complete, complete]) });
    const started = await runtime.startObjective("Get Peterson's installation unstuck.", ctx, {
      idempotencyKey: `phase3-verified-completion:${randomUUID()}`,
      successCondition,
      maxSteps: 4,
      maxQueries: 4,
    });

    expect(await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId })).toBe("continue");
    let aggregate = await workAggregate(tenantId, started.workId);
    expect(aggregate!.objectiveLoop).toMatchObject({ state: "continue", successVerification: { state: "unsatisfied" }, successVerifiedAt: null });
    expect((aggregate!.work as { status: string }).status).not.toBe("completed");

    await withTenant(tenantId, (db) => db.update(tasks).set({ status: "done", updatedAt: new Date() }).where(eq(tasks.id, taskId)));
    expect(await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId })).toBe("completed");
    aggregate = await workAggregate(tenantId, started.workId);
    expect(aggregate!.objectiveLoop).toMatchObject({ state: "completed", successVerification: { state: "verified" }, successVerifiedAt: expect.any(Date) });
    expect((aggregate!.work as { status: string }).status).toBe("completed");
  });

  it("rejects provider success when the exact Business Effect has no observable business outcome", async () => {
    const runtime = new FinnorOrchestrator({ objectiveDecisionPlanner: new ScriptedPlanner([
      (inspection) => {
        const effect = (inspection.businessEffects as Array<{ id: string }>)[0]!;
        return { kind: "complete", outcome: { sent: true }, evidence: [{ kind: "business_effect", businessEffectId: effect.id }], reason: "The provider reported success." };
      },
    ]) });
    const started = await runtime.startObjective("Send this customer follow-up and verify the actual contact outcome.", ctx, {
      idempotencyKey: `phase3-false-provider-completion:${randomUUID()}`,
      maxSteps: 3,
    });
    const actionId = randomUUID();
    const effectId = randomUUID();
    const householdId = randomUUID();
    const semanticHash = randomUUID().replaceAll("-", "").repeat(2);
    const scopeHash = randomUUID().replaceAll("-", "").repeat(2);
    const effect: BusinessEffectSet = {
      id: effectId,
      schemaVersion: 1,
      semanticHash,
      scopeHash,
      source: { domainActionId: actionId, actionType: "send_follow_up", workId: started.workId, objectiveStepId: null },
      mode: "consequential",
      operation: { name: "send_follow_up", class: "external_side_effect", external: true },
      targets: [{ kind: "entity", type: "household", id: householdId, sourcePath: "householdId" }],
      bindings: [],
      preconditions: [],
      before: [],
      delta: { operation: "send_follow_up", values: { householdId } },
      expected: { observation: "provider_delivery", state: null },
      exposure: null,
      authority: { capability: "action:send_follow_up", risk: "high", policyId: null, policyVersion: null },
      approval: { required: true, typedConfirmation: false, summary: "Send one governed follow-up." },
      reversibility: { classification: "irreversible", compensationCapability: null },
      uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
      provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: new Date().toISOString(), replacementForEffectId: null, compensationForEffectId: null },
    };
    await withTenant(tenantId, async (db) => {
      await db.insert(households).values({ id: householdId, tenantId, address: "19 Unverified Outcome Lane", contactInfo: { name: "Provider Only" } });
      await db.insert(domainActions).values({ id: actionId, tenantId, actionType: "send_follow_up", payload: { householdId }, status: "completed", workId: started.workId, initiatedBy: ownerId });
      await db.insert(businessEffects).values({ id: effectId, tenantId, domainActionId: actionId, semanticHash: effect.semanticHash, scopeHash: effect.scopeHash, operationClass: effect.operation.class, effect, status: "executing" });
      await db.update(domainActions).set({ businessEffectId: effectId }).where(eq(domainActions.id, actionId));
    });
    const verification = await recordBusinessEffectOutcome(tenantId, effect, { status: "success", output: { providerAccepted: true, providerMessageId: "provider-only-proof" } });
    expect(verification.state).toBe("partially_verified");

    expect(await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId })).toBe("continue");
    const aggregate = await workAggregate(tenantId, started.workId);
    expect(aggregate!.objectiveLoop).toMatchObject({ state: "continue", successVerification: { state: "unsatisfied" } });
    expect((aggregate!.work as { status: string }).status).not.toBe("completed");
  });

  it("makes explicit cancellation terminal, closes its durable wait, and is idempotent", async () => {
    const runtime = new FinnorOrchestrator({ objectiveDecisionPlanner: new ScriptedPlanner([{
      kind: "wait",
      resumeAt: new Date(Date.now() + 60_000).toISOString(),
      condition: "the bounded response window ends",
      reason: "No compute should be consumed while waiting.",
    }]) });
    const started = await runtime.startObjective("Wait for the bounded window, then re-inspect.", ctx, { idempotencyKey: `phase3-cancel:${randomUUID()}` });
    expect(await runtime.runObjectiveIteration({ tenantId, workId: started.workId, objectiveLoopId: started.objectiveLoopId })).toBe("waiting");
    const cancelled = await controlWorkObjective({ tenantId, workId: started.workId, command: "cancel", actorId: ownerId });
    expect(cancelled).toMatchObject({ state: "cancelled", cancelledAt: expect.any(Date) });
    const eventCount = ((await workAggregate(tenantId, started.workId))!.events as unknown[]).length;
    expect((await controlWorkObjective({ tenantId, workId: started.workId, command: "cancel", actorId: ownerId })).state).toBe("cancelled");
    const aggregate = await workAggregate(tenantId, started.workId);
    expect((aggregate!.work as { status: string }).status).toBe("cancelled");
    expect(aggregate!.eventWaits).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(aggregate!.events as unknown[]).toHaveLength(eventCount);
    const waits = await withTenant(tenantId, (db) => db.select().from(workEventWaits).where(eq(workEventWaits.objectiveLoopId, started.objectiveLoopId)));
    expect(waits).toEqual([expect.objectContaining({ status: "cancelled", cancelledAt: expect.any(Date) })]);
    const cancellationEvents = await withTenant(tenantId, (db) => db.select().from(workEvents).where(eq(workEvents.workId, started.workId)));
    expect(cancellationEvents.filter((event) => event.eventType === "objective_cancel")).toHaveLength(1);
  });
});
