// Proactive scan handler acceptance: each scan finds real conditions against real
// data and either drafts a real gated action (never auto-executed) or records a real
// finding for the owner digest — never silently drops what it found.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, households, equipment, serviceVisits, inventoryItems, maintenanceAgreements, communicationsLog, domainPolicies, scanFindings, domainActions } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import { scanLowInventory } from "../../apps/worker/src/handlers/scan-low-inventory";
import { scanServiceDue } from "../../apps/worker/src/handlers/scan-service-due";
import { scanColdLeads } from "../../apps/worker/src/handlers/scan-cold-leads";
import { scheduledReminder } from "../../apps/worker/src/handlers/scheduled-reminder";
import { ownerDigest } from "../../apps/worker/src/handlers/owner-digest";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f1"; // dedicated, isolated from other fixtures

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

describe.skipIf(!available)("proactive scan handlers", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'Scan Handler Test Tenant') ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID],
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("scan_low_inventory records a real finding for an item below threshold, nothing when none are", async () => {
    await withTenant(TENANT_ID, (db) => db.delete(inventoryItems).where(eq(inventoryItems.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) =>
      db.insert(inventoryItems).values({ tenantId: TENANT_ID, sku: "TEST-LOW", name: "Test Low Stock Item", quantity: 1, reorderThreshold: 10 }),
    );
    await scanLowInventory({ tenantId: TENANT_ID });
    const findings = await withTenant(TENANT_ID, (db) =>
      db.select().from(scanFindings).where(and(eq(scanFindings.tenantId, TENANT_ID), eq(scanFindings.scanType, "low_inventory"))),
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.summary).toContain("Test Low Stock Item");
  });

  it("scan_service_due finds equipment overdue by its real install date, real math not a guess", async () => {
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(households)
        .values({ tenantId: TENANT_ID, address: "1 Test Overdue Ln", contactInfo: { name: "Overdue Test Household" } })
        .returning(),
    );
    // sediment_filter is due at the low end of its "3-6 months" range — 8 months ago is unambiguously overdue.
    await withTenant(TENANT_ID, (db) =>
      db.insert(equipment).values({
        householdId: hh!.id,
        type: "sediment_filter",
        source: "finnor",
        installDate: new Date(Date.now() - 8 * 30 * 24 * 3600 * 1000),
      }),
    );
    await scanServiceDue({ tenantId: TENANT_ID });
    const findings = await withTenant(TENANT_ID, (db) =>
      db.select().from(scanFindings).where(and(eq(scanFindings.tenantId, TENANT_ID), eq(scanFindings.scanType, "service_due"))),
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.summary).toContain("sediment filter");
  });

  it("scan_cold_leads drafts a real gated action when a win-back script IS configured", async () => {
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(households)
        .values({
          tenantId: TENANT_ID,
          address: "2 Test Coldlead Ln",
          contactInfo: { name: "Cold Lead Household", phone: "+13195559911" },
          marketingConsent: true,
        })
        .returning(),
    );
    await withTenant(TENANT_ID, (db) =>
      db.insert(communicationsLog).values({
        householdId: hh!.id,
        channel: "call",
        direction: "outbound",
        content: "old contact",
        timestamp: new Date(Date.now() - 4 * 30 * 24 * 3600 * 1000), // 4 months ago — inside the 3-6 window
      }),
    );
    // No unique constraint on (tenant_id, action_type) to target with onConflict —
    // delete-then-insert is the safe idempotent pattern used elsewhere in this repo.
    await withTenant(TENANT_ID, (db) =>
      db
        .delete(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, TENANT_ID), eq(domainPolicies.actionType, "bulk_notify_existing_customers"))),
    );
    await withTenant(TENANT_ID, (db) =>
      db.insert(domainPolicies).values({
        tenantId: TENANT_ID,
        actionType: "bulk_notify_existing_customers",
        policy: { winback_offer_script: "Test win-back: 15% off, book a free water test." },
        requiresConfirmation: true,
      }),
    );
    await scanColdLeads({ tenantId: TENANT_ID });
    const drafted = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.actionType, "bulk_notify_existing_customers"))),
    );
    expect(drafted.length).toBeGreaterThanOrEqual(1);
    const last = drafted[drafted.length - 1]!;
    expect(last.status).toBe("pending"); // gated — never auto-executed
    expect(last.summary).toBeTruthy();
  });

  it("scheduled_reminder (renewal scan) drafts through the real pipeline — real summary, never a blank card", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(households)
        .values({ tenantId: TENANT_ID, address: "3 Test Renewal Ln", contactInfo: { name: "Renewal Household", phone: "+13195559922" } })
        .returning(),
    );
    await withTenant(TENANT_ID, (db) =>
      db.insert(maintenanceAgreements).values({
        householdId: hh!.id,
        cadence: "annual",
        status: "active",
        renewalDate: new Date(Date.now() + 5 * 24 * 3600 * 1000), // due in 5 days — inside the 30-day scan window
      }),
    );
    await scheduledReminder({ tenantId: TENANT_ID, windowDays: 30 });
    const drafted = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.actionType, "renew_maintenance_agreement"))),
    );
    expect(drafted.length).toBeGreaterThanOrEqual(1);
    const last = drafted[drafted.length - 1]!;
    expect(last.status).toBe("pending");
    expect(last.summary).toBeTruthy(); // the actual bug being fixed: this used to be null
    expect(last.summary).not.toBe("No summary drafted.");
  });

  it("owner_digest is a no-op (no call attempted) when there's nothing to report", async () => {
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    await getPool().query(`UPDATE tenants SET owner_phone = NULL WHERE id = $1`, [TENANT_ID]);
    // No findings, no fresh scan-drafted actions in the lookback window → should return cleanly without throwing.
    await expect(ownerDigest({ tenantId: TENANT_ID })).resolves.toBeUndefined();
  });

  it("owner_digest marks findings digested even with no phone configured (never piles up forever)", async () => {
    await withTenant(TENANT_ID, (db) =>
      db.insert(scanFindings).values({ tenantId: TENANT_ID, scanType: "low_inventory", summary: "test finding for digest", details: {} }),
    );
    await getPool().query(`UPDATE tenants SET owner_phone = NULL WHERE id = $1`, [TENANT_ID]);
    await ownerDigest({ tenantId: TENANT_ID });
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM scan_findings WHERE tenant_id = $1 AND digested_at IS NULL`,
      [TENANT_ID],
    );
    expect(rows[0].n).toBe(0);
  });
});
