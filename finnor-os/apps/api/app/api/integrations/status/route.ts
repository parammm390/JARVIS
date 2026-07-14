// GET /api/integrations/status — real self-tests across every external integration,
// not a presence check. "Configured but healthy:false" means credentials exist but
// don't actually work (expired token, wrong scope, wrong account id) — exactly the
// class of failure a plug-and-play adapter needs to surface immediately, not silently,
// the moment a real key lands. Voice-queryable via the ops-overview grounded-QA
// fallback ("are my integrations healthy?") and directly hittable for a health check.

import { testAdsConnections, testQuickBooksConnection, testVapiConnection, ghlIntegrationStatus } from "@finnor/tools";
import { requireContext, errorResponse } from "../../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    await requireContext(req); // authenticated, but this data isn't tenant-scoped (process-level env vars)
    const [ads, quickbooks, vapi] = await Promise.all([testAdsConnections(), testQuickBooksConnection(), testVapiConnection()]);
    const ghl = ghlIntegrationStatus();
    const all = { meta_ads: ads.meta, google_ads: ads.googleAds, quickbooks, vapi, ghl };
    const summary = {
      configuredCount: Object.values(all).filter((h) => h.configured).length,
      healthyCount: Object.values(all).filter((h) => h.healthy === true).length,
      unhealthyCount: Object.values(all).filter((h) => h.healthy === false).length,
    };
    return Response.json({ ...all, summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
