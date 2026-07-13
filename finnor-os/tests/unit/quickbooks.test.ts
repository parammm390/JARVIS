// QuickBooks adapter — unconfigured state must be explicit and never attempt a real
// network call, same contract every other adapter (ads.ts, exa.ts, vapi-rest.ts) holds.

import { describe, it, expect, beforeEach } from "vitest";

const ENV_KEYS = ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN", "QUICKBOOKS_REALM_ID"] as const;

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
