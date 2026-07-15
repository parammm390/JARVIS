// POST /api/webhooks/payment — vertical workflow 4's payment-webhook + reconciliation
// steps (docs/jarvis-90-execution-blueprint.md §4.4). No real payment provider
// (Stripe-equivalent) is configured this phase — create_payment_link is emulator-only
// (Phase 3 finding) — so there is no real signing secret to verify against yet.
// Real-provider activation (a later, gated phase) adds real signature verification
// here, matching the existing webhooks/ghl and webhooks/vapi routes' own pattern of
// failing closed once a real secret exists. Dedup is real regardless: transport-level
// via checkAndRecordReceipt (webhook_receipts), business-level via
// applyPaymentWebhookEvent's receiveInboxEvent (inbox_events) — the same two-layer
// dedup the ghl/vapi routes already use.

import { z } from "zod";
import { applyPaymentWebhookEvent } from "../../../../../../packages/domain-plugins/invoice-to-cash/index";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { errorResponse } from "../../../../lib/auth";

const PaymentWebhookSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  providerEventId: z.string().min(1),
  amountUsd: z.number().positive(),
  status: z.enum(["succeeded", "failed"]),
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
    const parsed = PaymentWebhookSchema.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

    const receipt = await checkAndRecordReceipt("payment_provider", parsed.data.providerEventId, rawBody);
    if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });

    const result = await applyPaymentWebhookEvent({
      tenantId: parsed.data.tenantId,
      invoiceId: parsed.data.invoiceId,
      providerEventId: parsed.data.providerEventId,
      amountUsd: parsed.data.amountUsd,
      status: parsed.data.status,
    });
    return Response.json({ received: true, applied: result.applied });
  } catch (err) {
    return errorResponse(err);
  }
}
