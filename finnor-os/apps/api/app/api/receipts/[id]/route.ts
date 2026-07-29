// GET /api/receipts/:id — the full DecisionReceipt for the Phase 7 "Why?" view
// (§7.3): objective, evidence/citations, policy id+version, risk tier, expected vs
// actual, failure + recovery path. Tenant-scoped, any signed-in role may read.

import { withTenant, decisionReceipts, domainActions } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";
import { extractPredicted } from "../../../../lib/predicted-outcome";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireContext(req);
    const [row] = await withTenant(ctx.tenantId, (db) =>
      db.select().from(decisionReceipts).where(and(eq(decisionReceipts.id, id), eq(decisionReceipts.tenantId, ctx.tenantId))),
    );
    if (!row) return Response.json({ error: "Receipt not found" }, { status: 404 });

    // jarvis-v3 P4.T1: predicted<->actual (§6⑦) lives one hop away from the
    // receipt itself — predictedReceipt/predictionDiff are columns on the
    // domain_action this receipt's workflow_step belongs to, not on
    // decision_receipts. Additive: a receipt with no domainActionId (a rare
    // shape today, but the column is nullable), or a domain_action with no real
    // simulate() prediction, yields predicted:null/predictionDiff:null — the
    // frontend's own "No prediction was recorded for this action." variant,
    // never a fabricated one.
    let predicted: ReturnType<typeof extractPredicted> = null;
    let predictionDiff: unknown = null;
    if (row.domainActionId) {
      const [action] = await withTenant(ctx.tenantId, (db) =>
        db
          .select({ predictedReceipt: domainActions.predictedReceipt, predictionDiff: domainActions.predictionDiff })
          .from(domainActions)
          .where(and(eq(domainActions.id, row.domainActionId!), eq(domainActions.tenantId, ctx.tenantId))),
      );
      if (action) {
        predicted = extractPredicted(action.predictedReceipt);
        predictionDiff = action.predictionDiff ?? null;
      }
    }

    return Response.json({ receipt: { ...row, predicted, predictionDiff } });
  } catch (err) {
    return errorResponse(err);
  }
}
