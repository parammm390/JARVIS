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
} from "@finnor/tools";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    await requireContext(req); // authenticated, but this data isn't tenant-scoped (process-level env vars)
    const [ads, quickbooks, vapi, stripe, docusign] = await Promise.all([
      testAdsConnections(),
      testQuickBooksConnection(),
      testVapiConnection(),
      testStripeConnection(),
      testDocusignConnection(),
    ]);
    const ghl = ghlIntegrationStatus();
    const all = { meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks, vapi, ghl, stripe, docusign };
    const summary = {
      configuredCount: Object.values(all).filter((h) => h.configured).length,
      healthyCount: Object.values(all).filter((h) => h.healthy === true).length,
      unhealthyCount: Object.values(all).filter((h) => h.healthy === false).length,
    };
    // Which binding actually serves each capability right now — configured creds
    // alone don't mean the workflow runtime is using them yet (PAYMENTS_BINDING/
    // ESIGN_BINDING are the separate opt-in switches, packages/tools' env-var
    // pattern every other domain already follows).
    const bindings = {
      payments: process.env.PAYMENTS_BINDING === "stripe" ? "stripe" : "emulator",
      esign: process.env.ESIGN_BINDING === "docusign" ? "docusign" : "emulator",
    };
    return Response.json({ ...all, bindings, summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
