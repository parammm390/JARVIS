// POST /api/actions — submit a new instruction (voice transcript or text) (§8).

import { SubmitInstructionSchema } from "@finnor/policy-schema";
import { requireContext, errorResponse } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
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
