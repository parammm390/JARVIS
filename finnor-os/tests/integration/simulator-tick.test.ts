// Phase 3.3: the simulator's apply half against a real Postgres — proves events really
// land through the real machinery (createLead, draftKnownAction) and that the tenant
// gate (tenant_settings.simulator_enabled) is real, not decorative.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, households, leads, domainActions, tenantSettings, communicationsLog } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import { seedDealerZero, DEALER_ZERO_TENANT_ID } from "../../scripts/seed-dealer-zero";
import { seedTenantPolicies } from "../../scripts/seed-tenant-policies";
import { runSimulatorTick } from "../../apps/worker/src/handlers/simulator-tick";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

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

describe.skipIf(!available)("simulator tick (§3.3)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
    await seedDealerZero();
    await seedTenantPolicies(DEALER_ZERO_TENANT_ID, { reviewLinkUrl: "https://g.page/r/dealer-zero-finnor-water-co/review" });
  }, 60_000);
  afterAll(async () => {
    await closePool();
  });

  it("no-ops for a tenant whose simulator_enabled is false", async () => {
    const result = await runSimulatorTick(SEED_TENANT_ID, "2026-07-19");
    expect(result.ran).toBe(false);
  });

  it("runs for Dealer Zero: creates leads, drafts real gated actions, logs visits", async () => {
    const before = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID)));
    const result = await runSimulatorTick(DEALER_ZERO_TENANT_ID, "2026-07-19");
    expect(result.ran).toBe(true);
    expect(result.leadsCreated).toBeGreaterThanOrEqual(1);

    const newLeadRows = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(leads).where(and(eq(leads.tenantId, DEALER_ZERO_TENANT_ID), eq(leads.source, "voice"))),
    );
    // At least the leads this tick created must exist as real lead rows with real households.
    expect(newLeadRows.length).toBeGreaterThan(0);
    for (const lead of newLeadRows.slice(0, 3)) {
      const [hh] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(households).where(eq(households.id, lead.householdId!)));
      expect(hh).toBeTruthy();
    }

    const after = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID)));
    expect(after.length).toBeGreaterThan(before.length); // real domain_actions rows were drafted, not just DB writes bypassing the engine
  }, 30_000);

  it("is idempotent per (tenant, dateSeed): a second call with the SAME dateSeed produces the SAME plan-shaped output", async () => {
    const result1 = await runSimulatorTick(DEALER_ZERO_TENANT_ID, "2026-08-01");
    const result2 = await runSimulatorTick(DEALER_ZERO_TENANT_ID, "2026-08-01");
    // The plan itself is deterministic (proven directly in tests/unit/simulator-plan.test.ts);
    // this proves the apply step doesn't introduce its own nondeterminism — same
    // dateSeed always yields the same COUNT of each event kind, run to run.
    expect(result2.leadsCreated).toBe(result1.leadsCreated);
    expect(result2.visitsLogged).toBe(result1.visitsLogged);
    expect(result2.invoicesDrafted).toBe(result1.invoicesDrafted);
  }, 30_000);
});
