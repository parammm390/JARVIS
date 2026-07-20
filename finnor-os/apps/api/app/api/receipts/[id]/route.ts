// GET /api/receipts/:id — the full DecisionReceipt for the Phase 7 "Why?" view
// (§7.3): objective, evidence/citations, policy id+version, risk tier, expected vs
// actual, failure + recovery path. Tenant-scoped, any signed-in role may read.

import { withTenant, decisionReceipts } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const [row] = await withTenant(ctx.tenantId, (db) =>
      db.select().from(decisionReceipts).where(and(eq(decisionReceipts.id, params.id), eq(decisionReceipts.tenantId, ctx.tenantId))),
    );
    if (!row) return Response.json({ error: "Receipt not found" }, { status: 404 });
    return Response.json({ receipt: row });
  } catch (err) {
    return errorResponse(err);
  }
}
