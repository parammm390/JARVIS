// scan_integration_health job (A3.T2): the cheapest authenticated no-op per REAL
// binding a tenant currently has an explicit tenant_integrations row for — writes
// health/last_check_at/last_error back onto that same row. Deliberately does NOT
// create rows for capabilities with no tenant_integrations row yet (pure env/default
// resolution) — inserting one here would silently turn an env-driven binding into a
// "tenant"-sourced override the next time anyone reads resolveCapabilityBindingsForTenant,
// which must only ever change when a human/admin flow explicitly sets one (A3.T1's own
// header). native/emulator/dry_run bindings have no external vendor to probe — reported
// "ok" unconditionally, same posture as ghlIntegrationStatus()'s "never unhealthy
// when merely unconfigured" convention.
//
// A provider with a durable circuit breaker (provider-circuit-breaker.ts) reports
// "down" the instant the breaker is open, regardless of what a fresh probe would say —
// the breaker is the thing actually gating real calls right now, so health must agree
// with it rather than contradict it with an independent, possibly-stale reading.

import { reconciliationCases, withTenant, tenantIntegrations } from "@finnor/db";
import { eq, and, sql } from "drizzle-orm";
import {
  testTenantVapiConnection,
  testTenantGhlConnection,
  testTenantDocusignConnection,
  testTenantQuickBooksConnection,
  testTenantStripeConnection,
  testTenantAdsConnections,
  tenantResendStatus,
  circuitSnapshot,
} from "@finnor/tools";
import type { JobHandler } from "../queue";

const CIRCUIT_BREAKER_PROVIDERS = new Set(["vapi", "stripe", "quickbooks", "ghl", "docusign", "resend"]);

type Health = "ok" | "degraded" | "down" | "unknown";

async function probeBinding(tenantId: string, binding: string): Promise<{ health: Health; error: string | null }> {
  if (CIRCUIT_BREAKER_PROVIDERS.has(binding) && (await circuitSnapshot(binding, tenantId)).state === "open") {
    return { health: "down", error: "circuit breaker open — repeated real-call failures" };
  }
  switch (binding) {
    case "vapi": {
      const r = await testTenantVapiConnection(tenantId);
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "ghl": {
      const r = await testTenantGhlConnection(tenantId);
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "docusign": {
      const r = await testTenantDocusignConnection(tenantId);
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "quickbooks": {
      const r = await testTenantQuickBooksConnection(tenantId);
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "stripe": {
      const r = await testTenantStripeConnection(tenantId);
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "meta":
    case "meta_ads": {
      const r = (await testTenantAdsConnections(tenantId)).meta;
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "google_ads": {
      const r = (await testTenantAdsConnections(tenantId)).googleAds;
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "ads": {
      const results = Object.values(await testTenantAdsConnections(tenantId));
      const configured = results.filter((result) => result.configured);
      if (configured.some((result) => result.healthy === true)) return { health: "ok", error: null };
      const failed = configured.find((result) => result.healthy === false);
      return failed ? { health: "degraded", error: failed.error ?? "Tenant ads connection failed" } : { health: "unknown", error: null };
    }
    case "resend": {
      const r = await tenantResendStatus(tenantId);
      return { health: r.configured ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    // native/emulator/dry_run: no external vendor behind these — nothing to probe, and
    // an outage here would mean Postgres itself is down, which every other query in
    // this same job would already be failing on.
    case "native":
    case "emulator":
    case "dry_run":
      return { health: "ok", error: null };
    default:
      return { health: "degraded", error: `Unsupported real integration binding: ${binding}` };
  }
}

export const scanIntegrationHealth: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_integration_health requires tenantId");

  const rows = await withTenant(tenantId, (db) => db.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId)));
  if (rows.length === 0) return; // no tenant_integrations rows yet — nothing to check, pure env/default resolution stands

  for (const row of rows) {
    const probe = await probeBinding(tenantId, row.binding);
    const [conflicts] = await withTenant(tenantId, (db) => db.select({
      count: sql<number>`count(*)::int`,
    }).from(reconciliationCases).where(and(
      eq(reconciliationCases.tenantId, tenantId),
      eq(reconciliationCases.integrationId, row.id),
      eq(reconciliationCases.status, "open"),
    )));
    const unresolvedConflicts = conflicts?.count ?? 0;
    const policy = row.freshnessPolicy && typeof row.freshnessPolicy === "object" && !Array.isArray(row.freshnessPolicy)
      ? row.freshnessPolicy as Record<string, unknown> : {};
    const maxAgeSeconds = typeof policy.maxAgeSeconds === "number" && policy.maxAgeSeconds > 0 ? policy.maxAgeSeconds : null;
    const ageSeconds = row.lastSuccessfulSyncAt ? (Date.now() - row.lastSuccessfulSyncAt.getTime()) / 1000 : null;
    const freshnessState = ageSeconds === null || maxAgeSeconds === null ? row.freshnessState
      : ageSeconds <= maxAgeSeconds ? "fresh"
        : ageSeconds <= maxAgeSeconds * 3 ? "stale" : "expired";
    const liveTruthRequired = row.outcomePacks.length > 0;
    const emulatorBlocked = liveTruthRequired && (row.mode === "emulator" || row.binding === "emulator");
    const health = probe.health === "ok" && (freshnessState === "stale" || freshnessState === "expired" || unresolvedConflicts > 0)
      ? "degraded" : emulatorBlocked ? "degraded" : probe.health;
    const error = emulatorBlocked ? "BLOCKED-CONFIG: required outcome pack is bound to an internal emulator"
      : probe.error ?? (row.syncStatus === "blocked" || row.reconciliationStatus === "blocked" ? row.lastError : null);
    await withTenant(tenantId, (db) =>
      db
        .update(tenantIntegrations)
        .set({
          health,
          freshnessState,
          unresolvedConflicts,
          ...(emulatorBlocked ? { syncStatus: "blocked" as const, reconciliationStatus: "blocked" as const } : {}),
          lastCheckAt: new Date(),
          lastError: error,
          updatedAt: new Date(),
        })
        .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.capability, row.capability))),
    );
  }
};
