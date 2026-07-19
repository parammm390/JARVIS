// Reliability alert detection (Phase 6, JARVIS 95% MAESTRO PACK §6.6): proves each
// real threshold actually fires against real Postgres rows — reconciliation
// backlog>20, DLQ>10, a circuit forced open (the honest "flapping" proxy, see
// scan-reliability-alerts.ts's header comment) — and that a healthy tenant produces
// no alerts at all. Does NOT assert against Sentry itself (Sentry.init() is an inert
// no-op without SENTRY_DSN, which is unset in this environment) — asserts the pure
// detectReliabilityAlerts() function the handler calls before reporting.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, adminDb, reconciliationCases, deadLetters, providerCircuitState } from "@finnor/db";
import { detectReliabilityAlerts } from "../../apps/worker/src/handlers/scan-reliability-alerts";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000d7";
const HEALTHY_TENANT_ID = "00000000-0000-4000-8000-0000000000d8";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("scan-reliability-alerts (Phase 6)", () => {
  let originalVapiState: (typeof providerCircuitState.$inferSelect) | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Reliability Alerts Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Reliability Alerts Healthy Tenant') ON CONFLICT (id) DO NOTHING`, [HEALTHY_TENANT_ID]);

    await withTenant(TENANT_ID, async (db) => {
      // 21 open reconciliation cases -> over the >20 threshold.
      await db.insert(reconciliationCases).values(Array.from({ length: 21 }, () => ({ tenantId: TENANT_ID, caseType: "unknown_delivery" as const, status: "open" as const })));
      // 11 open dead letters -> over the >10 threshold.
      await db.insert(deadLetters).values(
        Array.from({ length: 11 }, () => ({ tenantId: TENANT_ID, envelope: {}, errorKind: "terminal" as const, lastError: "test", status: "open" as const })),
      );
    });

    // provider_circuit_state is a global table (no tenant_id) — capture real prior
    // state so this test can restore it and not corrupt the shared dev circuit for
    // any other test or manual run that checks vapi's breaker afterward.
    [originalVapiState] = await adminDb().select().from(providerCircuitState).where(eq(providerCircuitState.provider, "vapi"));
    await adminDb()
      .insert(providerCircuitState)
      .values({ provider: "vapi", state: "open", consecutiveFailures: 5, openedAt: new Date() })
      .onConflictDoUpdate({ target: providerCircuitState.provider, set: { state: "open", consecutiveFailures: 5, openedAt: new Date() } });
  });

  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID));
      await db.delete(deadLetters).where(eq(deadLetters.tenantId, TENANT_ID));
    });
    if (originalVapiState) {
      await adminDb()
        .update(providerCircuitState)
        .set({ state: originalVapiState.state, consecutiveFailures: originalVapiState.consecutiveFailures, openedAt: originalVapiState.openedAt })
        .where(eq(providerCircuitState.provider, "vapi"));
    } else {
      await adminDb().delete(providerCircuitState).where(eq(providerCircuitState.provider, "vapi"));
    }
    await closePool();
  });

  it("fires reconciliation_backlog, dlq_depth, and provider_flapping for a real unhealthy tenant", async () => {
    const alerts = await detectReliabilityAlerts(TENANT_ID);
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain("reconciliation_backlog");
    expect(kinds).toContain("dlq_depth");
    expect(kinds).toContain("provider_flapping");

    const backlogAlert = alerts.find((a) => a.kind === "reconciliation_backlog")!;
    expect(backlogAlert.detail.count).toBe(21);
    const dlqAlert = alerts.find((a) => a.kind === "dlq_depth")!;
    expect(dlqAlert.detail.count).toBe(11);
    const flapAlert = alerts.find((a) => a.kind === "provider_flapping" && a.detail.provider === "vapi")!;
    expect(flapAlert.detail.state).toBe("open");
  });

  it("produces zero alerts for a tenant with no backlog and healthy circuits", async () => {
    // Reset vapi to closed just for this assertion, then restore in afterAll.
    await adminDb().update(providerCircuitState).set({ state: "closed", consecutiveFailures: 0 }).where(eq(providerCircuitState.provider, "vapi"));
    const alerts = await detectReliabilityAlerts(HEALTHY_TENANT_ID);
    expect(alerts).toEqual([]);
    await adminDb().update(providerCircuitState).set({ state: "open", consecutiveFailures: 5 }).where(eq(providerCircuitState.provider, "vapi"));
  });
});
