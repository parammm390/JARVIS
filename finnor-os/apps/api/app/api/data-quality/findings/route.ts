// GET /api/data-quality/findings — Phase 7 MAESTRO PACK §7.7: the individual
// unresolved rows behind the aggregate GET /api/read-models/data-quality counts, so
// the cockpit's data-quality queue can list and act on real findings, not just show
// a total. Tenant-scoped, any signed-in role may read.

import { withTenant, dataQualityFindings } from "@finnor/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(dataQualityFindings)
        .where(and(eq(dataQualityFindings.tenantId, ctx.tenantId), isNull(dataQualityFindings.resolvedAt)))
        .orderBy(desc(dataQualityFindings.createdAt))
        .limit(100),
    );
    return Response.json({ findings: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
