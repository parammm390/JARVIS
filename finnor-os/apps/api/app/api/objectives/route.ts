import { StartObjectiveSchema } from "@finnor/policy-schema";
import { errorResponse, requireContext } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { linkEmployeeConversationTurnToWork, OperatingInteractionContextError, parseObjectiveSuccessCondition, persistEmployeeAssistantTurn, prepareEmployeeConversationTurn, resolveOperatingInteractionContext } from "@finnor/orchestration";
import { randomUUID } from "node:crypto";

/** Accept responsibility for a persistent governed objective. The request only
 * commits Work/controller state and queues one bounded iteration; it never runs a
 * long autonomous loop inside the serverless request. */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const parsed = StartObjectiveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    let activeContext = parsed.data.activeContext;
    try {
      activeContext = await resolveOperatingInteractionContext({
        tenantId: ctx.tenantId,
        context: parsed.data.activeContext,
        channel: parsed.data.channel,
        workId: parsed.data.workId,
      });
    } catch (error) {
      if (error instanceof OperatingInteractionContextError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
    const instructionId = parsed.data.instructionId ?? randomUUID();
    const prepared = await prepareEmployeeConversationTurn({
      ctx,
      threadId: parsed.data.threadId,
      instruction: parsed.data.objective,
      instructionId,
      idempotencyKey: parsed.data.idempotencyKey,
      channel: parsed.data.channel,
      transportSessionId: parsed.data.sessionId,
      activeContext,
    });
    const humanCtx = { ...ctx, userId: prepared.employeeId, employeeId: prepared.employeeId };
    if (!activeContext && prepared.context.resolution.resolvedReferences.length > 0) {
      activeContext = {
        version: 1,
        capturedAt: new Date().toISOString(),
        source: parsed.data.channel,
        selectedEntities: prepared.context.resolution.resolvedReferences.map(({ entityType, entityId }) => ({ entityType, entityId })),
        excludedEntities: [],
        surface: { id: "home", route: "/jarvis", spatialState: "canvas" },
        filters: [],
      };
    }
    if (prepared.context.resolution.status === "clarification_required") {
      const clarified = await getOrchestrator().handleInstructionResult(parsed.data.objective, humanCtx, {
        channel: parsed.data.channel,
        sessionId: parsed.data.sessionId,
        instructionId,
        idempotencyKey: parsed.data.idempotencyKey,
        activeContext,
        conversationContext: prepared.context,
        instructionRouteDecision: { version: 1, route: "ATOMIC_EFFECT", reasonCodes: ["phase6_reference_or_sender_ambiguous"] },
        skipFastReadClassification: true,
      });
      await linkEmployeeConversationTurnToWork({ tenantId: ctx.tenantId, employeeId: prepared.employeeId, threadId: prepared.threadId, userMessageId: prepared.userMessage.id, workId: clarified.workId!, workInputId: clarified.workInputId! });
      const action = clarified.actions.find((candidate) => candidate.actionType === "clarification_request");
      const text = typeof action?.payload.question === "string" ? action.payload.question : prepared.context.resolution.clarificationQuestion ?? "Which current target should I use?";
      const assistantMessage = await persistEmployeeAssistantTurn({ tenantId: ctx.tenantId, employeeId: prepared.employeeId, threadId: prepared.threadId, instructionId: clarified.instructionId!, channel: parsed.data.channel, text, workId: clarified.workId!, workInputId: clarified.workInputId!, outcomeRefs: [{ kind: "assistant_semantic", semanticKind: "CLARIFICATION" }, ...clarified.actions.map((item) => ({ kind: "domain_action", id: item.id, status: item.status }))] });
      return Response.json({ planned: clarified.actions, clarification: prepared.context.resolution, threadId: prepared.threadId, workId: clarified.workId, instructionId: clarified.instructionId, assistantMessage }, { status: 200 });
    }
    const budgets = parsed.data.budgets;
    const result = await getOrchestrator().startObjective(parsed.data.objective, humanCtx, {
      channel: parsed.data.channel,
      sessionId: parsed.data.sessionId,
      instructionId,
      workId: parsed.data.workId,
      idempotencyKey: parsed.data.idempotencyKey,
      activeContext,
      successCondition: parsed.data.successCondition ? parseObjectiveSuccessCondition(parsed.data.successCondition) : undefined,
      maxSteps: budgets?.maxSteps,
      maxActions: budgets?.maxActions,
      maxQueries: budgets?.maxQueries,
      maxPlannerFailures: budgets?.maxPlannerFailures,
      maxConsecutiveNoProgress: budgets?.maxConsecutiveNoProgress,
      deadlineAt: budgets?.deadlineAt ? new Date(budgets.deadlineAt) : undefined,
    });
    await linkEmployeeConversationTurnToWork({ tenantId: ctx.tenantId, employeeId: prepared.employeeId, threadId: prepared.threadId, userMessageId: prepared.userMessage.id, workId: result.workId, workInputId: result.workInputId, objectiveLoopId: result.objectiveLoopId });
    const assistantMessage = await persistEmployeeAssistantTurn({ tenantId: ctx.tenantId, employeeId: prepared.employeeId, threadId: prepared.threadId, instructionId: result.instructionId, channel: parsed.data.channel, text: "I started durable Work for this objective. I’ll report progress from verified outcomes and ask before any required approval.", workId: result.workId, workInputId: result.workInputId, outcomeRefs: [{ kind: "assistant_semantic", semanticKind: "ACKNOWLEDGEMENT" }, { kind: "objective_loop", id: result.objectiveLoopId, state: result.state }, { kind: "work", id: result.workId }] });
    return Response.json({ objective: result, threadId: prepared.threadId, assistantMessage }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
