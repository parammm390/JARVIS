// POST /api/actions/:id/confirm — approve → triggers execution (§8).
// Audit-first ordering (§19): the confirm event is written to action_log BEFORE
// execution starts, so a crash mid-execution never leaves a gap in the trail.

import { withTenant, domainActions } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { ConfirmActionSchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";
import { getOrchestrator } from "../../../../../lib/orchestrator";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = ConfirmActionSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

    // Idempotent + gate-safe: only a pending action can be approved.
    const updated = await withTenant(ctx.tenantId, async (db) => {
      const [row] = await db
        .select()
        .from(domainActions)
        .where(and(eq(domainActions.id, params.id), eq(domainActions.tenantId, ctx.tenantId)));
      if (!row) return { error: "Action not found", status: 404 } as const;
      if (!(await canApprove(ctx, row.actionType))) {
        return { error: `Your role (${ctx.role}) cannot approve ${row.actionType}`, status: 403 } as const;
      }
      if (row.status === "approved" || row.status === "completed") {
        return { row, alreadyDone: true } as const; // safe to call twice
      }
      if (row.status !== "pending" && row.status !== "needs_human_review") {
        return { error: `Action is ${row.status}; only pending actions can be approved`, status: 409 } as const;
      }
      const [next] = await db
        .update(domainActions)
        .set({ status: "approved" })
        .where(eq(domainActions.id, params.id))
        .returning();
      return { row: next! } as const;
    });

    if ("error" in updated) return Response.json({ error: updated.error }, { status: updated.status });
    if ("alreadyDone" in updated && updated.alreadyDone) {
      return Response.json({ status: updated.row.status, idempotent: true });
    }

    // Write the audit row BEFORE triggering execution (§19).
    await appendEpisode(ctx.tenantId, params.id, "confirmed", { by: ctx.userId, role: ctx.role }, { note: body.data.note ?? null });

    const result = await getOrchestrator().runAction(params.id, ctx.tenantId);
    return Response.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
