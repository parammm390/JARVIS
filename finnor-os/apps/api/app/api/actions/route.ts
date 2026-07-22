// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse, enforceRouteRateLimit } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";
import { claimOrGetCachedIntake, completeIntakeClaim } from "../../../lib/intake-idempotency";

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
    // A4.T6: opt-in only (see SubmitInstructionSchema's own comment on why not derived
    // from instruction text by default) — a client that didn't supply a key gets
    // today's unchanged behavior, every submission plans for real.
    if (!body.data.idempotencyKey) {
      const actions = await getOrchestrator().handleInstruction(body.data.instruction, ctx, { sessionId: body.data.sessionId });
      return Response.json({ planned: actions }, { status: 201 });
    }

    const claim = await claimOrGetCachedIntake(ctx.tenantId, body.data.idempotencyKey);
    if (claim.status === "cached") {
      return Response.json({ ...(claim.response as Record<string, unknown>), duplicate: true }, { status: 201 });
    }
    if (claim.status === "in_progress") {
      return Response.json(
        { error: "A submission with this idempotency key is already in progress (or a prior attempt never completed) — don't retry the same key indefinitely." },
        { status: 409 },
      );
    }
    const actions = await getOrchestrator().handleInstruction(body.data.instruction, ctx, { sessionId: body.data.sessionId });
    const response = { planned: actions };
    await completeIntakeClaim(ctx.tenantId, claim.id, response);
    return Response.json(response, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
