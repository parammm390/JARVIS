// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { InstructionSubmissionResponseSchema, SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse, enforceRouteRateLimit } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { enforceBatchBackpressure } from "../../../lib/backpressure";
import { receiveWork, recordWorkResponse, transitionWork, workAggregate } from "@finnor/db";
import { classifyInstructionRoute, interactionAwareOperationalDecision, interpretOperationalQuery, isConversationalTurn, OperatingInteractionContextError, resolveOperatingInteractionContext } from "@finnor/orchestration";
import { employeeAuthoritySnapshot } from "@finnor/authority";
import { InstructionCancelledError, linkEmployeeConversationTurnToWork, persistEmployeeAssistantTurn, prepareEmployeeConversationTurn } from "@finnor/orchestration";
import { randomUUID } from "node:crypto";
import type {
  AssistantSemanticKind,
  DomainAction,
  InstructionAssistantMessage,
  InstructionSubmissionResult,
} from "@finnor/shared-types";
import type { AnswerEnvelope, OperationalQueryExecution } from "@finnor/orchestration";

type ActionsResponse = InstructionSubmissionResult<DomainAction, OperationalQueryExecution, AnswerEnvelope>;

function assistantSemanticKind(result: Awaited<ReturnType<ReturnType<typeof getOrchestrator>["handleInstructionResult"]>>): AssistantSemanticKind {
  if (result.answer) return "ANSWER";
  if (result.actions.some((action) => action.actionType === "clarification_request")) return "CLARIFICATION";
  return "ACKNOWLEDGEMENT";
}

function assistantText(result: Awaited<ReturnType<ReturnType<typeof getOrchestrator>["handleInstructionResult"]>>): string {
  if (result.answer?.spokenSummary) return result.answer.spokenSummary;
  const clarification = result.actions.find((action) => action.actionType === "clarification_request");
  if (clarification && typeof clarification.payload.question === "string") return clarification.payload.question;
  if (result.executionModel === "OBJECTIVE") return "I started durable Work for this objective. I’ll report progress from verified outcomes and ask before any required approval.";
  if (result.query) return "I completed the current-data query. The structured result is linked to this thread.";
  if (result.actions.length > 0) return `I prepared ${result.actions.length} action${result.actions.length === 1 ? "" : "s"} in Work. Nothing is represented as completed unless its execution receipt verifies it.`;
  return "I recorded this turn, but no business action was created.";
}

function isStoredActionsResponse(value: unknown): value is ActionsResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!["QUERY", "CONVERSATION", "ATOMIC_EFFECT", "OBJECTIVE"].includes(String(row.executionModel))) return false;
  if (!Array.isArray(row.actions)) return false;
  if (![row.workId, row.workInputId, row.instructionId, row.threadId].every((entry) => typeof entry === "string" && entry.length > 0)) return false;
  if (!row.assistantMessage || typeof row.assistantMessage !== "object" || Array.isArray(row.assistantMessage)) return false;
  const assistant = row.assistantMessage as Record<string, unknown>;
  return typeof assistant.id === "string"
    && typeof assistant.originalText === "string"
    && typeof assistant.createdAt === "string"
    && ["ANSWER", "ACKNOWLEDGEMENT", "CLARIFICATION"].includes(String(assistant.semanticKind));
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = SubmitInstructionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      // Invalid/unknown intake cannot be proven to be a deterministic read, so it
      // remains in the tighter intake bucket. This preserves the existing abuse
      // boundary while valid classified reads bypass planner-only throttling.
      await enforceRouteRateLimit(`intake:${ctx.tenantId}`, Number(process.env.RATE_LIMIT_INTAKE_PER_MINUTE ?? 20));
      return Response.json(
        { error: body.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    let activeContext = body.data.activeContext;
    try {
      activeContext = await resolveOperatingInteractionContext({
        tenantId: ctx.tenantId,
        context: body.data.activeContext,
        channel: body.data.channel,
        workId: body.data.workId,
      });
    } catch (error) {
      if (error instanceof OperatingInteractionContextError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
    const instructionId = body.data.instructionId ?? randomUUID();
    let prepared;
    try {
      prepared = await prepareEmployeeConversationTurn({
        ctx,
        threadId: body.data.threadId,
        instruction: body.data.instruction,
        instructionId,
        idempotencyKey: body.data.idempotencyKey,
        channel: body.data.channel,
        transportSessionId: body.data.sessionId,
        activeContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "conversation_context_failed";
      const status = message === "conversation_thread_not_found" ? 404 : message.startsWith("canonical_human_principal") ? 403 : 500;
      return Response.json({ error: message }, { status });
    }
    const humanCtx = { ...ctx, userId: prepared.employeeId, employeeId: prepared.employeeId };
    if (!activeContext && prepared.context.resolution.resolvedReferences.length > 0) {
      activeContext = {
        version: 1,
        capturedAt: new Date().toISOString(),
        source: body.data.channel,
        selectedEntities: prepared.context.resolution.resolvedReferences.map(({ entityType, entityId }) => ({ entityType, entityId })),
        excludedEntities: [],
        surface: { id: "home", route: "/jarvis", spatialState: "canvas" },
        filters: [],
      };
    }
    // Classify once before planner-only gates. Authentication and the generic
    // authenticated-route limiter already ran in requireContext; this tighter
    // intake bucket and batch backpressure are reserved for planner work.
    const fastReadDecision = interactionAwareOperationalDecision(interpretOperationalQuery(body.data.instruction), activeContext);
    const instructionRouteDecision = classifyInstructionRoute({ instruction: body.data.instruction, fastReadDecision, activeContext, conversational: isConversationalTurn(body.data.instruction) });
    if (instructionRouteDecision.route !== "QUERY") {
      await enforceRouteRateLimit(`intake:${ctx.tenantId}`, Number(process.env.RATE_LIMIT_INTAKE_PER_MINUTE ?? 20));
    }
    // Work is the intake claim. It commits before backpressure, secrets, memory, or
    // planner work begins, so even a timeout after this line leaves a recoverable row.
    const received = await receiveWork({
      tenantId: ctx.tenantId,
      instruction: body.data.instruction,
      channel: body.data.channel,
      sessionId: body.data.sessionId,
      instructionId,
      workId: body.data.workId,
      userId: prepared.employeeId,
      idempotencyKey: body.data.idempotencyKey,
      activeContext,
      authorityContext: await employeeAuthoritySnapshot(humanCtx),
    });
    await linkEmployeeConversationTurnToWork({
      tenantId: ctx.tenantId,
      employeeId: prepared.employeeId,
      threadId: prepared.threadId,
      userMessageId: prepared.userMessage.id,
      workId: received.workId,
      workInputId: received.workInputId,
    });
    if (received.duplicate) {
      const aggregate = await workAggregate(ctx.tenantId, received.workId);
      const finalOutcome = aggregate?.work && typeof aggregate.work === "object"
        ? (aggregate.work as { finalOutcome?: unknown }).finalOutcome
        : null;
      const replay = finalOutcome && typeof finalOutcome === "object" && !Array.isArray(finalOutcome)
        ? (finalOutcome as { response?: Record<string, unknown> }).response
        : undefined;
      if (!isStoredActionsResponse(replay)) {
        return Response.json({
          error: "This Work predates the canonical instruction response contract and must be refreshed from its Work projection.",
          code: "LEGACY_INSTRUCTION_RESPONSE",
          workId: received.workId,
          instructionId: received.instructionId,
          threadId: prepared.threadId,
        }, { status: 409 });
      }
      const replayQuery = replay.executionModel === "QUERY" ? replay.query : undefined;
      return Response.json(replay, {
        status: received.status === "completed" || received.status === "failed" || received.status === "cancelled" ? 200 : 202,
        headers: replayQuery?.metadata?.durationMs === undefined ? undefined : { "Server-Timing": `query;dur=${Number(replayQuery.metadata.durationMs).toFixed(1)}` },
      });
    }

    try {
      if (instructionRouteDecision.route === "ATOMIC_EFFECT" || instructionRouteDecision.route === "CONVERSATION") await enforceBatchBackpressure();
      const result = await getOrchestrator().handleInstructionResult(body.data.instruction, humanCtx, {
        sessionId: body.data.sessionId,
        instructionId: received.instructionId,
        workId: received.workId,
        workInputId: received.workInputId,
        idempotencyKey: body.data.idempotencyKey,
        channel: body.data.channel,
        activeContext,
        conversationContext: prepared.context,
        fastReadDecision,
        instructionRouteDecision,
        skipFastReadClassification: true,
      });
      const responseText = assistantText(result);
      const semanticKind = assistantSemanticKind(result);
      const outcomeRefs: Array<Record<string, unknown>> = [
        { kind: "work", id: received.workId },
        { kind: "work_input", id: received.workInputId },
        { kind: "assistant_semantic", semanticKind },
        ...result.actions.map((action) => ({ kind: "domain_action", id: action.id, status: action.status })),
        ...(result.objectiveLoopId ? [{ kind: "objective_loop", id: result.objectiveLoopId, state: result.objectiveState }] : []),
        ...(result.query ? [{ kind: "work_query", intent: result.query.request.intent, asOf: result.query.result.asOf }] : []),
      ];
      const assistantMessage = await persistEmployeeAssistantTurn({
        tenantId: ctx.tenantId,
        employeeId: prepared.employeeId,
        threadId: prepared.threadId,
        instructionId: received.instructionId,
        channel: body.data.channel,
        text: responseText,
        workId: received.workId,
        workInputId: received.workInputId,
        outcomeRefs,
      });
      await linkEmployeeConversationTurnToWork({
        tenantId: ctx.tenantId,
        employeeId: prepared.employeeId,
        threadId: prepared.threadId,
        userMessageId: prepared.userMessage.id,
        workId: received.workId,
        workInputId: received.workInputId,
        ...(result.objectiveLoopId ? { objectiveLoopId: result.objectiveLoopId } : {}),
      });
      const responseAssistant: InstructionAssistantMessage = {
        id: assistantMessage.id,
        originalText: assistantMessage.originalText,
        createdAt: assistantMessage.createdAt,
        semanticKind,
      };
      const common = {
        workId: received.workId,
        workInputId: received.workInputId,
        instructionId: received.instructionId,
        threadId: prepared.threadId,
        assistantMessage: responseAssistant,
      };
      let response: ActionsResponse;
      switch (result.executionModel) {
        case "QUERY":
          if (!result.query) throw new Error("Instruction contract violation: QUERY has no query result");
          response = { executionModel: "QUERY", actions: [], query: result.query, ...(result.answer ? { answer: result.answer } : {}), ...common };
          break;
        case "CONVERSATION":
          if (!result.answer) throw new Error("Instruction contract violation: CONVERSATION has no answer");
          response = { executionModel: "CONVERSATION", actions: [], answer: result.answer, ...common };
          break;
        case "OBJECTIVE":
          if (!result.objectiveLoopId || !result.objectiveState) throw new Error("Instruction contract violation: OBJECTIVE has no durable loop identity");
          response = { executionModel: "OBJECTIVE", actions: [], objectiveLoopId: result.objectiveLoopId, objectiveState: result.objectiveState, ...common };
          break;
        case "ATOMIC_EFFECT":
          response = { executionModel: "ATOMIC_EFFECT", actions: result.actions, ...common };
          break;
      }
      if (!InstructionSubmissionResponseSchema.safeParse(response).success) {
        throw new Error("Instruction contract violation: response failed the canonical discriminated schema");
      }
      await recordWorkResponse(ctx.tenantId, received.workId, response as unknown as Record<string, unknown>);
      return Response.json(response, {
        status: result.executionModel === "OBJECTIVE" ? 202 : 201,
        headers: result.query ? { "Server-Timing": `query;dur=${result.query.metadata.durationMs.toFixed(1)}` } : undefined,
      });
    } catch (err) {
      if (err instanceof InstructionCancelledError) {
        return Response.json({
          error: "Instruction cancelled before execution began.",
          code: err.code,
          workId: err.workId,
          workInputId: err.workInputId,
          instructionId: err.instructionId,
          threadId: prepared.threadId,
        }, { status: 409 });
      }
      const message = err instanceof Error ? err.message : "Instruction processing failed";
      const timeout = /\b(?:timeout|timed out|deadline|aborted?)\b/i.test(message) || (err instanceof Error && err.name === "AbortError");
      const failedWork = await workAggregate(ctx.tenantId, received.workId).catch(() => null);
      if ((failedWork?.work as { status?: string } | undefined)?.status !== "failed") {
        await transitionWork(ctx.tenantId, received.workId, "failed", "intake_processing_failed", {
          message,
          recoverable: true,
        }, { failure: { message, recoverable: true, at: new Date().toISOString() }, expectedWorkInputId: received.workInputId }).catch(() => undefined);
      }
      return Response.json({
        error: message,
        recoverable: true,
        workId: received.workId,
        workInputId: received.workInputId,
        instructionId: received.instructionId,
      }, { status: timeout ? 504 : 500 });
    }
  } catch (err) {
      return errorResponse(err);
  }
}
