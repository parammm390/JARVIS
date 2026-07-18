// Stripe payment-link adapter (Phase 15 domain 1 of 2) — plain fetch, no Stripe SDK
// dependency (matches quickbooks.ts's dependency-free approach, keeps the stub-fetch
// test seam available to callers). Uses Checkout Sessions (not the pre-built
// Payment Links API) because sessions accept ad-hoc `price_data` amounts without
// pre-creating catalog Price objects first — exactly the invoice-amount use case,
// where the amount is only known at draft time.

import { IntegrationError, type ProviderHealth } from "./errors";
import type { CreatePaymentLinkInput, CreatePaymentLinkOutput } from "./emulators/accounting-emulator";

export type { CreatePaymentLinkInput, CreatePaymentLinkOutput };

function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeProviderStatus(): { configured: boolean } {
  return { configured: stripeConfigured() };
}

/** Real, cheap Stripe call (GET /v1/balance, the standard health-check endpoint) —
 *  proves the secret key actually works, not just that it's present. Mirrors
 *  quickbooks.ts's testQuickBooksConnection exactly. */
export async function testStripeConnection(): Promise<ProviderHealth> {
  if (!stripeConfigured()) return { configured: false, healthy: null };
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { configured: true, healthy: false, error: `(${res.status}) ${body.slice(0, 200)}` };
    }
    return { configured: true, healthy: true };
  } catch (err) {
    return { configured: true, healthy: false, error: (err as Error).message };
  }
}

/** Real Stripe Checkout Session creation. Idempotency-Key is Stripe-native (the
 *  header, not a body field) — a retried call with the same key returns the
 *  original session rather than creating a duplicate. */
export async function createStripePaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput> {
  if (!stripeConfigured()) {
    throw new IntegrationError("stripe", "Stripe is not connected — STRIPE_SECRET_KEY is not set", false);
  }
  const returnBase = process.env.PAYMENTS_RETURN_URL_BASE ?? "https://finnorai.com/pay";
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(input.amountUsd * 100)),
    "line_items[0][price_data][product_data][name]": `Invoice ${input.invoiceId}`,
    "line_items[0][quantity]": "1",
    "metadata[invoiceId]": input.invoiceId,
    "metadata[tenantId]": input.tenantId,
    "metadata[idempotencyKey]": input.idempotencyKey,
    success_url: `${returnBase}/success`,
    cancel_url: `${returnBase}/cancel`,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = data.error?.message ?? `HTTP ${res.status}`;
    // Auth failures never retry (bad key won't fix itself); anything else may.
    const retryable = res.status !== 401 && res.status !== 403;
    throw new IntegrationError("stripe", message, retryable);
  }
  const session = (await res.json()) as { id: string; url: string };
  return { paymentLinkUrl: session.url, linkId: session.id };
}
