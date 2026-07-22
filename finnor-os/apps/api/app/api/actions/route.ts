// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse, enforceRouteRateLimit } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    // A4.T5: intake is the LLM planner's own entry point — real cost per call, distinct
    // from (and tighter than) requireContext's generic per-tenant bucket that every
    // other route shares, so a runaway client here can't also starve those, or vice
    // versa. Read fresh per request (not hoisted to a module-level const) so it
    // actually reflects the env at call time, same convention as rate-limit.ts's own
    // default-parameter pattern.
    await enforceRouteRateLimit(`intake:${ctx.tenantId}`, Number(process.env.RATE_LIMIT_INTAKE_PER_MINUTE ?? 20));
    const body = SubmitInstructionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return Response.json(
        { error: body.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    const actions = await getOrchestrator().handleInstruction(body.data.instruction, ctx, {
      sessionId: body.data.sessionId,
    });
    return Response.json({ planned: actions }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
