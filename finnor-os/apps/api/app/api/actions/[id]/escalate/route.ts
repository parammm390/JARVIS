// POST /api/actions/:id/escalate — a human (not the confirmation-expiry scan) flags a
// still-pending action as needing review, without approving or rejecting it (Phase 7
// MAESTRO PACK §7.1's Approval Inbox third verb). Same audit-first ordering and shared
// decide() path as confirm/reject.

import { withTenant, domainActions } from "@finnor/db";
import { EscalateActionSchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = EscalateActionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

    const row = await withTenant(ctx.tenantId, async (db) => {
      const [r] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, params.id), eq(domainActions.tenantId, ctx.tenantId)));
      return r;
    });
    if (!row) return Response.json({ error: "Action not found" }, { status: 404 });
    if (!(await canApprove(ctx, row.actionType))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot decide on ${row.actionType}` }, { status: 403 });
    }
    if (row.status === "needs_human_review") return Response.json({ status: "needs_human_review", idempotent: true });
    if (row.status !== "pending") {
      return Response.json({ error: `Action is ${row.status}; only pending actions can be escalated` }, { status: 409 });
    }

    const result = await getOrchestrator().decide(params.id, ctx.tenantId, "escalate", ctx.userId, { role: ctx.role, note: body.data.note ?? null });
    return Response.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
