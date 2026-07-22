// GET /api/read-models/:view — Phase 6 cross-entity read-models (docs/jarvis-90-
// execution-blueprint.md §6), exposed directly so the dealer console (or any future
// dashboard) can query the same real, typed views workflow 6's daily digest already
// consumes — one query per named view, no LLM involved.

import { requireContext, errorResponse, AuthError } from "../../../../lib/auth";
import {
  technicianLoad,
  stockRisk,
  cashCollections,
  serviceDue,
  slaBreaches,
  followUpDebt,
  dataQuality,
  household360,
  reliability,
  readinessTrend,
  failureInjectionLog,
} from "@finnor/read-models";
import { getProjection } from "@finnor/projections";

const VIEWS: Record<string, (tenantId: string, searchParams: URLSearchParams) => Promise<unknown>> = {
  // B1.T3: these 3 are served from the CQRS cache (self-healing on a cold miss), not
  // recomputed on every request — see packages/projections. windowDays on reliability
  // is ignored by the cached path (the cache is always the default 1-day window);
  // pass windowDays to opt into a live, uncached computation instead.
  "pipeline-health": (tenantId) => getProjection(tenantId, "pipeline-health"),
  "activity-snapshot": (tenantId) => getProjection(tenantId, "activity-snapshot"),
  "technician-load": (tenantId) => technicianLoad(tenantId),
  "stock-risk": (tenantId) => stockRisk(tenantId),
  "cash-collections": (tenantId) => cashCollections(tenantId),
  "service-due": (tenantId) => serviceDue(tenantId),
  "sla-breaches": (tenantId) => slaBreaches(tenantId),
  "follow-up-debt": (tenantId) => followUpDebt(tenantId),
  "data-quality": (tenantId) => dataQuality(tenantId),
  "reliability": (tenantId, searchParams) => {
    const windowDays = Number(searchParams.get("windowDays") ?? 1);
    if (searchParams.has("windowDays") && Number.isFinite(windowDays) && windowDays > 0 && windowDays !== 1) {
      return reliability(tenantId, windowDays);
    }
    return getProjection(tenantId, "reliability");
  },
  "household-360": (tenantId, searchParams) => {
    const householdId = searchParams.get("householdId");
    if (!householdId) throw new AuthError("householdId query param required", 400);
    return household360(tenantId, householdId);
  },
  // Phase 8 (§8.3): the 30-day certification trend the cockpit's scorecard panel reads.
  "readiness": (tenantId, searchParams) => {
    const days = Number(searchParams.get("days") ?? 30);
    return readinessTrend(tenantId, Number.isFinite(days) && days > 0 ? days : 30);
  },
  // Phase 8 (§8.2): the failure-injection calendar's real log.
  "failure-injections": (tenantId) => failureInjectionLog(tenantId),
};

export async function GET(req: Request, { params }: { params: { view: string } }): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const { view } = params;
    const fn = VIEWS[view];
    if (!fn) {
      return Response.json({ error: `Unknown read-model "${view}". Valid views: ${Object.keys(VIEWS).join(", ")}` }, { status: 404 });
    }
    const data = await fn(ctx.tenantId, new URL(req.url).searchParams);
    if (data === null) {
      return Response.json({ error: "No such household" }, { status: 404 });
    }
    return Response.json({ view, data });
  } catch (err) {
    return errorResponse(err);
  }
}
