// QuickBooks adapter — unconfigured state must be explicit and never attempt a real
// network call, same contract every other adapter (ads.ts, exa.ts, vapi-rest.ts) holds.
// Phase 4: added stub-fetch coverage (happy path, error mapping, retry semantics)
// matching tests/unit/stripe.test.ts / docusign.test.ts's own pattern — this adapter
// had only the unconfigured-state tests before, a real, concrete gap since it's the
// one provider closest to going live (Param's next owner action, per owner-actions.md).

import { describe, it, expect, beforeEach, vi } from "vitest";

const ENV_KEYS = ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN", "QUICKBOOKS_REALM_ID"] as const;

function setConfigured() {
  process.env.QUICKBOOKS_CLIENT_ID = "test-client-id";
  process.env.QUICKBOOKS_CLIENT_SECRET = "test-secret";
  process.env.QUICKBOOKS_REFRESH_TOKEN = "test-refresh";
  process.env.QUICKBOOKS_REALM_ID = "12345";
}

const tokenResponse = { ok: true, json: async () => ({ access_token: "fake-access-token" }) };
function stubFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }>) {
  const fetchSpy = vi.fn();
  for (const r of responses) fetchSpy.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("quickbooks adapter — unconfigured state", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("quickbooksProviderStatus reports not configured when no env vars are set", async () => {
    const { quickbooksProviderStatus } = await import("@finnor/tools");
    expect(quickbooksProviderStatus()).toEqual({ configured: false });
  });

  it("testQuickBooksConnection returns configured:false, healthy:null without any network call", async () => {
    const { testQuickBooksConnection } = await import("@finnor/tools");
    const result = await testQuickBooksConnection();
    expect(result).toEqual({ configured: false, healthy: null });
  });

  it("syncInvoiceToQuickBooks throws a clear IntegrationError when not connected", async () => {
    const { syncInvoiceToQuickBooks, IntegrationError } = await import("@finnor/tools");
    await expect(syncInvoiceToQuickBooks({ customerName: "Test Customer", amountUsd: 100 })).rejects.toThrow(IntegrationError);
  });

  it("reports configured:true once all four env vars are present (still untested against a real account)", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "test-client-id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "test-secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "test-refresh";
    process.env.QUICKBOOKS_REALM_ID = "12345";
    const { quickbooksProviderStatus } = await import("@finnor/tools");
    expect(quickbooksProviderStatus()).toEqual({ configured: true });
  });
});

describe("quickbooks adapter — configured, stub-fetch", () => {
  beforeEach(() => {
    setConfigured();
    vi.unstubAllGlobals();
  });

  it("happy path, existing customer: token refresh -> customer found by search -> invoice created", async () => {
    const fetchSpy = stubFetchSequence([
      tokenResponse,
      { ok: true, json: async () => ({ QueryResponse: { Customer: [{ Id: "cust-1", DisplayName: "Jane Doe" }] } }) },
      { ok: true, json: async () => ({ Invoice: { Id: "inv-99" } }) },
    ]);
    const { syncInvoiceToQuickBooks } = await import("@finnor/tools");
    const result = await syncInvoiceToQuickBooks({ customerName: "Jane Doe", amountUsd: 249, memo: "AMC renewal" });
    expect(result).toEqual({ quickbooksInvoiceId: "inv-99", quickbooksCustomerId: "cust-1" });
    expect(fetchSpy).toHaveBeenCalledTimes(3); // token, search, invoice create -- no customer-create call when one was found
  });

  it("happy path, new customer: search finds nothing -> customer created -> invoice created", async () => {
    const fetchSpy = stubFetchSequence([
      tokenResponse,
      { ok: true, json: async () => ({ QueryResponse: {} }) }, // no Customer array -- none found
      { ok: true, json: async () => ({ Customer: { Id: "cust-new", DisplayName: "New Customer" } }) },
      { ok: true, json: async () => ({ Invoice: { Id: "inv-100" } }) },
    ]);
    const { syncInvoiceToQuickBooks } = await import("@finnor/tools");
    const result = await syncInvoiceToQuickBooks({ customerName: "New Customer", amountUsd: 100 });
    expect(result).toEqual({ quickbooksInvoiceId: "inv-100", quickbooksCustomerId: "cust-new" });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("OAuth token refresh failure surfaces as a clear IntegrationError, no invoice/customer calls attempted", async () => {
    const fetchSpy = stubFetchSequence([{ ok: false, status: 401, text: async () => "invalid_grant" }]);
    const { syncInvoiceToQuickBooks, IntegrationError } = await import("@finnor/tools");
    await expect(syncInvoiceToQuickBooks({ customerName: "X", amountUsd: 10 })).rejects.toThrow(IntegrationError);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // failed at the token step -- never reached customer/invoice
  });

  it("a non-2xx invoice-create response maps to a retryable IntegrationError on 5xx", async () => {
    stubFetchSequence([
      tokenResponse,
      { ok: true, json: async () => ({ QueryResponse: { Customer: [{ Id: "cust-1", DisplayName: "Jane" }] } }) },
      { ok: false, status: 503, text: async () => "Service temporarily unavailable" },
    ]);
    const { syncInvoiceToQuickBooks } = await import("@finnor/tools");
    await expect(syncInvoiceToQuickBooks({ customerName: "Jane", amountUsd: 10 })).rejects.toMatchObject({ retryable: true });
  });

  it("a 400 invoice-create response is never retryable", async () => {
    stubFetchSequence([
      tokenResponse,
      { ok: true, json: async () => ({ QueryResponse: { Customer: [{ Id: "cust-1", DisplayName: "Jane" }] } }) },
      { ok: false, status: 400, text: async () => "Malformed invoice" },
    ]);
    const { syncInvoiceToQuickBooks } = await import("@finnor/tools");
    await expect(syncInvoiceToQuickBooks({ customerName: "Jane", amountUsd: 10 })).rejects.toMatchObject({ retryable: false });
  });

  it("testQuickBooksConnection reports healthy:true on a real 2xx CompanyInfo response", async () => {
    stubFetchSequence([tokenResponse, { ok: true, json: async () => ({ CompanyInfo: { CompanyName: "Test Co" } }) }]);
    const { testQuickBooksConnection } = await import("@finnor/tools");
    expect(await testQuickBooksConnection()).toEqual({ configured: true, healthy: true });
  });

  it("testQuickBooksConnection reports healthy:false with the error reason on a non-2xx response", async () => {
    stubFetchSequence([tokenResponse, { ok: false, status: 403, text: async () => "Forbidden" }]);
    const { testQuickBooksConnection } = await import("@finnor/tools");
    const result = await testQuickBooksConnection();
    expect(result.configured).toBe(true);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("403");
  });
});
