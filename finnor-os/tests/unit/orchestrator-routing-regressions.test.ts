import { describe, expect, it, vi, beforeEach } from "vitest";

const ids = {
  tenantId: "00000000-0000-4000-8000-0000000000b1",
  workId: "00000000-0000-4000-8000-0000000000b2",
  workInputId: "00000000-0000-4000-8000-0000000000b3",
  instructionId: "00000000-0000-4000-8000-0000000000b4",
  plannerAttemptId: "00000000-0000-4000-8000-0000000000b5",
};

const emptyMemory = {
  shortTerm: null,
  longTerm: null,
  semantic: [],
  episodic: [],
  patterns: null,
};

const operatingContext = {
  version: 1,
  assembledAt: "2026-08-30T00:00:00.000Z",
  truthPrecedence: [],
  interactionContext: null,
  conversationContext: null,
  tenant: { id: ids.tenantId, companyName: "Test Company", timezone: "UTC", profile: {} },
  employee: { userId: "test-user", employeeId: null, displayName: "Test User", role: "owner", authorityRoles: ["owner"], profile: {} },
  activeWork: null,
  companyDirectory: {},
  identityAccess: {},
  referencedEntities: [],
  canonicalSummaries: [],
  memory: { conversation: null, semantic: [], episodic: [] },
  health: { status: "healthy" },
} as never;

const clarificationContext = {
  version: 1,
  ownerEmployeeId: "00000000-0000-4000-8000-0000000000b6",
  thread: {
    id: "00000000-0000-4000-8000-0000000000b7",
    title: null,
    summary: null,
    revision: 1,
    activeWorkId: null,
    activeObjectiveLoopId: null,
    lastActivityAt: "2026-08-30T00:00:00.000Z",
    createdAt: "2026-08-30T00:00:00.000Z",
  },
  exactRecentMessages: [],
  summary: null,
  olderRelevantMessages: [],
  personalMemories: [],
  zepFacts: [],
  resolution: {
    status: "clarification_required",
    originalInstruction: "Send it to Alex",
    resolvedReferences: [],
    candidates: [],
    unresolvedExpressions: ["Alex"],
    clarificationQuestion: "Which Alex should I use?",
    consequential: true,
    senderIdentityRef: null,
    provenance: [],
  },
} as never;

const mocks = vi.hoisted(() => ({
  receiveWork: vi.fn(async () => ({
    workId: ids.workId,
    workInputId: ids.workInputId,
    instructionId: ids.instructionId,
    created: true,
    duplicate: false,
    status: "received" as const,
    finalOutcome: null,
  })),
  transitionWork: vi.fn(async (..._args: unknown[]) => undefined),
  beginWorkPlannerAttempt: vi.fn(async () => ({ id: ids.plannerAttemptId, attempt: 1, claimed: true })),
  finishWorkPlannerAttempt: vi.fn(async () => undefined),
  ensureInstructionSession: vi.fn(async () => undefined),
  emitInstructionEvent: vi.fn(async () => undefined),
  isInstructionCancelled: vi.fn(async () => false),
  resolveOperatingInteractionContext: vi.fn(async ({ context }: { context?: unknown }) => context),
  assembleOperatingContext: vi.fn(async () => ({ context: operatingContext, memory: emptyMemory, mentionedHousehold: null, resolvedHouseholdId: undefined })),
  evaluateAuthority: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-0000000000b8",
    authorityRevision: 1,
    outcome: "allowed" as const,
    reasonCode: "test_allow",
    employeeId: null,
    approvalChainId: null,
    eligibleApproverIds: [],
  })),
}));

vi.mock("@finnor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@finnor/db")>();
  return {
    ...actual,
    receiveWork: mocks.receiveWork,
    transitionWork: mocks.transitionWork,
    beginWorkPlannerAttempt: mocks.beginWorkPlannerAttempt,
    finishWorkPlannerAttempt: mocks.finishWorkPlannerAttempt,
  };
});

vi.mock("@finnor/memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@finnor/memory")>();
  return {
    ...actual,
    appendEpisode: vi.fn(async () => undefined),
    appendShortTerm: vi.fn(async () => undefined),
    buildMemorySnapshot: vi.fn(async () => emptyMemory),
  };
});

vi.mock("@finnor/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@finnor/security")>();
  return { ...actual, ensureSecretsLoaded: vi.fn(async () => undefined) };
});

vi.mock("@finnor/authority", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@finnor/authority")>();
  return { ...actual, evaluateAuthority: mocks.evaluateAuthority };
});

vi.mock("../../packages/orchestration/src/instruction-trace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/orchestration/src/instruction-trace")>();
  return {
    ...actual,
    ensureInstructionSession: mocks.ensureInstructionSession,
    emitInstructionEvent: mocks.emitInstructionEvent,
    isInstructionCancelled: mocks.isInstructionCancelled,
  };
});

vi.mock("../../packages/orchestration/src/interaction-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/orchestration/src/interaction-context")>();
  return {
    ...actual,
    resolveOperatingInteractionContext: mocks.resolveOperatingInteractionContext,
  };
});

vi.mock("../../packages/orchestration/src/operating-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/orchestration/src/operating-context")>();
  return { ...actual, assembleOperatingContext: mocks.assembleOperatingContext };
});

import { FinnorOrchestrator } from "@finnor/orchestration";
import type { ConversationResponder, Planner } from "@finnor/orchestration";
import type { Executor } from "../../packages/orchestration/src/executor";
import type { OperationalQueryExecution } from "../../packages/orchestration/src/fast-read-lane";

const ctx = { tenantId: ids.tenantId, userId: "test-user", role: "owner" as const };

describe("orchestrator routing regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.receiveWork.mockResolvedValue({
      workId: ids.workId,
      workInputId: ids.workInputId,
      instructionId: ids.instructionId,
      created: true,
      duplicate: false,
      status: "received",
      finalOutcome: null,
    });
    mocks.beginWorkPlannerAttempt.mockResolvedValue({ id: ids.plannerAttemptId, attempt: 1, claimed: true });
    mocks.assembleOperatingContext.mockResolvedValue({ context: operatingContext, memory: emptyMemory, mentionedHousehold: null, resolvedHouseholdId: undefined });
  });

  it("fails visibly when a forced CLARIFY route has no clarification action", async () => {
    const planner = { plan: vi.fn(async () => []) } as unknown as Planner;
    const responder = { answer: vi.fn() } as unknown as ConversationResponder;
    const orchestrator = new FinnorOrchestrator({
      planner,
      conversationResponder: responder,
      executor: { execute: vi.fn() } as unknown as Executor,
      fastReadOnlyRouter: {
        classify: () => ({ route: "planner", reason: "unsupported" }),
        route: async () => null,
      },
    });

    await expect(orchestrator.handleInstructionResult("Send it to Alex", ctx, {
      skipFastReadClassification: true,
      conversationContext: clarificationContext,
      instructionRouteDecision: { version: 1, route: "CLARIFY", reasonCodes: ["consequential_target_or_sender_unresolved"] },
    })).rejects.toThrow("CLARIFY must contain exactly one clarification_request");

    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(responder.answer).not.toHaveBeenCalled();
    expect(mocks.finishWorkPlannerAttempt).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: ids.tenantId,
      attemptId: ids.plannerAttemptId,
      status: "failed",
    }));
    expect((mocks.transitionWork.mock.calls as unknown as Array<unknown[]>).some((call) => call[2] === "failed" && call[3] === "planning_failed")).toBe(true);
  });

  it("keeps a deterministic business query on QUERY despite conversation ambiguity", async () => {
    const planner = { plan: vi.fn() } as unknown as Planner;
    const execution = {
      request: { intent: "money_summary" },
      result: { rows: [], count: 0, execution: { id: "query-execution" } },
      metadata: {
        queryId: "query-execution",
        source: "postgresql" as const,
        durationMs: 1,
        startedAt: "2026-08-30T00:00:00.000Z",
        completedAt: "2026-08-30T00:00:00.001Z",
      },
    } as unknown as OperationalQueryExecution;
    const execute = vi.fn(async () => execution);
    const router = {
      classify: () => ({ route: "fast_read" as const, intent: "money_summary" as const }),
      interpret: () => ({ route: "fast_read" as const, confidence: "high" as const, request: { intent: "money_summary" as const } }),
      route: vi.fn(async () => null),
      execute,
    };
    const orchestrator = new FinnorOrchestrator({
      planner,
      executor: { execute: vi.fn() } as unknown as Executor,
      fastReadOnlyRouter: router,
    });

    const result = await orchestrator.handleInstructionResult("How much money have we collected?", ctx, {
      conversationContext: clarificationContext,
    });

    expect(result.executionModel).toBe("QUERY");
    expect(result.query).toMatchObject({ request: { intent: "money_summary" }, result: { count: 0 } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(planner.plan).not.toHaveBeenCalled();
    const routed = (mocks.transitionWork.mock.calls as unknown as Array<unknown[]>).find((call) => call[3] === "instruction_routed");
    expect(routed?.[4]).toMatchObject({ route: "QUERY" });
  });
});
