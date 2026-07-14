// POST /api/actions/:id/confirm — approve → triggers execution (§8).
// Audit-first ordering (§19) and the actual approve/execute logic live in
// FinnorOrchestrator.decide() — the one place that knows how to resume a paused
// executor (legacy GatedExecutor or LangGraph), shared with reject and the Vapi
// webhook instead of each inlining its own status flip.

import { withTenant, domainActions } from "@finnor/db";
import { ConfirmActionSchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = ConfirmActionSchema.safeParse(await req.json().catch(() => ({})));
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
      return Response.json({ error: `Your role (${ctx.role}) cannot approve ${row.actionType}` }, { status: 403 });
    }
    if (row.status === "approved" || row.status === "completed") {
      return Response.json({ status: row.status, idempotent: true }); // safe to call twice
    }
    if (row.status !== "pending" && row.status !== "needs_human_review") {
      return Response.json({ error: `Action is ${row.status}; only pending actions can be approved` }, { status: 409 });
    }

    const result = await getOrchestrator().decide(params.id, ctx.tenantId, "approve", ctx.userId, { role: ctx.role, note: body.data.note ?? null });
    return Response.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
