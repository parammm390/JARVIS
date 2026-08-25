// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse, enforceRouteRateLimit } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { enforceBatchBackpressure } from "../../../lib/backpressure";
import { receiveWork, recordWorkResponse, transitionWork, workAggregate } from "@finnor/db";
import { classifyInstructionRoute, interactionAwareOperationalDecision, interpretOperationalQuery, isConversationalTurn, OperatingInteractionContextError, resolveOperatingInteractionContext } from "@finnor/orchestration";
import { employeeAuthoritySnapshot } from "@finnor/authority";
import { linkEmployeeConversationTurnToWork, persistEmployeeAssistantTurn, prepareEmployeeConversationTurn } from "@finnor/orchestration";
import { randomUUID } from "node:crypto";

function assistantText(result: Awaited<ReturnType<ReturnType<typeof getOrchestrator>["handleInstructionResult"]>>): string {
  if (result.answer?.spokenSummary) return result.answer.spokenSummary;
  const clarification = result.actions.find((action) => action.actionType === "clarification_request");
  if (clarification && typeof clarification.payload.question === "string") return clarification.payload.question;
  if (result.objective) return "I started durable Work for this objective. I’ll report progress from verified outcomes and ask before any required approval.";
  if (result.query) return "I completed the current-data query. The structured result is linked to this thread.";
  if (result.actions.length > 0) return `I prepared ${result.actions.length} action${result.actions.length === 1 ? "" : "s"} in Work. Nothing is represented as completed unless its execution receipt verifies it.`;
  return "I recorded this turn, but no business action was created.";
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
      const replayResponse = {
        ...(replay ?? {
          planned: aggregate ? aggregate.actions : [],
          workId: received.workId,
          instructionId: received.instructionId,
        }),
        work: aggregate?.work ?? { id: received.workId, status: received.status },
        duplicate: true,
        threadId: prepared.threadId,
      };
      const replayQuery = (replayResponse as Record<string, unknown>).query as { metadata?: { durationMs?: number } } | undefined;
      return Response.json(replayResponse, {
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
      const response = {
        planned: result.actions,
        ...(result.answer ? { answer: result.answer } : {}),
        ...(result.query ? { query: result.query } : {}),
        ...(result.objective ? { objective: result.objective } : {}),
        workId: received.workId,
        workInputId: received.workInputId,
        instructionId: received.instructionId,
        threadId: prepared.threadId,
      };
      const responseText = assistantText(result);
      const outcomeRefs: Array<Record<string, unknown>> = [
        { kind: "work", id: received.workId },
        { kind: "work_input", id: received.workInputId },
        ...result.actions.map((action) => ({ kind: "domain_action", id: action.id, status: action.status })),
        ...(result.objective ? [{ kind: "objective_loop", id: result.objective.objectiveLoopId, state: result.objective.state }] : []),
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
        ...(result.objective ? { objectiveLoopId: result.objective.objectiveLoopId } : {}),
      });
      Object.assign(response, { assistantMessage });
      await recordWorkResponse(ctx.tenantId, received.workId, response);
      return Response.json(response, {
        status: result.objective ? 202 : 201,
        headers: result.query ? { "Server-Timing": `query;dur=${result.query.metadata.durationMs.toFixed(1)}` } : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Instruction processing failed";
      const timeout = /\b(?:timeout|timed out|deadline|aborted?)\b/i.test(message) || (err instanceof Error && err.name === "AbortError");
      const failedWork = await workAggregate(ctx.tenantId, received.workId).catch(() => null);
      if ((failedWork?.work as { status?: string } | undefined)?.status !== "failed") {
        await transitionWork(ctx.tenantId, received.workId, "failed", "intake_processing_failed", {
          message,
          recoverable: true,
        }, { failure: { message, recoverable: true, at: new Date().toISOString() } }).catch(() => undefined);
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
