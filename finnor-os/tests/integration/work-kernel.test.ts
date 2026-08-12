import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  beginWorkPlannerAttempt,
  closePool,
  domainActions,
  finishWorkPlannerAttempt,
  receiveWork,
  tenants,
  transitionWork,
  withTenant,
  workAggregate,
} from "@finnor/db";
import { FinnorOrchestrator, type AnswerEnvelope, type Planner } from "@finnor/orchestration";
import { openReceipt, submitCommand } from "@finnor/workflow-runtime";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000092f2";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

describe.skipIf(!available)("Upgrade 2 durable Work kernel", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.SECRETS_PROVIDER = "env";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Work Kernel Test Dealer" }).onConflictDoNothing());
  });

  afterAll(async () => {
    await closePool();
  });

  it("claims intake exactly once and lets typed and voice inputs continue the same Work/context", async () => {
    const instructionId = randomUUID();
    const idempotencyKey = `work-kernel:${randomUUID()}`;
    const first = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Prepare the Peterson service visit",
      instructionId,
      idempotencyKey,
      sessionId: "shared-session",
      channel: "text",
      activeContext: { householdId: "household-a" },
    });
    const duplicate = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Prepare the Peterson service visit",
      instructionId,
      idempotencyKey,
      sessionId: "shared-session",
      channel: "text",
    });
    await transitionWork(TENANT_ID, first.workId, "failed", "planning_failed", { message: "test failure" });
    const continuation = await receiveWork({
      tenantId: TENANT_ID,
      workId: first.workId,
      instructionId: randomUUID(),
      idempotencyKey: `work-kernel:${randomUUID()}`,
      instruction: "Make that tomorrow morning",
      sessionId: "shared-session",
      channel: "voice",
      activeContext: { appointmentWindow: "morning" },
    });

    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({ workId: first.workId, workInputId: first.workInputId, duplicate: true });
    expect(continuation.workId).toBe(first.workId);
    const aggregate = await workAggregate(TENANT_ID, first.workId);
    expect(aggregate).not.toBeNull();
    expect((aggregate!.inputs as unknown[])).toHaveLength(2);
    expect((aggregate!.work as { status: string; sessionId: string; activeContext: Record<string, unknown> })).toMatchObject({
      status: "recovery",
      sessionId: "shared-session",
      activeContext: { householdId: "household-a", appointmentWindow: "morning" },
    });
    expect((aggregate!.events as Array<{ seq: number; eventType: string }>).map((event) => event.seq)).toEqual([1, 2, 3]);
    expect((aggregate!.events as Array<{ eventType: string }>).at(-1)?.eventType).toBe("recovery_input_received");
  });

  it("keeps a timed-out planner request durable and completes the same Work on an idempotent retry", async () => {
    let plannerCalls = 0;
    const planner: Planner = {
      async plan() {
        plannerCalls += 1;
        if (plannerCalls === 1) throw new Error("Planner timeout after deadline");
        return [];
      },
    };
    const answer: AnswerEnvelope = {
      kind: "answer",
      intent: "conversation",
      readOnly: true,
      spokenSummary: "I recovered the request and need one more detail.",
      display: { title: "JARVIS", facts: [] },
      evidence: [{ source: "test", ref: "retry", timestamp: "2026-08-12T00:00:00.000Z" }],
      asOf: "2026-08-12T00:00:00.000Z",
      freshness: { status: "fresh", observedAt: "2026-08-12T00:00:00.000Z" },
    };
    const orchestrator = new FinnorOrchestrator({
      planner,
      fastReadOnlyRouter: { classify: () => ({ route: "planner", reason: "unsupported" }), route: async () => null },
      conversationResponder: { answer: async () => answer },
    });
    const instructionId = randomUUID();
    const opts = { instructionId, idempotencyKey: `planner-failure:${randomUUID()}`, channel: "text" as const };

    await expect(orchestrator.handleInstructionResult("Schedule a service visit for the Petersons", {
      tenantId: TENANT_ID,
      userId: "system:test",
      role: "owner",
    }, opts)).rejects.toThrow("Planner timeout");

    const failed = await workAggregate(TENANT_ID, instructionId);
    expect((failed!.work as { status: string }).status).toBe("failed");
    expect(failed!.plannerAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "timed_out", attemptKey: `input:${instructionId}` }),
    ]));

    await transitionWork(TENANT_ID, instructionId, "recovery", "retry_requested", { source: "test" });
    const retry = await orchestrator.handleInstructionResult("Schedule a service visit for the Petersons", {
      tenantId: TENANT_ID,
      userId: "system:test",
      role: "owner",
    }, {
      workId: instructionId,
      workInputId: instructionId,
      instructionId,
      channel: "text",
      plannerAttemptKey: "retry:one",
    });

    expect(retry).toMatchObject({ workId: instructionId, instructionId, actions: [], answer });
    const completed = await workAggregate(TENANT_ID, instructionId);
    expect((completed!.work as { status: string }).status).toBe("completed");
    expect((completed!.plannerAttempts as Array<{ status: string; attemptKey: string }>)).toEqual([
      expect.objectContaining({ status: "timed_out", attemptKey: `input:${instructionId}` }),
      expect.objectContaining({ status: "succeeded", attemptKey: "retry:one" }),
    ]);
    expect((completed!.events as Array<{ toStatus: string }>).map((event) => event.toStatus)).toEqual(expect.arrayContaining([
      "received", "understanding", "planning", "failed", "recovery", "ready", "executing", "completed",
    ]));
  });

  it("aggregates planner, action, workflow, and receipt evidence through durable foreign keys", async () => {
    const received = await receiveWork({ tenantId: TENANT_ID, instruction: "Run linked work", instructionId: randomUUID(), channel: "console" });
    const attempt = await beginWorkPlannerAttempt({ tenantId: TENANT_ID, workId: received.workId, workInputId: received.workInputId, attemptKey: "input" });
    const duplicateAttempt = await beginWorkPlannerAttempt({ tenantId: TENANT_ID, workId: received.workId, workInputId: received.workInputId, attemptKey: "input" });
    expect(duplicateAttempt).toMatchObject({ id: attempt.id, claimed: false, attempt: 1 });
    const [action] = await withTenant(TENANT_ID, (db) => db.insert(domainActions).values({
      tenantId: TENANT_ID,
      workId: received.workId,
      plannerAttemptId: attempt.id,
      instructionId: received.instructionId,
      actionType: "test_work_action",
      payload: {},
      status: "approved",
    }).returning());
    await finishWorkPlannerAttempt({ tenantId: TENANT_ID, attemptId: attempt.id, status: "succeeded", plannerResult: { actionIds: [action!.id] } });
    const command = await withTenant(TENANT_ID, (db) => submitCommand(db, {
      tenantId: TENANT_ID,
      workId: received.workId,
      domainActionId: action!.id,
      commandType: "test_work_command",
      workflowType: "test_workflow",
      payload: {},
      steps: [{ stepType: "test_step", payload: {} }],
    }));
    await openReceipt({
      tenantId: TENANT_ID,
      workId: received.workId,
      workflowRunId: command.workflowRunId,
      workflowStepId: command.stepIds[0],
      domainActionId: action!.id,
      objective: "Prove linked evidence",
      evidence: [{ source: "test", ref: action!.id, timestamp: new Date().toISOString() }],
      policyApplied: null,
      riskTier: "low",
      proposedAction: {},
      approval: { required: false },
    });

    const aggregate = await workAggregate(TENANT_ID, received.workId);
    expect(aggregate!.plannerAttempts).toHaveLength(1);
    expect(aggregate!.actions).toEqual([expect.objectContaining({ id: action!.id, workId: received.workId })]);
    expect(aggregate!.workflowRuns).toEqual([expect.objectContaining({ id: command.workflowRunId, workId: received.workId })]);
    expect(aggregate!.receipts).toEqual([expect.objectContaining({ workId: received.workId, domainActionId: action!.id })]);
  });
});
