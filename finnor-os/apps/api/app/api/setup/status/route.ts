// GET /api/setup/status — the "what's still left to configure for this dealer" answer.
// Folds two things into one payload: (1) which registered action types have a real,
// placeholder-free domain_policies row for THIS tenant (vs. unconfigured, vs. fully
// configured but the dealer chose to keep a human in the loop), and (2) the same
// external-integration self-tests /api/integrations/status already runs. A dealer with
// real credentials and a fully-populated policy set gets readyForProduction: true.

import { createDefaultPluginRegistry } from "@finnor/orchestration";
import { testAdsConnections, testQuickBooksConnection, testVapiConnection, ghlIntegrationStatus, circuitSnapshot, resolveCapabilityBindingsForTenant } from "@finnor/tools";
import { zepProviderStatus, embeddingsProviderStatus } from "@finnor/memory";
import { secretProviderStatus } from "@finnor/security";
import { adminDb, tenantPhoneNumbers } from "@finnor/db";
import { eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../lib/auth";
import { scanActionTypeReadiness, type ActionTypeDescriptor } from "../../../../../../packages/domain-plugins/shared/setup-readiness";
import {
  PRICING_CATALOG_ACTION_TYPE,
  loadPricingCatalog,
  isPricingCatalogReady,
} from "../../../../../../packages/domain-plugins/shared/pricing-catalog";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const registry = createDefaultPluginRegistry();
    const descriptors: ActionTypeDescriptor[] = registry
      .actionTypes()
      .map((actionType) => ({ actionType, pluginName: registry.resolve(actionType)!.name }));
    descriptors.push({ actionType: PRICING_CATALOG_ACTION_TYPE, pluginName: "shared-pricing-catalog" });

    const [actionTypes, ads, quickbooks, vapi, pricingCatalog, phoneNumberRows, bindings] = await Promise.all([
      scanActionTypeReadiness(ctx.tenantId, descriptors),
      testAdsConnections(),
      testQuickBooksConnection(),
      testVapiConnection(),
      loadPricingCatalog(ctx.tenantId),
      // tenant_phone_numbers has no RLS (looked up during tenant *resolution*, before
      // tenant_id is known — see migration 0013) — an explicit filter is required and
      // sufficient here since ctx.tenantId is already authenticated at this point.
      adminDb()
        .select({ phoneNumber: tenantPhoneNumbers.phoneNumber, vapiPhoneNumberId: tenantPhoneNumbers.vapiPhoneNumberId, label: tenantPhoneNumbers.label })
        .from(tenantPhoneNumbers)
        .where(eq(tenantPhoneNumbers.tenantId, ctx.tenantId)),
      resolveCapabilityBindingsForTenant(ctx.tenantId),
    ]);
    // Line-item pricing now lives in price_book_items, not the domain_policies JSONB
    // blob scanActionTypeReadiness inspects — override the generic check for this one
    // action type so it doesn't permanently report "unconfigured" once dealers stop
    // writing prices to domain_policies.
    const pricingIdx = actionTypes.findIndex((a) => a.actionType === PRICING_CATALOG_ACTION_TYPE);
    if (pricingIdx !== -1) {
      const ready = isPricingCatalogReady(pricingCatalog);
      actionTypes[pricingIdx] = {
        ...actionTypes[pricingIdx]!,
        status: ready ? "configured" : "unconfigured",
        placeholderFields: ready ? [] : ["items"],
      };
    }
    const ghl = ghlIntegrationStatus();
    // No active health-check for these two (same posture as ghl: configured-state only,
    // no extra network round trip inside this endpoint) — LangGraph has no external
    // service to check (it's in-process, using the same Postgres pool as everything else).
    const zep = { ...zepProviderStatus(), healthy: null as boolean | null };
    // §5.1: embeddingsProviderStatus() itself already reports healthy:false when
    // unconfigured (a real, not-guessed signal — see semantic.ts) rather than the
    // null-means-"not checked" convention zep/ghl use above.
    const embeddingsStatus = embeddingsProviderStatus();
    const integrations = { meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks, vapi, ghl, zep, embeddings: embeddingsStatus };

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

    const phoneRouting = { configured: phoneNumberRows.length > 0, numbers: phoneNumberRows };

    // Phase 4 (§4.4), extended A3.T3 (ghl/docusign): real, durable circuit-breaker
    // state per provider that has one wired (packages/tools/src/provider-circuit-breaker.ts)
    // — an "open" entry here means real calls to that provider are currently refused
    // and affected actions are failing closed (degraded), not silently falling back to
    // the emulator.
    const circuitBreakers = Object.fromEntries(
      await Promise.all(["vapi", "stripe", "quickbooks", "ghl", "docusign", "resend"].map(async (p) => [p, await circuitSnapshot(p)] as const)),
    );

    // Phase 16(c) / A1.T3, tenant-row added A3.T1: a staging (or prod) deploy's config
    // posture, verifiable from this one endpoint instead of grepping platform env-var
    // UIs. bindings comes from @finnor/tools' resolveCapabilityBindingsForTenant() — the
    // exact same function apps/worker/src/handlers/run-workflow-step.ts uses to pick the
    // real binding — so this report can never silently drift from what actually
    // executes. Each entry is {mode, source}: source is "tenant" (a tenant_integrations
    // row overrides it), "env" (an operator set the var), or "default" (Finnor-owned
    // capabilities default to "native" as of A1.T2; external capabilities still default
    // to "emulator").
    const environment = {
      nodeEnv: process.env.NODE_ENV ?? "development",
      secretProvider: secretProviderStatus(),
      bindings,
    };

    return Response.json({ actionTypes, integrations, summary, phoneRouting, environment, circuitBreakers }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
