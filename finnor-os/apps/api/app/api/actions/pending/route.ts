// GET /api/actions/pending — the Confirmation Queue feed (§8). Includes the "blocked"
// and needs_human_review items so nothing is ever silently dropped (§30). Phase 7
// MAESTRO PACK §7.1: each row also carries its most recent DecisionReceipt (objective,
// evidence, policy id+version, risk tier) so the Approval Inbox can render it without a
// second round trip per card.
//
// D2.T1 (Approval Cockpit): two more real-but-optional fields, both honestly absent
// when there's nothing to report rather than fabricated. `critic` surfaces the async
// second-pass verdict from packages/orchestration/src/critic.ts's `critic_review`
// action_log rows when one has actually run (needs AWS_BEDROCK_API_KEY — unconfigured
// today per the credentials ledger, so this is real machinery that will typically
// report null until that key exists, not a fake "pending" placeholder). `priceBook
// Provenance` compares any {sku, price} pairs found in the payload against this
// tenant's real price_book_items rows — see lib/price-book-provenance.ts for why this
// is scoped to price-book comparison rather than a generic all-fields diff.

import { withTenant, domainActions, decisionReceipts, actionLog, priceBookItems } from "@finnor/db";
import { inArray, desc, eq, and } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";
import { extractPriceCandidates, buildPriceBookProvenance } from "../../../../lib/price-book-provenance";

type ReceiptSummary = {
  id: string;
  domainActionId: string | null;
  objective: string;
  evidence: unknown;
  policyApplied: unknown;
  riskTier: string;
  createdAt: Date;
};

type CriticSummary = { flagged: boolean; reason: string };

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

    const criticByActionId = new Map<string, CriticSummary>();
    const allSkus = new Set<string>();
    const candidatesByActionId = new Map<string, ReturnType<typeof extractPriceCandidates>>();
    for (const r of rows) {
      const candidates = extractPriceCandidates(r.payload);
      if (candidates.length > 0) {
        candidatesByActionId.set(r.id, candidates);
        for (const c of candidates) allSkus.add(c.sku);
      }
    }

    if (actionIds.length > 0) {
      // Latest critic_review episode per action, same "order desc, keep first seen"
      // pattern as the receipt lookup above.
      const criticRows = await withTenant(ctx.tenantId, (db) =>
        db
          .select({ domainActionId: actionLog.domainActionId, output: actionLog.output, timestamp: actionLog.timestamp })
          .from(actionLog)
          .where(and(inArray(actionLog.domainActionId, actionIds), eq(actionLog.step, "critic_review")))
          .orderBy(desc(actionLog.timestamp)),
      );
      for (const cr of criticRows) {
        if (criticByActionId.has(cr.domainActionId)) continue;
        const out = cr.output as Record<string, unknown> | null;
        if (out && typeof out.flagged === "boolean" && typeof out.reason === "string") {
          criticByActionId.set(cr.domainActionId, { flagged: out.flagged, reason: out.reason });
        }
      }
    }

    const priceBookRows =
      allSkus.size > 0
        ? await withTenant(ctx.tenantId, (db) =>
            db
              .select({ sku: priceBookItems.sku, label: priceBookItems.label, priceUsd: priceBookItems.priceUsd })
              .from(priceBookItems)
              .where(inArray(priceBookItems.sku, [...allSkus])),
          )
        : [];

    const actions = rows.map((r) => ({
      ...r,
      receipt: receiptByActionId.get(r.id) ?? null,
      critic: criticByActionId.get(r.id) ?? null,
      priceBookProvenance: buildPriceBookProvenance(candidatesByActionId.get(r.id) ?? [], priceBookRows),
    }));
    return Response.json({ actions });
  } catch (err) {
    return errorResponse(err);
  }
}
