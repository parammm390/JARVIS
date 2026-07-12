// POST /api/actions/:id/reject — halts the action, audit row written first (§19).

import { withTenant, domainActions } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { RejectActionSchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../lib/auth";

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

    // Audit before state change (§19).
    await appendEpisode(ctx.tenantId, params.id, "rejected", { by: ctx.userId, role: ctx.role }, { reason: body.data.reason ?? null });

    await withTenant(ctx.tenantId, (db) =>
      db.update(domainActions).set({ status: "rejected" }).where(eq(domainActions.id, params.id)),
    );
    return Response.json({ status: "rejected" });
  } catch (err) {
    return errorResponse(err);
  }
}
