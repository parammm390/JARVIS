// POST /api/data-quality/findings/:id/resolve — Phase 7 MAESTRO PACK §7.7's
// "one-click fix" for the data-quality/contradiction queue, honestly scoped: a
// contradiction (e.g. two conflicting phone numbers) has no safe automatic
// resolution — only a human who has actually checked which value is correct can
// resolve it. This marks that a human reviewed and handled it; it does not itself
// mutate the underlying record. Owner-only, matching the DLQ discard route's
// convention for this class of admin action. Never deletes the row — resolvedAt is
// the audit trail of what was cleared and by implication of whom (requireContext'd
// caller, in server logs).

import { withTenant, dataQualityFindings } from "@finnor/db";
import { and, eq, isNull } from "drizzle-orm";
import { requireContext, canApprove, errorResponse } from "../../../../../../lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (!(await canApprove(ctx, "*"))) {
      return Response.json({ error: `Your role (${ctx.role}) cannot resolve data-quality findings` }, { status: 403 });
    }
    const [row] = await withTenant(ctx.tenantId, (db) =>
      db
        .update(dataQualityFindings)
        .set({ resolvedAt: new Date() })
        .where(and(eq(dataQualityFindings.id, params.id), eq(dataQualityFindings.tenantId, ctx.tenantId), isNull(dataQualityFindings.resolvedAt)))
        .returning(),
    );
    if (!row) {
      const [existing] = await withTenant(ctx.tenantId, (db) =>
        db.select({ id: dataQualityFindings.id }).from(dataQualityFindings).where(and(eq(dataQualityFindings.id, params.id), eq(dataQualityFindings.tenantId, ctx.tenantId))),
      );
      if (!existing) return Response.json({ error: "Finding not found" }, { status: 404 });
      return Response.json({ resolved: true, idempotent: true });
    }
    return Response.json({ resolved: true });
  } catch (err) {
    return errorResponse(err);
  }
}
