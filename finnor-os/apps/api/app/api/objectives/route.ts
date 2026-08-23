import { StartObjectiveSchema } from "@finnor/policy-schema";
import { errorResponse, requireContext } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { OperatingInteractionContextError, resolveOperatingInteractionContext } from "@finnor/orchestration";

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
    const budgets = parsed.data.budgets;
    const result = await getOrchestrator().startObjective(parsed.data.objective, ctx, {
      channel: parsed.data.channel,
      sessionId: parsed.data.sessionId,
      instructionId: parsed.data.instructionId,
      workId: parsed.data.workId,
      idempotencyKey: parsed.data.idempotencyKey,
      activeContext,
      maxSteps: budgets?.maxSteps,
      maxActions: budgets?.maxActions,
      maxQueries: budgets?.maxQueries,
      maxPlannerFailures: budgets?.maxPlannerFailures,
      maxConsecutiveNoProgress: budgets?.maxConsecutiveNoProgress,
      deadlineAt: budgets?.deadlineAt ? new Date(budgets.deadlineAt) : undefined,
    });
    return Response.json({ objective: result }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
