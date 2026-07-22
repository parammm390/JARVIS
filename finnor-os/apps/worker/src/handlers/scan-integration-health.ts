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

import { withTenant, tenantIntegrations } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import {
  testVapiConnection,
  ghlIntegrationStatus,
  testDocusignConnection,
  testQuickBooksConnection,
  testStripeConnection,
  circuitSnapshot,
} from "@finnor/tools";
import type { JobHandler } from "../queue";

const CIRCUIT_BREAKER_PROVIDERS = new Set(["vapi", "stripe", "quickbooks", "ghl", "docusign", "resend"]);

type Health = "ok" | "degraded" | "down" | "unknown";

async function probeBinding(binding: string): Promise<{ health: Health; error: string | null }> {
  if (CIRCUIT_BREAKER_PROVIDERS.has(binding) && (await circuitSnapshot(binding)).state === "open") {
    return { health: "down", error: "circuit breaker open — repeated real-call failures" };
  }
  switch (binding) {
    case "vapi": {
      const r = await testVapiConnection();
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "ghl": {
      const r = ghlIntegrationStatus();
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "docusign": {
      const r = await testDocusignConnection();
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "quickbooks": {
      const r = await testQuickBooksConnection();
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    case "stripe": {
      const r = await testStripeConnection();
      return { health: r.healthy === true ? "ok" : r.healthy === false ? "degraded" : "unknown", error: r.error ?? null };
    }
    // native/emulator/dry_run: no external vendor behind these — nothing to probe, and
    // an outage here would mean Postgres itself is down, which every other query in
    // this same job would already be failing on.
    default:
      return { health: "ok", error: null };
  }
}

export const scanIntegrationHealth: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_integration_health requires tenantId");

  const rows = await withTenant(tenantId, (db) => db.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId)));
  if (rows.length === 0) return; // no tenant_integrations rows yet — nothing to check, pure env/default resolution stands

  for (const row of rows) {
    const { health, error } = await probeBinding(row.binding);
    await withTenant(tenantId, (db) =>
      db
        .update(tenantIntegrations)
        .set({ health, lastCheckAt: new Date(), lastError: error, updatedAt: new Date() })
        .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.capability, row.capability))),
    );
  }
};
