// GET /api/integrations/status — real self-tests across every external integration,
// not a presence check. "Configured but healthy:false" means credentials exist but
// don't actually work (expired token, wrong scope, wrong account id) — exactly the
// class of failure a plug-and-play adapter needs to surface immediately, not silently,
// the moment a real key lands. Voice-queryable via the ops-overview grounded-QA
// fallback ("are my integrations healthy?") and directly hittable for a health check.

import {
  testAdsConnections,
  testQuickBooksConnection,
  testVapiConnection,
  ghlIntegrationStatus,
  testStripeConnection,
  testDocusignConnection,
  resolveCapabilityBindingsForTenant,
  resendProviderStatus,
} from "@finnor/tools";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const [ads, quickbooks, vapi, stripe, docusign, bindingsReport] = await Promise.all([
      testAdsConnections(),
      testQuickBooksConnection(),
      testVapiConnection(),
      testStripeConnection(),
      testDocusignConnection(),
      resolveCapabilityBindingsForTenant(ctx.tenantId),
    ]);
    const ghl = ghlIntegrationStatus();
    // Same "configured-state only" posture as ghl above — no cheap authenticated no-op
    // exists on Resend's API to probe healthy/unhealthy for real.
    const resend = { ...resendProviderStatus(), healthy: null as boolean | null };
    const all = { meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks, vapi, ghl, stripe, docusign, resend };
    const summary = {
      configuredCount: Object.values(all).filter((h) => h.configured).length,
      healthyCount: Object.values(all).filter((h) => h.healthy === true).length,
      unhealthyCount: Object.values(all).filter((h) => h.healthy === false).length,
    };
    // Which binding actually serves each capability right now (A3.T1: tenant-row ->
    // env -> default, the same resolveCapabilityBindingsForTenant() the worker uses to
    // pick the real binding — this report can't drift from what actually executes).
    const bindings = { payments: bindingsReport.payments.mode, esign: bindingsReport.esign.mode };
    return Response.json({ ...all, bindings, summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
