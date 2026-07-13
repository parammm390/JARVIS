// GET /api/integrations/status — real self-tests across every external integration,
// not a presence check. "Configured but healthy:false" means credentials exist but
// don't actually work (expired token, wrong scope, wrong account id) — exactly the
// class of failure a plug-and-play adapter needs to surface immediately, not silently,
// the moment a real key lands. Voice-queryable via the ops-overview grounded-QA
// fallback ("are my integrations healthy?") and directly hittable for a health check.

import { testAdsConnections, testQuickBooksConnection, connectVapi } from "@finnor/tools";
import { requireContext, errorResponse } from "../../../../lib/auth";

interface HealthEntry {
  configured: boolean;
  healthy: boolean | null;
  error?: string;
  note?: string;
}

async function testVapi(): Promise<HealthEntry> {
  if (!process.env.VAPI_API_KEY) return { configured: false, healthy: null };
  try {
    const conn = await connectVapi();
    await conn.close().catch(() => undefined);
    return { configured: true, healthy: true };
  } catch (err) {
    return { configured: true, healthy: false, error: (err as Error).message };
  }
}

function ghlStatus(): HealthEntry {
  // Intentionally not connected in the default topology — the native business layer
  // (households/inventory_items/invoices) is the system of record; GHL is optional,
  // not a required integration this build depends on. Never reported as "unhealthy."
  if (!process.env.GOHIGHLEVEL_API_KEY) {
    return { configured: false, healthy: null, note: "native business layer is the system of record — GHL is optional" };
  }
  return { configured: true, healthy: null, note: "configured but not actively self-tested here (native layer still primary)" };
}

export async function GET(req: Request): Promise<Response> {
  try {
    await requireContext(req); // authenticated, but this data isn't tenant-scoped (process-level env vars)
    const [ads, quickbooks, vapi] = await Promise.all([testAdsConnections(), testQuickBooksConnection(), testVapi()]);
    const ghl = ghlStatus();
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
