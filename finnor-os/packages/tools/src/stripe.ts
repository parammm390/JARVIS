// Stripe payment-link adapter (Phase 15 domain 1 of 2) — plain fetch, no Stripe SDK
// dependency (matches quickbooks.ts's dependency-free approach, keeps the stub-fetch
// test seam available to callers). Uses Checkout Sessions (not the pre-built
// Payment Links API) because sessions accept ad-hoc `price_data` amounts without
// pre-creating catalog Price objects first — exactly the invoice-amount use case,
// where the amount is only known at draft time.

import { IntegrationError, type ProviderHealth } from "./errors";
import type { CreatePaymentLinkInput, CreatePaymentLinkOutput } from "./emulators/accounting-emulator";
import type { TenantCredentialContext } from "@finnor/security";

export type { CreatePaymentLinkInput, CreatePaymentLinkOutput };

export type StripeCredentialContext = TenantCredentialContext<"stripe">;

export function stripeProviderStatus(context: StripeCredentialContext | null): { configured: boolean } {
  return { configured: Boolean(context) };
}

/** Real, cheap Stripe call (GET /v1/balance, the standard health-check endpoint) —
 *  proves the secret key actually works, not just that it's present. Mirrors
 *  quickbooks.ts's testQuickBooksConnection exactly. */
export async function testStripeConnection(context: StripeCredentialContext): Promise<ProviderHealth> {
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${context.credentials.secretKey}` },
    });
    if (!res.ok) {
      return { configured: true, healthy: false, error: `Stripe balance check failed (${res.status})` };
    }
    return { configured: true, healthy: true };
  } catch {
    return { configured: true, healthy: false, error: "Stripe authenticated connection failed" };
  }
}

/** Real Stripe Checkout Session creation. Idempotency-Key is Stripe-native (the
 *  header, not a body field) — a retried call with the same key returns the
 *  original session rather than creating a duplicate. */
export async function createStripePaymentLink(input: CreatePaymentLinkInput, context: StripeCredentialContext): Promise<CreatePaymentLinkOutput> {
  if (context.tenantId !== input.tenantId) throw new IntegrationError("stripe", "Stripe credential context tenant mismatch", false);
  const returnBase = context.credentials.returnUrlBase ?? "https://finnorai.com/pay";
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
      Authorization: `Bearer ${context.credentials.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body,
  });
  if (!res.ok) {
    // Auth failures never retry (bad key won't fix itself); anything else may.
    const retryable = res.status !== 401 && res.status !== 403;
    throw new IntegrationError("stripe", `Checkout Session creation failed (${res.status})`, retryable);
  }
  const session = (await res.json()) as { id: string; url: string };
  return { paymentLinkUrl: session.url, linkId: session.id };
}

export interface StripeCheckoutSession extends Record<string, unknown> {
  id: string;
  status?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string>;
  payment_intent?: string | Record<string, unknown> | null;
}

export async function readStripeCheckoutSession(id: string, context: StripeCredentialContext): Promise<StripeCheckoutSession | null> {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${context.credentials.secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    throw new IntegrationError("stripe", `Checkout Session read failed (${response.status})`, !authFailure && (response.status === 429 || response.status >= 500), authFailure ? "auth" : "retryable");
  }
  return response.json() as Promise<StripeCheckoutSession>;
}
