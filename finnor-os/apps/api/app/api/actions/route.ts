// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse, enforceRouteRateLimit } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { enforceBatchBackpressure } from "../../../lib/backpressure";
import { receiveWork, recordWorkResponse, transitionWork, workAggregate } from "@finnor/db";
import { interpretOperationalQuery } from "@finnor/orchestration";

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
    // Classify once before planner-only gates. Authentication and the generic
    // authenticated-route limiter already ran in requireContext; this tighter
    // intake bucket and batch backpressure are reserved for planner work.
    const fastReadDecision = interpretOperationalQuery(body.data.instruction);
    if (fastReadDecision.route === "planner") {
      await enforceRouteRateLimit(`intake:${ctx.tenantId}`, Number(process.env.RATE_LIMIT_INTAKE_PER_MINUTE ?? 20));
    }
    // Work is the intake claim. It commits before backpressure, secrets, memory, or
    // planner work begins, so even a timeout after this line leaves a recoverable row.
    const received = await receiveWork({
      tenantId: ctx.tenantId,
      instruction: body.data.instruction,
      channel: body.data.channel,
      sessionId: body.data.sessionId,
      instructionId: body.data.instructionId,
      workId: body.data.workId,
      userId: ctx.userId,
      idempotencyKey: body.data.idempotencyKey,
      activeContext: body.data.activeContext,
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
      };
      const replayQuery = (replayResponse as Record<string, unknown>).query as { metadata?: { durationMs?: number } } | undefined;
      return Response.json(replayResponse, {
        status: received.status === "completed" || received.status === "failed" ? 200 : 202,
        headers: replayQuery?.metadata?.durationMs === undefined ? undefined : { "Server-Timing": `query;dur=${Number(replayQuery.metadata.durationMs).toFixed(1)}` },
      });
    }

    try {
      if (fastReadDecision.route === "planner") await enforceBatchBackpressure();
      const result = await getOrchestrator().handleInstructionResult(body.data.instruction, ctx, {
        sessionId: body.data.sessionId,
        instructionId: received.instructionId,
        workId: received.workId,
        workInputId: received.workInputId,
        idempotencyKey: body.data.idempotencyKey,
        channel: body.data.channel,
        activeContext: body.data.activeContext,
        fastReadDecision,
        skipFastReadClassification: true,
      });
      const response = {
        planned: result.actions,
        ...(result.answer ? { answer: result.answer } : {}),
        ...(result.query ? { query: result.query } : {}),
        workId: received.workId,
        workInputId: received.workInputId,
        instructionId: received.instructionId,
      };
      await recordWorkResponse(ctx.tenantId, received.workId, response);
      return Response.json(response, {
        status: 201,
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
