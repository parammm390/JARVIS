// GET /api/read-models/:view — Phase 6 cross-entity read-models (docs/jarvis-90-
// execution-blueprint.md §6), exposed directly so the dealer console (or any future
// dashboard) can query the same real, typed views workflow 6's daily digest already
// consumes — one query per named view, no LLM involved.

import { requireContext, errorResponse, AuthError } from "../../../../lib/auth";
import {
  pipelineHealth,
  technicianLoad,
  stockRisk,
  cashCollections,
  serviceDue,
  slaBreaches,
  followUpDebt,
  dataQuality,
  household360,
} from "@finnor/read-models";

const VIEWS: Record<string, (tenantId: string, searchParams: URLSearchParams) => Promise<unknown>> = {
  "pipeline-health": (tenantId) => pipelineHealth(tenantId),
  "technician-load": (tenantId) => technicianLoad(tenantId),
  "stock-risk": (tenantId) => stockRisk(tenantId),
  "cash-collections": (tenantId) => cashCollections(tenantId),
  "service-due": (tenantId) => serviceDue(tenantId),
  "sla-breaches": (tenantId) => slaBreaches(tenantId),
  "follow-up-debt": (tenantId) => followUpDebt(tenantId),
  "data-quality": (tenantId) => dataQuality(tenantId),
  "household-360": (tenantId, searchParams) => {
    const householdId = searchParams.get("householdId");
    if (!householdId) throw new AuthError("householdId query param required", 400);
    return household360(tenantId, householdId);
  },
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
