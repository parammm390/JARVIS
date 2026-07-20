// GET /api/actions/pending — the Confirmation Queue feed (§8). Includes the "blocked"
// and needs_human_review items so nothing is ever silently dropped (§30). Phase 7
// MAESTRO PACK §7.1: each row also carries its most recent DecisionReceipt (objective,
// evidence, policy id+version, risk tier) so the Approval Inbox can render it without a
// second round trip per card.

import { withTenant, domainActions, decisionReceipts } from "@finnor/db";
import { inArray, desc } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";

type ReceiptSummary = {
  id: string;
  domainActionId: string | null;
  objective: string;
  evidence: unknown;
  policyApplied: unknown;
  riskTier: string;
  createdAt: Date;
};

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter");
    const statuses =
      filter === "blocked"
        ? (["blocked_integration_unavailable", "needs_human_review"] as const)
        : (["pending"] as const);
    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(domainActions)
        .where(inArray(domainActions.status, [...statuses]))
        .orderBy(desc(domainActions.createdAt))
        .limit(100),
    );

    const actionIds = rows.map((r) => r.id);
    // A domain action can have more than one receipt (each reflection-retry step opens
    // its own, per Task 2.5) — order by created desc and keep only the first (latest)
    // one seen per action id, in plain JS rather than a window-function query.
    const receiptByActionId = new Map<string, ReceiptSummary>();
    if (actionIds.length > 0) {
      const receiptRows: ReceiptSummary[] = await withTenant(ctx.tenantId, (db) =>
        db
          .select({
            id: decisionReceipts.id,
            domainActionId: decisionReceipts.domainActionId,
            objective: decisionReceipts.objective,
            evidence: decisionReceipts.evidence,
            policyApplied: decisionReceipts.policyApplied,
            riskTier: decisionReceipts.riskTier,
            createdAt: decisionReceipts.createdAt,
          })
          .from(decisionReceipts)
          .where(inArray(decisionReceipts.domainActionId, actionIds))
          .orderBy(desc(decisionReceipts.createdAt)),
      );
      for (const r of receiptRows) {
        if (r.domainActionId && !receiptByActionId.has(r.domainActionId)) receiptByActionId.set(r.domainActionId, r);
      }
    }

    const actions = rows.map((r) => ({ ...r, receipt: receiptByActionId.get(r.id) ?? null }));
    return Response.json({ actions });
  } catch (err) {
    return errorResponse(err);
  }
}
