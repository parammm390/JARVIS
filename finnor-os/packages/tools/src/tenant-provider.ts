import {
  resolveSystemCredentialContext,
  resolveTenantCredentialContext,
  TenantCredentialError,
  type TenantCredentialContext,
  type TenantCredentialProvider,
} from "@finnor/security";
import type { ProviderHealth } from "./errors";
import { testQuickBooksConnection } from "./quickbooks";
import { testStripeConnection } from "./stripe";
import { testDocusignConnection } from "./docusign";
import { testVapiAssistants, testVapiConnection, testGhlConnection, type VoiceAssistantHealth } from "./health";
import { getAdPerformance, testAdsConnections, type AdPerformanceReport, type AdsCredentialContexts } from "./ads";

function resolutionHealth(error: unknown, provider: TenantCredentialProvider): ProviderHealth {
  if (error instanceof TenantCredentialError) {
    if (error.code === "integration_not_bound") return { configured: false, healthy: null };
    return { configured: false, healthy: false, error: `${provider} tenant credentials are unavailable (${error.code})` };
  }
  return { configured: false, healthy: false, error: `${provider} tenant credential resolution failed` };
}

async function resolved<P extends TenantCredentialProvider>(tenantId: string, provider: P): Promise<TenantCredentialContext<P> | null> {
  try {
    return await resolveTenantCredentialContext(tenantId, provider);
  } catch (error) {
    if (error instanceof TenantCredentialError && error.code === "integration_not_bound") return null;
    throw error;
  }
}

export function resolveTenantVapiContext(tenantId: string): Promise<TenantCredentialContext<"vapi">> {
  return resolveTenantCredentialContext(tenantId, "vapi");
}

export async function resolveTenantResendContext(tenantId: string): Promise<TenantCredentialContext<"resend">> {
  try {
    return await resolveTenantCredentialContext(tenantId, "resend");
  } catch (error) {
    // Only absence of a tenant-specific Resend binding can use the explicitly
    // enabled Finnor system sender. A broken/invalid tenant reference never falls
    // through to the system account.
    if (error instanceof TenantCredentialError && error.code === "integration_not_bound") {
      return resolveSystemCredentialContext(tenantId, "resend");
    }
    throw error;
  }
}

export async function tenantProviderConfigured(tenantId: string, provider: TenantCredentialProvider): Promise<boolean> {
  try {
    if (provider === "resend") await resolveTenantResendContext(tenantId);
    else await resolveTenantCredentialContext(tenantId, provider);
    return true;
  } catch {
    return false;
  }
}

export async function testTenantQuickBooksConnection(tenantId: string): Promise<ProviderHealth> {
  try {
    return testQuickBooksConnection(await resolveTenantCredentialContext(tenantId, "quickbooks"));
  } catch (error) {
    return resolutionHealth(error, "quickbooks");
  }
}

export async function testTenantStripeConnection(tenantId: string): Promise<ProviderHealth> {
  try {
    return testStripeConnection(await resolveTenantCredentialContext(tenantId, "stripe"));
  } catch (error) {
    return resolutionHealth(error, "stripe");
  }
}

export async function testTenantDocusignConnection(tenantId: string): Promise<ProviderHealth> {
  try {
    return testDocusignConnection(await resolveTenantCredentialContext(tenantId, "docusign"));
  } catch (error) {
    return resolutionHealth(error, "docusign");
  }
}

export async function testTenantVapiConnection(tenantId: string): Promise<ProviderHealth> {
  try {
    return testVapiConnection(await resolveTenantCredentialContext(tenantId, "vapi"));
  } catch (error) {
    return resolutionHealth(error, "vapi");
  }
}

export async function testTenantVapiAssistants(tenantId: string): Promise<VoiceAssistantHealth[]> {
  try {
    return testVapiAssistants(await resolveTenantCredentialContext(tenantId, "vapi"));
  } catch (error) {
    const health = resolutionHealth(error, "vapi");
    return [{ agentKey: "jarvis", personaKey: "main", ...health }];
  }
}

export async function testTenantGhlConnection(tenantId: string): Promise<ProviderHealth> {
  try {
    return testGhlConnection(await resolveTenantCredentialContext(tenantId, "ghl"));
  } catch (error) {
    return resolutionHealth(error, "ghl");
  }
}

async function adsContexts(tenantId: string): Promise<AdsCredentialContexts> {
  const [meta, googleAds] = await Promise.all([resolved(tenantId, "meta_ads"), resolved(tenantId, "google_ads")]);
  return { ...(meta ? { meta } : {}), ...(googleAds ? { googleAds } : {}) };
}

async function resolveForHealth<P extends "meta_ads" | "google_ads">(
  tenantId: string,
  provider: P,
): Promise<{ context: TenantCredentialContext<P> | null; error: unknown | null }> {
  try {
    return { context: await resolved(tenantId, provider), error: null };
  } catch (error) {
    return { context: null, error };
  }
}

export async function testTenantAdsConnections(tenantId: string): Promise<{ meta: ProviderHealth; googleAds: ProviderHealth }> {
  const [metaResolution, googleResolution] = await Promise.all([
    resolveForHealth(tenantId, "meta_ads"),
    resolveForHealth(tenantId, "google_ads"),
  ]);
  const checked = await testAdsConnections({
    ...(metaResolution.context ? { meta: metaResolution.context } : {}),
    ...(googleResolution.context ? { googleAds: googleResolution.context } : {}),
  });
  return {
    meta: metaResolution.error ? resolutionHealth(metaResolution.error, "meta_ads") : checked.meta,
    googleAds: googleResolution.error ? resolutionHealth(googleResolution.error, "google_ads") : checked.googleAds,
  };
}

export async function getTenantAdPerformance(tenantId: string, windowDays = 7): Promise<AdPerformanceReport> {
  return getAdPerformance(windowDays, await adsContexts(tenantId));
}

export async function tenantResendStatus(tenantId: string): Promise<ProviderHealth> {
  try {
    await resolveTenantResendContext(tenantId);
    return { configured: true, healthy: null };
  } catch (error) {
    return resolutionHealth(error, "resend");
  }
}
