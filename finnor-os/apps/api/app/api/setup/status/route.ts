// GET /api/setup/status — the "what's still left to configure for this dealer" answer.
// Folds two things into one payload: (1) which registered action types have a real,
// placeholder-free domain_policies row for THIS tenant (vs. unconfigured, vs. fully
// configured but the dealer chose to keep a human in the loop), and (2) the same
// external-integration self-tests /api/integrations/status already runs. A dealer with
// real credentials and a fully-populated policy set gets readyForProduction: true.

import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { testAdsConnections, testQuickBooksConnection, testVapiConnection, ghlIntegrationStatus, temporalProviderStatus } from "@finnor/tools";
import { zepProviderStatus } from "@finnor/memory";
import { requireContext, errorResponse } from "../../../../lib/auth";
import { scanActionTypeReadiness, type ActionTypeDescriptor } from "../../../../../../packages/domain-plugins/shared/setup-readiness";
import { PRICING_CATALOG_ACTION_TYPE } from "../../../../../../packages/domain-plugins/shared/pricing-catalog";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const registry = createDefaultPluginRegistry();
    const descriptors: ActionTypeDescriptor[] = registry
      .actionTypes()
      .map((actionType) => ({ actionType, pluginName: registry.resolve(actionType)!.name }));
    descriptors.push({ actionType: PRICING_CATALOG_ACTION_TYPE, pluginName: "shared-pricing-catalog" });

    const [actionTypes, ads, quickbooks, vapi] = await Promise.all([
      scanActionTypeReadiness(ctx.tenantId, descriptors),
      testAdsConnections(),
      testQuickBooksConnection(),
      testVapiConnection(),
    ]);
    const ghl = ghlIntegrationStatus();
    // No active health-check for these two (same posture as ghl: configured-state only,
    // no extra network round trip inside this endpoint) — LangGraph has no external
    // service to check (it's in-process, using the same Postgres pool as everything else).
    const zep = { ...zepProviderStatus(), healthy: null as boolean | null };
    const temporal = { ...temporalProviderStatus(), healthy: null as boolean | null };
    const integrations = { meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks, vapi, ghl, zep, temporal };

    const summary = {
      actionTypesTotal: actionTypes.length,
      configured: actionTypes.filter((a) => a.status === "configured").length,
      gatedByChoice: actionTypes.filter((a) => a.status === "gated_by_choice").length,
      unconfigured: actionTypes.filter((a) => a.status === "unconfigured").length,
      integrationsHealthy: Object.values(integrations).filter((h) => h.healthy === true).length,
      integrationsUnhealthy: Object.values(integrations).filter((h) => h.healthy === false).length,
      readyForProduction:
        actionTypes.every((a) => a.status !== "unconfigured") && Object.values(integrations).every((h) => h.healthy !== false),
    };

    return Response.json({ actionTypes, integrations, summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
