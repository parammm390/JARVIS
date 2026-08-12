import { latestWorkInput, transitionWork, workAggregate } from "@finnor/db";
import { z } from "zod";
import { errorResponse, requireContext } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

const RetryWorkSchema = z.object({ idempotencyKey: z.string().min(1).max(200) });

/** Re-enters the ordinary planner with the same durable Work/input. The retry key is
 * a unique planner-attempt claim, so repeated recovery clicks never execute twice. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  let requestContext: Awaited<ReturnType<typeof requireContext>> | null = null;
  let workId: string | null = null;
  try {
    const { id } = await params;
    workId = id;
    const ctx = await requireContext(req);
    requestContext = ctx;
    const body = RetryWorkSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: body.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    const aggregate = await workAggregate(ctx.tenantId, id);
    if (!aggregate) return Response.json({ error: "Work not found" }, { status: 404 });
    const work = aggregate.work as { status?: string };
    if (work.status !== "failed" && work.status !== "recovery") {
      return Response.json({ error: `Work is ${work.status ?? "unknown"}; only failed or recovering Work can be retried` }, { status: 409 });
    }
    const attemptKey = `retry:${body.data.idempotencyKey}`;
    const prior = (aggregate.plannerAttempts as Array<{ attemptKey: string; status: string }>).find((attempt) => attempt.attemptKey === attemptKey);
    if (prior) return Response.json({ work: aggregate, duplicate: true }, { status: prior.status === "planning" ? 202 : 200 });

    const input = await latestWorkInput(ctx.tenantId, id);
    if (!input) return Response.json({ error: "Work has no durable input to retry" }, { status: 409 });
    await transitionWork(ctx.tenantId, id, "recovery", "retry_requested", { requestedBy: ctx.userId, attemptKey }, {
      recovery: { status: "requested", requestedBy: ctx.userId, attemptKey, at: new Date().toISOString() },
    });
    const result = await getOrchestrator().handleInstructionResult(input.instructionText, ctx, {
      workId: id,
      workInputId: input.id,
      instructionId: input.instructionId,
      sessionId: input.sessionId ?? undefined,
      channel: input.channel,
      plannerAttemptKey: attemptKey,
    });
    return Response.json({
      planned: result.actions,
      ...(result.answer ? { answer: result.answer } : {}),
      workId: id,
      instructionId: input.instructionId,
      recovery: true,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "PlannerAttemptAlreadyClaimedError" && requestContext && workId) {
      return Response.json({ work: await workAggregate(requestContext.tenantId, workId), duplicate: true }, { status: 202 });
    }
    return errorResponse(err);
  }
}
