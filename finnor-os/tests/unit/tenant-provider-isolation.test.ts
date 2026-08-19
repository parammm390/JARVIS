import { afterEach, describe, expect, it, vi } from "vitest";
import { createCredentialContextForTesting } from "@finnor/security";
import { createStripePaymentLink, testStripeConnection } from "@finnor/tools";

const TENANT_A = "10000000-0000-4000-8000-00000000000a";
const TENANT_B = "10000000-0000-4000-8000-00000000000b";

function stripeContext(tenantId: string, secretKey: string) {
  return createCredentialContextForTesting(tenantId, "stripe", { secretKey });
}

afterEach(() => vi.unstubAllGlobals());

describe("provider credential context isolation", () => {
  it("uses two tenant accounts concurrently without reading or mutating process.env", async () => {
    const previousGlobal = process.env.STRIPE_SECRET_KEY;
    const calls: Array<{ authorization: string; tenantId: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = String((init?.headers as Record<string, string>).Authorization);
      const body = init?.body as URLSearchParams;
      const tenantId = String(body.get("metadata[tenantId]"));
      calls.push({ authorization, tenantId });
      await new Promise((resolve) => setTimeout(resolve, authorization.endsWith("dealer-a") ? 5 : 0));
      return new Response(JSON.stringify({ id: `session-${tenantId}`, url: `https://checkout.example/${tenantId}` }), { status: 200 });
    }));

    const [a, b] = await Promise.all([
      createStripePaymentLink({ tenantId: TENANT_A, invoiceId: "invoice-a", amountUsd: 10, idempotencyKey: "a" }, stripeContext(TENANT_A, "key-dealer-a")),
      createStripePaymentLink({ tenantId: TENANT_B, invoiceId: "invoice-b", amountUsd: 20, idempotencyKey: "b" }, stripeContext(TENANT_B, "key-dealer-b")),
    ]);

    expect(a.linkId).toBe(`session-${TENANT_A}`);
    expect(b.linkId).toBe(`session-${TENANT_B}`);
    expect(calls).toEqual(expect.arrayContaining([
      { authorization: "Bearer key-dealer-a", tenantId: TENANT_A },
      { authorization: "Bearer key-dealer-b", tenantId: TENANT_B },
    ]));
    expect(process.env.STRIPE_SECRET_KEY).toBe(previousGlobal);
  });

  it("reports health for the credential context actually supplied", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = String((init?.headers as Record<string, string>).Authorization);
      return new Response("{}", { status: authorization.endsWith("dealer-a") ? 200 : 401 });
    }));

    const [a, b] = await Promise.all([
      testStripeConnection(stripeContext(TENANT_A, "key-dealer-a")),
      testStripeConnection(stripeContext(TENANT_B, "key-dealer-b")),
    ]);
    expect(a).toEqual({ configured: true, healthy: true });
    expect(b).toEqual({ configured: true, healthy: false, error: "Stripe balance check failed (401)" });
  });

  it("fails closed on a tenant/context mismatch and never reaches the provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      createStripePaymentLink({ tenantId: TENANT_B, invoiceId: "invoice-b", amountUsd: 20, idempotencyKey: "b" }, stripeContext(TENANT_A, "key-dealer-a")),
    ).rejects.toThrow(/tenant mismatch/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not copy provider response bodies or secret values into errors", async () => {
    const secret = "credential-value-that-must-not-be-persisted";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: secret }), { status: 401 })));
    let error: Error | undefined;
    try {
      await createStripePaymentLink(
        { tenantId: TENANT_A, invoiceId: "invoice-a", amountUsd: 10, idempotencyKey: "a" },
        stripeContext(TENANT_A, secret),
      );
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("401");
    expect(error!.message).not.toContain(secret);
  });
});
