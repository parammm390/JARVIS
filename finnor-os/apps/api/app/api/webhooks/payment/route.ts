// POST /api/webhooks/payment — vertical workflow 4's payment-webhook + reconciliation
// steps (docs/jarvis-90-execution-blueprint.md §4.4). Phase 15 adds real Stripe
// signature verification once STRIPE_WEBHOOK_SECRET exists, matching the existing
// webhooks/ghl and webhooks/vapi routes' own pattern of failing closed once a real
// secret exists. The generic emulator/bridge shape uses its own timestamped shared
// secret plus an opaque tenant-bound route in every environment. Replay claiming,
// canonical payment state, integration event matching, and wake enqueue commit as one
// tenant transaction inside applyPaymentWebhookEvent.

import { z } from "zod";
import { applyPaymentWebhookEvent } from "../../../../../../packages/domain-plugins/invoice-to-cash/index";
import { errorResponse } from "../../../../lib/auth";
import { verifyTimestampedHmacSignature } from "../../../../lib/verify-hmac-signature";
import { logWithTrace } from "@finnor/tools";
import { resolveTenantCredentialContext } from "@finnor/security";
import { getPool } from "@finnor/db";

const PaymentWebhookSchema = z.object({
  invoiceId: z.string().uuid(),
  providerEventId: z.string().min(1),
  amountUsd: z.number().positive(),
  status: z.enum(["succeeded", "failed"]),
}).strict();

// Stripe's checkout.session.completed event — only the fields this route reads.
// tenantId/invoiceId round-trip via the metadata createStripePaymentLink set at
// session-creation time (packages/tools/src/stripe.ts).
const StripeCheckoutSessionEventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string().min(1).optional(),
      amount_total: z.number().nullable().optional(),
      metadata: z.object({ tenantId: z.string().uuid().optional(), invoiceId: z.string().uuid().optional() }).optional(),
    }),
  }),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    let json: unknown = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      // Both provider and emulator schemas below return the same bounded error.
    }
    const stripeEvent = StripeCheckoutSessionEventSchema.safeParse(json);

    if (stripeEvent.success) {
      const event = stripeEvent.data;
      const metadata = event.data.object.metadata;
      if (!metadata?.tenantId) return Response.json({ error: "Stripe event missing tenantId metadata" }, { status: 400 });
      let stripeSecret: string | undefined;
      let stripeIntegrationId: string | null = null;
      try {
        const credential = await resolveTenantCredentialContext(metadata.tenantId, "stripe");
        stripeSecret = credential.credentials.webhookSecret;
        stripeIntegrationId = credential.integration.id;
      } catch {
        // Missing/invalid tenant credentials remain an unsigned failure in production;
        // they never fall through to a process-global Stripe account.
      }
      const verified = verifyTimestampedHmacSignature(req, {
        header: "stripe-signature",
        secret: stripeSecret,
        rawBody,
        allowUnsetSecret: process.env.NODE_ENV !== "production",
      });
      if (!verified) {
        logWithTrace({ route: "webhooks/payment", tenantId: metadata.tenantId }).warn({ event: "webhook_signature_rejected", provider: "stripe" }, "rejected webhook: bad stripe-signature");
        return Response.json({ error: "Bad signature" }, { status: 401 });
      }

      if (event.type !== "checkout.session.completed") {
        return Response.json({ received: true, ignored: true });
      }
      if (!metadata.invoiceId) {
        return Response.json({ error: "checkout.session.completed missing tenantId/invoiceId metadata" }, { status: 400 });
      }
      if (!stripeIntegrationId || !event.data.object.id) {
        return Response.json({ error: "BLOCKED-CONFIG: Stripe webhook is not bound to one exact tenant integration/session" }, { status: 409 });
      }

      const result = await applyPaymentWebhookEvent({
        tenantId: metadata.tenantId,
        invoiceId: metadata.invoiceId,
        providerEventId: event.id,
        amountUsd: (event.data.object.amount_total ?? 0) / 100,
        status: "succeeded",
        provider: "stripe",
        integrationId: stripeIntegrationId,
        externalObjectType: "checkout_session",
        externalObjectId: event.data.object.id,
      });
      return Response.json({ received: true, applied: result.applied, duplicate: result.reason === "duplicate delivery" });
    }

    // Generic emulator/bridge delivery has no platform-native signature, so it uses
    // an explicit timestamped shared secret and opaque tenant-bound route. The body
    // never selects a tenant, in any environment.
    const emulatorVerified = verifyTimestampedHmacSignature(req, {
      header: "x-payment-signature",
      secret: process.env.PAYMENT_EMULATOR_WEBHOOK_SECRET,
      rawBody,
      allowUnsetSecret: false,
    });
    if (!emulatorVerified) {
      logWithTrace({ route: "webhooks/payment" }).warn(
        { event: "webhook_signature_rejected", provider: "payment_emulator" },
        "rejected emulator webhook: bad x-payment-signature",
      );
      return Response.json({ error: "Bad signature" }, { status: 401 });
    }

    const parsed = PaymentWebhookSchema.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });
    const routeId = req.headers.get("x-finnor-route-id")?.trim() ?? "";
    if (!routeId) return Response.json({ error: "Missing tenant-bound webhook route" }, { status: 400 });
    const resolved = await getPool().query<{ tenant_id: string | null }>(
      "SELECT finnor_os.resolve_inbound_provider_tenant('payment_emulator',$1) tenant_id",
      [routeId],
    );
    const tenantId = resolved.rows[0]?.tenant_id;
    if (!tenantId) return Response.json({ error: "Webhook route is not mapped to exactly one tenant" }, { status: 400 });

    const result = await applyPaymentWebhookEvent({
      tenantId,
      invoiceId: parsed.data.invoiceId,
      providerEventId: parsed.data.providerEventId,
      amountUsd: parsed.data.amountUsd,
      status: parsed.data.status,
    });
    return Response.json({ received: true, applied: result.applied, duplicate: result.reason === "duplicate delivery" });
  } catch (err) {
    return errorResponse(err);
  }
}
