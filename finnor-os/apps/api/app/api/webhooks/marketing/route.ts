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
import { withTenant } from "@finnor/db";
import { createLead } from "@finnor/data-platform";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { errorResponse } from "../../../../lib/auth";

const MarketingConversionSchema = z.object({
  tenantId: z.string().uuid(),
  campaignId: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
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
