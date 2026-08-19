// GET /api/integrations/status — real self-tests across every external integration,
// not a presence check. "Configured but healthy:false" means credentials exist but
// don't actually work (expired token, wrong scope, wrong account id) — exactly the
// class of failure a plug-and-play adapter needs to surface immediately, not silently,
// the moment a real key lands. Voice-queryable via the ops-overview grounded-QA
// fallback ("are my integrations healthy?") and directly hittable for a health check.

import {
  testTenantAdsConnections,
  testTenantQuickBooksConnection,
  testTenantVapiConnection,
  testTenantVapiAssistants,
  testTenantGhlConnection,
  testTenantStripeConnection,
  testTenantDocusignConnection,
  resolveCapabilityBindingsForTenant,
  tenantResendStatus,
} from "@finnor/tools";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const [ads, quickbooks, vapi, voiceAssistants, stripe, docusign, bindingsReport] = await Promise.all([
      testTenantAdsConnections(ctx.tenantId),
      testTenantQuickBooksConnection(ctx.tenantId),
      testTenantVapiConnection(ctx.tenantId),
      testTenantVapiAssistants(ctx.tenantId),
      testTenantStripeConnection(ctx.tenantId),
      testTenantDocusignConnection(ctx.tenantId),
      resolveCapabilityBindingsForTenant(ctx.tenantId),
    ]);
    const [ghl, resend] = await Promise.all([testTenantGhlConnection(ctx.tenantId), tenantResendStatus(ctx.tenantId)]);
    // Same "configured-state only" posture as ghl above — no cheap authenticated no-op
    // exists on Resend's API to probe healthy/unhealthy for real.
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
    return Response.json({ ...all, voiceAssistants, bindings, summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
