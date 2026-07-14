// POST /api/actions/:id/reject — halts the action. Audit-first ordering (§19) and the
// actual status flip live in FinnorOrchestrator.decide() — shared with confirm and the
// Vapi webhook (see confirm/route.ts for why).

import { withTenant, domainActions } from "@finnor/db";
import { RejectActionSchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = RejectActionSchema.safeParse(await req.json().catch(() => ({})));
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
    if (row.status === "rejected") return Response.json({ status: "rejected", idempotent: true });

    const result = await getOrchestrator().decide(params.id, ctx.tenantId, "reject", ctx.userId, { role: ctx.role, reason: body.data.reason ?? null });
    if (result.output.idempotent) return Response.json({ status: result.output.status, idempotent: true });
    return Response.json({ status: "rejected" });
  } catch (err) {
    return errorResponse(err);
  }
}
