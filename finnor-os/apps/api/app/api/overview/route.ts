// GET /api/overview — Phase 7 MAESTRO PACK §7.6 (daily briefing). Runs the real,
// ungated `get_business_overview` domain action through the normal receipted runtime
// (packages/orchestration/src/index.ts's draftKnownAction — the same deterministic,
// non-LLM primitive every proactive scan uses) so the briefing carries a real
// DecisionReceipt with real citations (Phase 5.3), not a side-channel query that
// bypasses the receipt/citation contract.
//
// Reuses the most recent completed run from the last 5 minutes instead of drafting a
// fresh one on every call: this is a passive dashboard panel that can poll every few
// seconds, and a pure read producing a brand-new domain_action + decision_receipt row
// each time would grow the audit log forever with near-duplicate snapshots. Pass
// ?refresh=1 to force a fresh run regardless of the cache window.

import { withTenant, domainActions, decisionReceipts } from "@finnor/db";
import { and, eq, gte, desc } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../lib/auth";
import { getOrchestrator } from "../../../lib/orchestrator";

const ACTION_TYPE = "get_business_overview";
const CACHE_WINDOW_MS = 5 * 60 * 1000;

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (!forceRefresh) {
      const cutoff = new Date(Date.now() - CACHE_WINDOW_MS);
      const [recent] = await withTenant(ctx.tenantId, (db) =>
        db
          .select({ id: domainActions.id, status: domainActions.status, createdAt: domainActions.createdAt })
          .from(domainActions)
          .where(and(eq(domainActions.tenantId, ctx.tenantId), eq(domainActions.actionType, ACTION_TYPE), gte(domainActions.createdAt, cutoff)))
          .orderBy(desc(domainActions.createdAt))
          .limit(1),
      );
      if (recent?.status === "completed") {
        const [receipt] = await withTenant(ctx.tenantId, (db) =>
          db
            .select()
            .from(decisionReceipts)
            .where(and(eq(decisionReceipts.tenantId, ctx.tenantId), eq(decisionReceipts.domainActionId, recent.id)))
            .orderBy(desc(decisionReceipts.createdAt))
            .limit(1),
        );
        if (receipt?.actualResult) {
          const actual = receipt.actualResult as { output?: Record<string, unknown> };
          return Response.json({ domainActionId: recent.id, receiptId: receipt.id, cached: true, ...actual.output });
        }
      }
    }

    const { action, result } = await getOrchestrator().draftKnownAction(ACTION_TYPE, {}, ctx.tenantId, { source: "cockpit_daily_briefing" });
    if (result.status !== "success") {
      return Response.json({ error: result.error ?? "Could not generate the briefing right now." }, { status: 502 });
    }
    return Response.json({ domainActionId: action.id, cached: false, ...result.output });
  } catch (err) {
    return errorResponse(err);
  }
}
