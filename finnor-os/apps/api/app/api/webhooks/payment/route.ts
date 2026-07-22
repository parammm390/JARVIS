// POST /api/webhooks/payment — vertical workflow 4's payment-webhook + reconciliation
// steps (docs/jarvis-90-execution-blueprint.md §4.4). Phase 15 adds real Stripe
// signature verification once STRIPE_WEBHOOK_SECRET exists, matching the existing
// webhooks/ghl and webhooks/vapi routes' own pattern of failing closed once a real
// secret exists. Absent that secret, the original generic emulator/dev shape stays
// accepted OUTSIDE production only (A3.T6: this route used to accept it unconditionally
// in every env, the one webhook route that didn't match every other route's own
// "unset secret = accept-all only outside production, never in it" posture — a deploy
// with PAYMENTS_BINDING=stripe but no webhook secret yet configured doesn't silently
// stop working in dev, but production now fails closed like everywhere else). Dedup is
// real regardless: transport-level via checkAndRecordReceipt (webhook_receipts),
// business-level via applyPaymentWebhookEvent's receiveInboxEvent (inbox_events) —
// the same two-layer dedup the ghl/vapi routes already use.

import { z } from "zod";
import { applyPaymentWebhookEvent } from "../../../../../../packages/domain-plugins/invoice-to-cash/index";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { errorResponse } from "../../../../lib/auth";
import { verifyTimestampedHmacSignature } from "../../../../lib/verify-hmac-signature";
import { logWithTrace } from "@finnor/tools";

const PaymentWebhookSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  providerEventId: z.string().min(1),
  amountUsd: z.number().positive(),
  status: z.enum(["succeeded", "failed"]),
});

// Stripe's checkout.session.completed event — only the fields this route reads.
// tenantId/invoiceId round-trip via the metadata createStripePaymentLink set at
// session-creation time (packages/tools/src/stripe.ts).
const StripeCheckoutSessionEventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  data: z.object({
    object: z.object({
      amount_total: z.number().nullable().optional(),
      metadata: z.object({ tenantId: z.string().uuid().optional(), invoiceId: z.string().uuid().optional() }).optional(),
    }),
  }),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (stripeSecret) {
      // Real provider active — fail closed. stripe-signature is the same
      // `t=<unix>,v1=<hex hmac>` shape the Vapi route already verifies.
      const verified = verifyTimestampedHmacSignature(req, {
        header: "stripe-signature",
        secret: stripeSecret,
        rawBody,
        allowUnsetSecret: false,
      });
      if (!verified) {
        logWithTrace({ route: "webhooks/payment" }).warn({ event: "webhook_signature_rejected", provider: "stripe" }, "rejected webhook: bad stripe-signature");
        return Response.json({ error: "Bad signature" }, { status: 401 });
      }

      let json: unknown = null;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "Malformed webhook" }, { status: 400 });
      }
      const parsed = StripeCheckoutSessionEventSchema.safeParse(json);
      if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });
      const event = parsed.data;

      if (event.type !== "checkout.session.completed") {
        return Response.json({ received: true, ignored: true });
      }
      const metadata = event.data.object.metadata;
      if (!metadata?.tenantId || !metadata?.invoiceId) {
        return Response.json({ error: "checkout.session.completed missing tenantId/invoiceId metadata" }, { status: 400 });
      }

      const receipt = await checkAndRecordReceipt("stripe", event.id, rawBody);
      if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });

      const result = await applyPaymentWebhookEvent({
        tenantId: metadata.tenantId,
        invoiceId: metadata.invoiceId,
        providerEventId: event.id,
        amountUsd: (event.data.object.amount_total ?? 0) / 100,
        status: "succeeded",
      });
      return Response.json({ received: true, applied: result.applied });
    }

    // A3.T6: no STRIPE_WEBHOOK_SECRET configured — same fail posture as every other
    // webhook route in this repo (ghl/vapi/esign): accept-all is a dev convenience
    // ONLY, never in production. Before this gate existed, this route was the one
    // exception that accepted an unsigned, caller-supplied-tenantId payload in
    // production too — a real, live gap (anyone who knew a tenantId could POST a fake
    // "payment succeeded" event and have it applied) whenever PAYMENTS_BINDING wasn't
    // yet stripe with its secret configured.
    if (process.env.NODE_ENV === "production") {
      logWithTrace({ route: "webhooks/payment" }).warn(
        { event: "webhook_signature_rejected", provider: "payment_provider", reason: "no STRIPE_WEBHOOK_SECRET configured in production" },
        "rejected webhook: no verification secret configured in production",
      );
      return Response.json({ error: "Bad signature" }, { status: 401 });
    }

    // No real provider configured, non-production — original generic emulator/dev shape, unchanged.
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
