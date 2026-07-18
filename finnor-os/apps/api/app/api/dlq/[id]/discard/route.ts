// POST /api/dlq/:id/discard — permanently give up on a dead-lettered event (§2.3).
// Owner-only. Discarding never deletes the row — it's the audit trail of what was
// dropped and by implication of whom (requireContext'd caller, in server logs).

import { discardDeadLetter } from "@finnor/workflow-runtime";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_open: 409,
};

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot discard dead letters` }, { status: 403 });
    }
    const result = await discardDeadLetter(ctx.tenantId, params.id);
    if (!result.discarded) {
      return Response.json({ error: result.reason }, { status: STATUS_BY_REASON[result.reason] ?? 409 });
    }
    return Response.json({ discarded: true });
  } catch (err) {
    return errorResponse(err);
  }
}
