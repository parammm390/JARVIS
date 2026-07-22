// POST /api/webhooks/marketing — vertical workflow 7 (marketing to revenue,
// docs/jarvis-90-execution-blueprint.md §5). Phase 3 found ad-write is honestly
// dry-run-only (no live ad-platform OAuth exists) — this route doesn't pretend
// otherwise. What it does provide, for real: a generic conversion-intake endpoint a
// dealer's ad platform (a native webhook, or a Zapier/Make bridge from Meta/Google
// Lead Ads) can point at, which turns a marketing conversion into a real `leads` row
// via the same createLead() the CRM plugin already uses — closing the gap between
// "ran a campaign" and "a lead entered the pipeline," which nothing wired together
// before. From there the lead follows the existing, real pipeline (qualification →
// vertical workflow 1's booked water test → quote → install → cash) unchanged.

import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { withTenant } from "@finnor/db";
import { createLead } from "@finnor/data-platform";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { errorResponse } from "../../../../lib/auth";
import { logWithTrace } from "@finnor/tools";

const MarketingConversionSchema = z.object({
  tenantId: z.string().uuid(),
  campaignId: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

/**
 * This is a generic conversion-intake endpoint (a dealer's own Zapier/Make bridge or
 * a native ad-platform webhook points at it) with a caller-supplied tenantId and no
 * platform-native signature scheme to verify against — unlike GHL/Vapi/Stripe/
 * DocuSign, there's no single provider whose signing key this could check. The real
 * boundary here is a shared secret the dealer puts in their own bridge config (a
 * header, since query-string secrets can leak into logs/proxies). Same fail posture
 * as every other webhook in this repo: unset secret = accept-all only outside
 * production, never in it.
 */
function verifyMarketingWebhookSecret(req: Request): boolean {
  const expected = process.env.MARKETING_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const provided = req.headers.get("x-webhook-secret") ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!verifyMarketingWebhookSecret(req)) {
      logWithTrace({ route: "webhooks/marketing" }).warn({ event: "webhook_signature_rejected", provider: "marketing_conversion" }, "rejected webhook: bad or missing x-webhook-secret");
      return Response.json({ error: "Bad or missing webhook secret" }, { status: 401 });
    }
    const rawBody = await req.text();
    let json: unknown = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      // parsed.success below handles it
    }
    const parsed = MarketingConversionSchema.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

    const receipt = await checkAndRecordReceipt("marketing_conversion", parsed.data.eventId, rawBody);
    if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });

    const result = await withTenant(parsed.data.tenantId, (db) =>
      createLead(db, {
        tenantId: parsed.data.tenantId,
        name: parsed.data.name,
        phone: parsed.data.phone,
        email: parsed.data.email,
        source: `ad_campaign:${parsed.data.campaignId}`,
        provenance: { sourceSystem: "marketing_conversion", externalId: parsed.data.eventId },
      }),
    );

    return Response.json({ received: true, leadId: result.leadId, householdId: result.householdId, alreadyExisted: result.alreadyExisted });
  } catch (err) {
    return errorResponse(err);
  }
}
