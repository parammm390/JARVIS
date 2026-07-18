// POST /api/dlq/:id/replay — re-enqueue a dead-lettered outbox event (§2.3). Owner-only.

import { replayDeadLetter } from "@finnor/workflow-runtime";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_open: 409,
  not_replayable: 409,
  no_linked_outbox_event: 409,
};

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot replay dead letters` }, { status: 403 });
    }
    const result = await replayDeadLetter(ctx.tenantId, params.id);
    if (!result.replayed) {
      return Response.json({ error: result.reason }, { status: STATUS_BY_REASON[result.reason] ?? 409 });
    }
    return Response.json({ replayed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
