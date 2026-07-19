// Ads adapter (packages/tools/src/ads.ts) had ZERO test coverage before this file —
// a real gap found while auditing Phase 4's actual conformance-test state. Same
// stub-fetch pattern as stripe.test.ts/quickbooks.test.ts: unconfigured state, happy
// path, error mapping, retry semantics — all verifiable without a real Meta/Google
// Ads account (Param's next owner-actions.md step for this provider).

import { describe, it, expect, beforeEach, vi } from "vitest";

const META_ENV_KEYS = ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID"] as const;
const GOOGLE_ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

function clearAllEnv() {
  for (const k of [...META_ENV_KEYS, ...GOOGLE_ENV_KEYS]) delete process.env[k];
}
function setMetaConfigured() {
  process.env.META_ADS_ACCESS_TOKEN = "fake-meta-token";
  process.env.META_ADS_ACCOUNT_ID = "act_123456789";
}
function setGoogleConfigured() {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "fake-dev-token";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "fake-refresh";
  process.env.GOOGLE_ADS_CLIENT_ID = "fake-client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "fake-client-secret";
  process.env.GOOGLE_ADS_CUSTOMER_ID = "123-456-7890";
}
function stubFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }>) {
  const fetchSpy = vi.fn();
  for (const r of responses) fetchSpy.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("ads adapter — unconfigured state", () => {
  beforeEach(() => {
    clearAllEnv();
    vi.unstubAllGlobals();
  });

  it("adsProviderStatus reports both unconfigured when no env vars are set", async () => {
    const { adsProviderStatus } = await import("@finnor/tools");
    expect(adsProviderStatus()).toEqual({ meta: false, googleAds: false });
  });

  it("testAdsConnections returns configured:false, healthy:null for both, no network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { testAdsConnections } = await import("@finnor/tools");
    const result = await testAdsConnections();
    expect(result).toEqual({ meta: { configured: false, healthy: null }, googleAds: { configured: false, healthy: null } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getAdPerformance falls back to clearly-labeled demo data, never a real network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { getAdPerformance } = await import("@finnor/tools");
    const result = await getAdPerformance(7);
    expect(result.provider).toBe("demo");
    expect(result.campaigns.every((c) => c.campaign.startsWith("[DEMO]"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ads adapter — Meta, configured, stub-fetch", () => {
  beforeEach(() => {
    clearAllEnv();
    setMetaConfigured();
    vi.unstubAllGlobals();
  });

  it("testAdsConnections reports meta healthy:true on a real 2xx account response", async () => {
    stubFetchSequence([{ ok: true, json: async () => ({ id: "act_123456789", name: "Finnor Water Co." }) }]);
    const { testAdsConnections } = await import("@finnor/tools");
    const result = await testAdsConnections();
    expect(result.meta).toEqual({ configured: true, healthy: true });
  });

  it("testAdsConnections reports meta healthy:false with the error reason on a non-2xx response", async () => {
    stubFetchSequence([{ ok: false, status: 401, text: async () => "Invalid OAuth access token" }]);
    const { testAdsConnections } = await import("@finnor/tools");
    const result = await testAdsConnections();
    expect(result.meta.configured).toBe(true);
    expect(result.meta.healthy).toBe(false);
    expect(result.meta.error).toContain("401");
  });

  it("getAdPerformance maps real Meta insights response into the shared report shape", async () => {
    stubFetchSequence([
      {
        ok: true,
        json: async () => ({
          data: [
            {
              campaign_name: "Search — water softener",
              spend: "125.50",
              impressions: "4200",
              clicks: "88",
              ctr: "2.1",
              cpc: "1.43",
              actions: [{ action_type: "lead", value: "5" }],
            },
          ],
        }),
      },
    ]);
    const { getAdPerformance } = await import("@finnor/tools");
    const result = await getAdPerformance(7);
    expect(result.provider).toBe("meta");
    expect(result.campaigns).toEqual([
      { campaign: "Search — water softener", spendUsd: 125.5, impressions: 4200, clicks: 88, ctrPct: 2.1, costPerClickUsd: 1.43, conversions: 5 },
    ]);
    expect(result.totalSpendUsd).toBe(125.5);
    expect(result.totalConversions).toBe(5);
  });

  it("a non-2xx Meta insights response maps to IntegrationError, retryable on 5xx", async () => {
    stubFetchSequence([{ ok: false, status: 500, text: async () => "Internal error" }]);
    const { getAdPerformance } = await import("@finnor/tools");
    await expect(getAdPerformance(7)).rejects.toMatchObject({ retryable: true });
  });

  it("a 400 Meta insights response is never retryable", async () => {
    stubFetchSequence([{ ok: false, status: 400, text: async () => "Bad request" }]);
    const { getAdPerformance } = await import("@finnor/tools");
    await expect(getAdPerformance(7)).rejects.toMatchObject({ retryable: false });
  });
});

describe("ads adapter — Google Ads, configured, stub-fetch", () => {
  beforeEach(() => {
    clearAllEnv();
    setGoogleConfigured();
    vi.unstubAllGlobals();
  });

  it("testAdsConnections reports googleAds healthy:true when the OAuth refresh succeeds", async () => {
    stubFetchSequence([{ ok: true, json: async () => ({ access_token: "fake-access-token" }) }]);
    const { testAdsConnections } = await import("@finnor/tools");
    const result = await testAdsConnections();
    expect(result.googleAds).toEqual({ configured: true, healthy: true });
  });

  it("testAdsConnections reports googleAds healthy:false when the OAuth refresh fails", async () => {
    stubFetchSequence([{ ok: false, status: 400, text: async () => "invalid_grant" }]);
    const { testAdsConnections } = await import("@finnor/tools");
    const result = await testAdsConnections();
    expect(result.googleAds.configured).toBe(true);
    expect(result.googleAds.healthy).toBe(false);
  });

  it("getAdPerformance maps a real Google Ads searchStream response into the shared report shape", async () => {
    stubFetchSequence([
      { ok: true, json: async () => ({ access_token: "fake-access-token" }) },
      {
        ok: true,
        json: async () => [
          {
            results: [
              {
                campaign: { name: "Google Local Services" },
                metrics: { costMicros: "45000000", impressions: "1200", clicks: "30", ctr: "0.025", averageCpc: "1500000", conversions: "3" },
              },
            ],
          },
        ],
      },
    ]);
    const { getAdPerformance } = await import("@finnor/tools");
    const result = await getAdPerformance(7);
    expect(result.provider).toBe("google_ads");
    expect(result.campaigns).toEqual([
      { campaign: "Google Local Services", spendUsd: 45, impressions: 1200, clicks: 30, ctrPct: 2.5, costPerClickUsd: 1.5, conversions: 3 },
    ]);
  });

  it("meta takes priority over Google Ads when both are configured", async () => {
    setMetaConfigured();
    stubFetchSequence([{ ok: true, json: async () => ({ data: [] }) }]);
    const { getAdPerformance } = await import("@finnor/tools");
    const result = await getAdPerformance(7);
    expect(result.provider).toBe("meta");
  });
});

describe("ads-write adapter — dry-run posture (no live write-scope OAuth exists)", () => {
  beforeEach(() => {
    delete process.env.META_ADS_WRITE_ENABLED;
    delete process.env.GOOGLE_ADS_WRITE_ENABLED;
  });

  it("launchAdCampaign always returns a clearly-labeled dry-run result when write access isn't configured", async () => {
    const { launchAdCampaign } = await import("@finnor/tools");
    const result = await launchAdCampaign({ name: "Spring Promo", dailyBudgetUsd: 25 });
    expect(result.mode).toBe("dry_run");
    expect(result.provider).toBe("none");
    expect(result.note).toContain("[DRY RUN]");
    expect(result.note).toContain("Spring Promo");
  });

  it("adsWriteProviderStatus reflects the write-scope env flags, independent of the read-scope ones", async () => {
    const { adsWriteProviderStatus } = await import("@finnor/tools");
    expect(adsWriteProviderStatus()).toEqual({ writeEnabled: false });
    process.env.META_ADS_WRITE_ENABLED = "1";
    const { adsWriteProviderStatus: check2 } = await import("@finnor/tools");
    expect(check2()).toEqual({ writeEnabled: true });
  });

  it("launchAdCampaign fails loudly (never a silent success) once write access is flagged on but the live call isn't built", async () => {
    process.env.META_ADS_WRITE_ENABLED = "1";
    const { launchAdCampaign, IntegrationError } = await import("@finnor/tools");
    await expect(launchAdCampaign({ name: "X", dailyBudgetUsd: 10 })).rejects.toThrow(IntegrationError);
  });
});
