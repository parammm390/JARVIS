// Stripe adapter — unconfigured state must be explicit and never attempt a real
// network call (same contract quickbooks.ts/ads.ts hold), plus stub-fetch coverage
// of the happy path, API-error mapping, and the never-retry-on-401/403 property.

import { describe, it, expect, beforeEach, vi } from "vitest";

function stubFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("stripe adapter — unconfigured state", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  it("stripeProviderStatus reports not configured when no env var is set", async () => {
    const { stripeProviderStatus } = await import("@finnor/tools");
    expect(stripeProviderStatus()).toEqual({ configured: false });
  });

  it("createStripePaymentLink throws a clear IntegrationError when not connected, with no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { createStripePaymentLink, IntegrationError } = await import("@finnor/tools");
    await expect(
      createStripePaymentLink({ tenantId: "00000000-0000-4000-8000-0000000000e4", invoiceId: "inv-1", amountUsd: 100, idempotencyKey: "k1" }),
    ).rejects.toThrow(IntegrationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports configured:true once the env var is present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const { stripeProviderStatus } = await import("@finnor/tools");
    expect(stripeProviderStatus()).toEqual({ configured: true });
  });
});

describe("stripe adapter — configured, stub-fetch", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.unstubAllGlobals();
  });

  it("happy path: maps the Checkout Session response to {paymentLinkUrl, linkId}", async () => {
    stubFetchOnce({ ok: true, json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" }) });
    const { createStripePaymentLink } = await import("@finnor/tools");
    const result = await createStripePaymentLink({
      tenantId: "00000000-0000-4000-8000-0000000000e4",
      invoiceId: "inv-1",
      amountUsd: 250.5,
      idempotencyKey: "k1",
    });
    expect(result).toEqual({ paymentLinkUrl: "https://checkout.stripe.com/pay/cs_test_123", linkId: "cs_test_123" });
  });

  it("sends the Idempotency-Key header derived from input.idempotencyKey", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1" }) });
    vi.stubGlobal("fetch", fetchSpy);
    const { createStripePaymentLink } = await import("@finnor/tools");
    await createStripePaymentLink({ tenantId: "00000000-0000-4000-8000-0000000000e4", invoiceId: "inv-1", amountUsd: 10, idempotencyKey: "my-key" });
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("my-key");
  });

  it("maps a non-2xx response to IntegrationError with Stripe's error.message", async () => {
    stubFetchOnce({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid amount" } }) });
    const { createStripePaymentLink, IntegrationError } = await import("@finnor/tools");
    await expect(
      createStripePaymentLink({ tenantId: "00000000-0000-4000-8000-0000000000e4", invoiceId: "inv-1", amountUsd: 10, idempotencyKey: "k2" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Invalid amount") } as Partial<InstanceType<typeof IntegrationError>>);
  });

  it("401 is never retryable — a bad key won't fix itself on retry", async () => {
    stubFetchOnce({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API Key" } }) });
    const { createStripePaymentLink } = await import("@finnor/tools");
    await expect(
      createStripePaymentLink({ tenantId: "00000000-0000-4000-8000-0000000000e4", invoiceId: "inv-1", amountUsd: 10, idempotencyKey: "k3" }),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("500 is retryable — a transient Stripe outage may recover", async () => {
    stubFetchOnce({ ok: false, status: 500, json: async () => ({ error: { message: "Internal error" } }) });
    const { createStripePaymentLink } = await import("@finnor/tools");
    await expect(
      createStripePaymentLink({ tenantId: "00000000-0000-4000-8000-0000000000e4", invoiceId: "inv-1", amountUsd: 10, idempotencyKey: "k4" }),
    ).rejects.toMatchObject({ retryable: true });
  });
});
