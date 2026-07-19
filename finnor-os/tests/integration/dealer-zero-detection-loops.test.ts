// Phase 3.4: detection loops must be genuinely live for Dealer Zero, not just
// registered. Proves scan_low_inventory and scan_service_due, run against Dealer Zero's
// real seeded data, actually draft real gated domain_actions (not just scan_findings
// rows) — each with a real receipt, landing in the real approval queue exactly like a
// dealer/customer-triggered action would.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed } from "../../packages/db/seed";
import { withTenant, closePool, domainActions, decisionReceipts, equipment, households } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import { seedDealerZero, DEALER_ZERO_TENANT_ID } from "../../scripts/seed-dealer-zero";
import { seedTenantPolicies } from "../../scripts/seed-tenant-policies";
import { scanLowInventory } from "../../apps/worker/src/handlers/scan-low-inventory";
import { scanServiceDue } from "../../apps/worker/src/handlers/scan-service-due";
import { FinnorOrchestrator } from "@finnor/orchestration";

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

describe.skipIf(!available)("Dealer Zero detection loops (§3.4)", () => {
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

  it("scan_low_inventory drafts real flag_reorder_needed actions (with receipts) for below-threshold seeded stock", async () => {
    const before = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID), eq(domainActions.actionType, "flag_reorder_needed"))),
    );

    await scanLowInventory({ tenantId: DEALER_ZERO_TENANT_ID });

    const after = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID), eq(domainActions.actionType, "flag_reorder_needed"))),
    );
    // seed-dealer-zero.ts seeds 3 below-threshold SKUs (FILT-SED, FILT-CARB, MEMB-RO).
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.length).toBeGreaterThanOrEqual(3);

    const newest = after[after.length - 1]!;
    const [receipt] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.domainActionId, newest.id)));
    expect(receipt).toBeTruthy();
    // flag_reorder_needed is auto-run (requiresConfirmation: false, policy-matrix.md §4)
    // — it executes immediately rather than sitting pending, but it's still a real,
    // receipted action, not a bare scan_findings-only row.
    expect(newest.status).toBe("completed");
  }, 30_000);

  it("scan_service_due drafts a real, gated send_follow_up (lands in the approval queue) for a household whose equipment is genuinely overdue", async () => {
    // Deterministic fixture, not relying on the bulk seed's random install dates —
    // guarantees a real due case regardless of what the random seed happened to produce.
    const { householdId } = await withTenant(DEALER_ZERO_TENANT_ID, async (db) => {
      const [hh] = await db
        .insert(households)
        .values({ tenantId: DEALER_ZERO_TENANT_ID, address: "1 Detection Loop Test Ln, Cedar Falls, IA", contactInfo: { name: "Detection Loop Test Household", phone: "+13195559999" } })
        .returning();
      await db.insert(equipment).values({
        householdId: hh!.id,
        type: "water_softener",
        model: "Standard Softener 32k",
        installDate: new Date(Date.now() - 500 * 24 * 3600 * 1000), // 500 days ago — well past the 12-month softener default
        source: "finnor",
      });
      return { householdId: hh!.id };
    });

    const before = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID), eq(domainActions.actionType, "send_follow_up"))),
    );

    await scanServiceDue({ tenantId: DEALER_ZERO_TENANT_ID });

    const after = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, DEALER_ZERO_TENANT_ID), eq(domainActions.actionType, "send_follow_up"))),
    );
    expect(after.length).toBeGreaterThan(before.length);

    const forThisHousehold = after.find((a) => (a.payload as Record<string, unknown>).householdId === householdId);
    expect(forThisHousehold, "scan_service_due must have drafted a send_follow_up for the deliberately-overdue household").toBeTruthy();
    // send_follow_up is hardcoded requiresConfirmation:true (policy-matrix.md §9) — a
    // real pending approval, not an auto-executed side effect. No receipt exists YET —
    // receipts open at execution (§2.4/§2.5), and a still-pending gated action hasn't
    // executed; a receipt appearing before approval would be the dishonest thing here.
    expect(forThisHousehold!.status).toBe("pending");
    const [receiptBeforeApproval] = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(decisionReceipts).where(eq(decisionReceipts.domainActionId, forThisHousehold!.id)),
    );
    expect(receiptBeforeApproval).toBeUndefined();

    // Complete the real loop: approve it (as an owner would from the cockpit) and prove
    // the receipt appears once it actually executes.
    const orchestrator = new FinnorOrchestrator();
    await orchestrator.decide(forThisHousehold!.id, DEALER_ZERO_TENANT_ID, "approve", "test:detection-loop-proof");
    const [receiptAfterApproval] = await withTenant(DEALER_ZERO_TENANT_ID, (db) =>
      db.select().from(decisionReceipts).where(eq(decisionReceipts.domainActionId, forThisHousehold!.id)),
    );
    expect(receiptAfterApproval).toBeTruthy();
    expect((receiptAfterApproval!.approval as Record<string, unknown>).required).toBe(true);
  }, 30_000);
});
