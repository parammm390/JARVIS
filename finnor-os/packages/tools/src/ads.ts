// Ad performance adapter — Meta Marketing API + Google Ads API, real REST calls, no
// mock SDK in between. Mirrors the exa.ts / vapi-rest.ts pattern exactly: wrapped call,
// typed errors, throws IntegrationError with `retryable` set correctly.
//
// Provider selection is automatic and requires NO code change to go live:
//   - META_ADS_ACCESS_TOKEN + META_ADS_ACCOUNT_ID set  -> real Meta data
//   - GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_CLIENT_ID +
//     GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_CUSTOMER_ID set -> real Google Ads data
//   - neither set -> demoAdPerformance() returns clearly-labeled synthetic data so the
//     rest of the system (planner, voice, console) has something real to work against
//     while nobody has connected a real ad account yet.
//
// Google Ads has no static "API key" — it authenticates via OAuth refresh token, which
// is why five env vars are needed instead of one. That is Google's requirement, not an
// extra hoop added here.

import { IntegrationError } from "./errors";

export interface AdCampaignSummary {
  campaign: string;
  spendUsd: number;
  impressions: number;
  clicks: number;
  ctrPct: number;
  costPerClickUsd: number;
  conversions?: number;
}

export interface AdPerformanceReport {
  provider: "meta" | "google_ads" | "demo";
  windowDays: number;
  campaigns: AdCampaignSummary[];
  totalSpendUsd: number;
  totalConversions: number;
}

function metaConfigured(): boolean {
  return Boolean(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
}

function googleAdsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_CUSTOMER_ID,
  );
}

export function adsProviderStatus(): { meta: boolean; googleAds: boolean } {
  return { meta: metaConfigured(), googleAds: googleAdsConfigured() };
}

/** Real Meta Marketing API call — GET /act_{id}/insights, real fields, no fabrication. */
async function fetchMetaPerformance(windowDays: number): Promise<AdPerformanceReport> {
  const token = process.env.META_ADS_ACCESS_TOKEN!;
  const accountId = process.env.META_ADS_ACCOUNT_ID!.replace(/^act_/, "");
  const url =
    `https://graph.facebook.com/v21.0/act_${accountId}/insights` +
    `?level=campaign&date_preset=last_${Math.min(Math.max(windowDays, 1), 90)}d` +
    `&fields=campaign_name,spend,impressions,clicks,ctr,cpc,actions` +
    `&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationError("meta_ads", `Meta insights call failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
  }
  const data = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const campaigns: AdCampaignSummary[] = (data.data ?? []).map((row) => {
    const actions = (row.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
    const conversions = actions.find((a) => a.action_type.includes("lead") || a.action_type.includes("purchase"));
    return {
      campaign: String(row.campaign_name ?? "(unnamed)"),
      spendUsd: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      ctrPct: Number(row.ctr ?? 0),
      costPerClickUsd: Number(row.cpc ?? 0),
      conversions: conversions ? Number(conversions.value) : undefined,
    };
  });
  return {
    provider: "meta",
    windowDays,
    campaigns,
    totalSpendUsd: campaigns.reduce((s, c) => s + c.spendUsd, 0),
    totalConversions: campaigns.reduce((s, c) => s + (c.conversions ?? 0), 0),
  };
}

/** OAuth2 refresh -> short-lived access token, per Google's standard token endpoint. */
async function googleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationError("google_ads", `OAuth token refresh failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new IntegrationError("google_ads", "OAuth refresh returned no access_token", false);
  return data.access_token;
}

/** Real Google Ads API call — searchStream with GAQL, real fields, no fabrication. */
async function fetchGoogleAdsPerformance(windowDays: number): Promise<AdPerformanceReport> {
  const accessToken = await googleAccessToken();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, "");
  const gaql = `
    SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.ctr, metrics.average_cpc, metrics.conversions
    FROM campaign
    WHERE segments.date DURING LAST_${Math.min(Math.max(windowDays, 1), 30) <= 7 ? "7_DAYS" : "30_DAYS"}
  `;
  const res = await fetch(`https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: gaql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationError("google_ads", `Google Ads query failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
  }
  const chunks = (await res.json()) as Array<{ results?: Array<Record<string, unknown>> }>;
  const rows = chunks.flatMap((c) => c.results ?? []);
  const campaigns: AdCampaignSummary[] = rows.map((row) => {
    const campaign = (row.campaign as Record<string, unknown> | undefined) ?? {};
    const metrics = (row.metrics as Record<string, unknown> | undefined) ?? {};
    const costMicros = Number(metrics.costMicros ?? 0);
    return {
      campaign: String(campaign.name ?? "(unnamed)"),
      spendUsd: costMicros / 1_000_000,
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      ctrPct: Number(metrics.ctr ?? 0) * 100,
      costPerClickUsd: Number(metrics.averageCpc ?? 0) / 1_000_000,
      conversions: metrics.conversions !== undefined ? Number(metrics.conversions) : undefined,
    };
  });
  return {
    provider: "google_ads",
    windowDays,
    campaigns,
    totalSpendUsd: campaigns.reduce((s, c) => s + c.spendUsd, 0),
    totalConversions: campaigns.reduce((s, c) => s + (c.conversions ?? 0), 0),
  };
}

/**
 * Realistic, clearly-labeled synthetic data — NOT a live ad account. This exists so
 * the marketing plugin, the planner, and the voice channel all have real shapes to
 * work against before a dealer connects a real ads account. Every number here is
 * fixed and deterministic (no Math.random / Date.now — see workflow script rules),
 * seeded to look like a small local water-treatment dealer's actual spend pattern.
 */
export function demoAdPerformance(windowDays: number): AdPerformanceReport {
  const campaigns: AdCampaignSummary[] = [
    { campaign: "[DEMO] Search — \"water softener near me\"", spendUsd: 412.5, impressions: 8_340, clicks: 214, ctrPct: 2.57, costPerClickUsd: 1.93, conversions: 11 },
    { campaign: "[DEMO] Facebook — Spring filter promo", spendUsd: 260.0, impressions: 21_500, clicks: 187, ctrPct: 0.87, costPerClickUsd: 1.39, conversions: 6 },
    { campaign: "[DEMO] Google Local Services", spendUsd: 590.0, impressions: 4_120, clicks: 98, ctrPct: 2.38, costPerClickUsd: 6.02, conversions: 14 },
  ];
  return {
    provider: "demo",
    windowDays,
    campaigns,
    totalSpendUsd: campaigns.reduce((s, c) => s + c.spendUsd, 0),
    totalConversions: campaigns.reduce((s, c) => s + (c.conversions ?? 0), 0),
  };
}

/** Entry point the marketing plugin calls — provider selection is automatic. */
export async function getAdPerformance(windowDays = 7): Promise<AdPerformanceReport> {
  if (metaConfigured()) return fetchMetaPerformance(windowDays);
  if (googleAdsConfigured()) return fetchGoogleAdsPerformance(windowDays);
  return demoAdPerformance(windowDays);
}
