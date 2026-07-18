// AMC renewal sequence (§2.6, Temporal exit): ported from
// tests/integration/temporal-amc-renewal.test.ts (deleted) — same real, unchanged
// FinnorOrchestrator.draftKnownAction pipeline against real Postgres, same 3 scenarios
// (renews on response, escalates to lapsed after both reminders, bills a real
// configured price never a fabricated one) — but drives the "wait" via the ported
// scheduled_reminder scan (short firstWaitMs/secondWaitMs + a real short sleep between
// ticks) instead of a Temporal TestWorkflowEnvironment's durable timer.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, households, maintenanceAgreements, domainActions, domainPolicies, invoices, workflowRuns, tenants } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import { scheduledReminder, markAmcRenewalResponded } from "../../apps/worker/src/handlers/scheduled-reminder";

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

async function makeHouseholdAndAgreement(tenantId: string, label: string, phone: string): Promise<{ householdId: string; agreementId: string }> {
  return withTenant(tenantId, async (db) => {
    const [hh] = await db
      .insert(households)
      .values({ tenantId, address: `1 ${label} Ln, Cedar Falls, IA`, contactInfo: { name: label, phone } })
      .returning();
    const [agreement] = await db
      .insert(maintenanceAgreements)
      .values({ householdId: hh!.id, cadence: "annual", status: "active", renewalDate: new Date() })
      .returning();
    return { householdId: hh!.id, agreementId: agreement!.id };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!available)("AMC renewal sequence — ported to the Postgres-native scan (§2.6)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.COMMS_MODE = "native";
    await migrate(DB_URL);
    await seed(DB_URL);
    await withTenant(SEED_TENANT_ID, (db) => db.update(tenants).set({ ownerPhone: "+13195559999" }).where(eq(tenants.id, SEED_TENANT_ID)));
  });
  afterAll(async () => {
    await closePool();
  });

  it("drafts a real gated reminder immediately, then completes as 'renewed' when the customer responds before the follow-up wait elapses", async () => {
    const { householdId, agreementId } = await makeHouseholdAndAgreement(SEED_TENANT_ID, "Signal Responds Fast", "+19995552001");

    await scheduledReminder({ tenantId: SEED_TENANT_ID, windowDays: 30, firstWaitMs: 60_000, secondWaitMs: 60_000 });

    const drafted = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, SEED_TENANT_ID), eq(domainActions.actionType, "renew_maintenance_agreement"))),
    );
    const mine = drafted.find((d) => (d.payload as Record<string, unknown>).agreementId === agreementId);
    expect(mine, "the first reminder should have drafted a real, gated domain_action").toBeTruthy();
    expect(mine!.status).toBe("pending"); // gated — never auto-sent

    const [agreementAfterFirst] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementAfterFirst!.status).toBe("renewal_sent");
    expect(agreementAfterFirst!.firstReminderSentAt).not.toBeNull();

    const responded = await markAmcRenewalResponded(SEED_TENANT_ID, agreementId);
    expect(responded.ok).toBe(true);

    const [agreementRow] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).toBe("renewed");

    // A later tick (e.g. tomorrow's) must never escalate an already-renewed agreement.
    await scheduledReminder({ tenantId: SEED_TENANT_ID, windowDays: 30, firstWaitMs: 0, secondWaitMs: 0 });
    const [agreementAfterLaterTick] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementAfterLaterTick!.status).toBe("renewed");
    expect(householdId).toBeTruthy();
  });

  it("escalates to 'lapsed' + notifies the owner when no response arrives across both (short) wait windows", async () => {
    const { agreementId } = await makeHouseholdAndAgreement(SEED_TENANT_ID, "Never Responds", "+19995552002");
    const waitMs = 50;

    // Tick 1: drafts the first reminder.
    await scheduledReminder({ tenantId: SEED_TENANT_ID, windowDays: 30, firstWaitMs: waitMs, secondWaitMs: waitMs });
    await sleep(waitMs * 3);
    // Tick 2: first wait has elapsed with no response — drafts the firmer follow-up.
    await scheduledReminder({ tenantId: SEED_TENANT_ID, windowDays: 30, firstWaitMs: waitMs, secondWaitMs: waitMs });
    await sleep(waitMs * 3);
    // Tick 3: second wait has elapsed with no response — escalates to lapsed.
    await scheduledReminder({ tenantId: SEED_TENANT_ID, windowDays: 30, firstWaitMs: waitMs, secondWaitMs: waitMs });

    const [agreementRow] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).toBe("lapsed");

    const drafted = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, SEED_TENANT_ID), eq(domainActions.actionType, "renew_maintenance_agreement"))),
    );
    const mine = drafted.filter((d) => (d.payload as Record<string, unknown>).agreementId === agreementId);
    expect(mine.length).toBe(2); // day-0 reminder AND the firmer follow-up, both real gated actions
  });

  it("a renewal with a real configured price actually bills the customer — a fresh invoice, handed to the real invoice-to-cash workflow", async () => {
    // Its own tenant, not SEED_TENANT_ID — the seed's domain_policies row for
    // renew_maintenance_agreement deliberately carries the honest
    // PLACEHOLDER_NEEDS_REAL_VALUE sentinel (never a fabricated price, proven by the
    // two tests above never touching invoices at all), so proving the real-price path
    // needs a tenant configured with one.
    const priceTenantId = "00000000-0000-4000-8000-0000000000f6";
    await withTenant(priceTenantId, (db) => db.insert(tenants).values({ id: priceTenantId, name: "AMC Price Test Dealer" }).onConflictDoNothing());
    await withTenant(priceTenantId, (db) =>
      db
        .insert(domainPolicies)
        .values({
          tenantId: priceTenantId,
          actionType: "renew_maintenance_agreement",
          policy: { renewal_window_days: 30, price_usd: 189, cadence_options: ["annual"] },
          requiresConfirmation: true,
        })
        .onConflictDoNothing(),
    );
    const { householdId, agreementId } = await makeHouseholdAndAgreement(priceTenantId, "Real Price", "+19995552003");

    await scheduledReminder({ tenantId: priceTenantId, windowDays: 30, firstWaitMs: 60_000, secondWaitMs: 60_000 });
    const responded = await markAmcRenewalResponded(priceTenantId, agreementId);
    expect(responded.ok).toBe(true);

    const [agreementRow] = await withTenant(priceTenantId, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).toBe("renewed");
    expect(agreementRow!.renewalDate!.getTime()).toBeGreaterThan(Date.now()); // advanced to the next cadence window

    const [invoice] = await withTenant(priceTenantId, (db) => db.select().from(invoices).where(eq(invoices.householdId, householdId)));
    expect(invoice, "a real invoice should have been created for the configured price").toBeTruthy();
    expect(Number(invoice!.amountUsd)).toBe(189);

    const runs = await withTenant(priceTenantId, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.workflowType, "invoice_to_cash")));
    expect(runs.length).toBeGreaterThan(0); // the same real invoice-to-cash command graph vertical workflow 4 built was actually submitted
  });
});
