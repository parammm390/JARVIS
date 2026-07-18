// Blueprint's required Phase 1 proof (docs/jarvis-90-execution-blueprint.md §1):
// "import synthetic dealer data, replay the import twice with no duplicates, and
// produce quality findings for malformed or ambiguous data."

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, leads, households, businessEvents, dataQualityFindings } from "@finnor/db";
import { eq, and, sql } from "drizzle-orm";
import { importSyntheticDealerData, SYNTHETIC_DEALER_LEADS } from "../../scripts/import-synthetic-dealer";
import { scanDataQuality } from "../../apps/worker/src/handlers/scan-data-quality";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
// Dedicated tenant, isolated from SEED_TENANT_ID's fixture data.
const TENANT_ID = "00000000-0000-4000-8000-0000000000cd";

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

describe.skipIf(!available)("canonical data import — blueprint Phase 1 proof", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) =>
      db.insert(tenants).values({ id: TENANT_ID, name: "Synthetic Import Test Dealer" }).onConflictDoNothing(),
    );
    // Clean slate: earlier runs' leads/households/findings for this tenant, if any.
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(dataQualityFindings).where(eq(dataQualityFindings.tenantId, TENANT_ID));
      await db.delete(leads).where(eq(leads.tenantId, TENANT_ID));
      await db.delete(households).where(eq(households.tenantId, TENANT_ID));
    });
  });
  afterAll(async () => {
    await closePool();
  });

  it("importing twice creates no duplicate rows (idempotent by provenance)", async () => {
    const first = await importSyntheticDealerData(TENANT_ID);
    expect(first.created).toBe(SYNTHETIC_DEALER_LEADS.length);
    expect(first.skipped).toBe(0);

    const second = await importSyntheticDealerData(TENANT_ID);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(SYNTHETIC_DEALER_LEADS.length);
    // Same lead ids both times — a re-import upserts, never duplicates.
    expect(second.leadIdsByExternalId).toEqual(first.leadIdsByExternalId);

    const leadRows = await withTenant(TENANT_ID, (db) =>
      db.select().from(leads).where(and(eq(leads.tenantId, TENANT_ID), eq(leads.sourceSystem, "synthetic_dealer_import"))),
    );
    expect(leadRows).toHaveLength(SYNTHETIC_DEALER_LEADS.length);

    const householdRows = await withTenant(TENANT_ID, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_ID)));
    // One household per lead (dual-write compromise) — re-import must not mint extras.
    expect(householdRows).toHaveLength(SYNTHETIC_DEALER_LEADS.length);
  });

  it("data-quality scan surfaces the deliberately duplicate, malformed, and stale fixture rows", async () => {
    const { leadIdsByExternalId } = await importSyntheticDealerData(TENANT_ID);

    // Backdate synth-005's activity so it reads as stale under the default 14-day window
    // (the scan can't fabricate real time passing, so the test simulates it directly).
    const staleLeadId = leadIdsByExternalId["synth-005"]!;
    await withTenant(TENANT_ID, async (db) => {
      // business_events is append-only in real use (migration 0015) — this test-only
      // time-simulation opts in via a transaction-local GUC no application code ever sets.
      await db.execute(sql`SELECT set_config('app.allow_audit_mutation', 'true', true)`);
      await db
        .update(businessEvents)
        .set({ occurredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
        .where(and(eq(businessEvents.tenantId, TENANT_ID), eq(businessEvents.entityType, "lead"), eq(businessEvents.entityId, staleLeadId)));
    });

    await scanDataQuality({ tenantId: TENANT_ID });

    const findings = await withTenant(TENANT_ID, (db) =>
      db.select().from(dataQualityFindings).where(eq(dataQualityFindings.tenantId, TENANT_ID)),
    );

    const duplicate = findings.find((f) => f.findingType === "duplicate_candidate");
    expect(duplicate, "expected a duplicate_candidate finding for the shared-phone household pair").toBeTruthy();

    const missing = findings.find(
      (f) => f.findingType === "missing_critical_field" && f.entityId === leadIdsByExternalId["synth-004"],
    );
    expect(missing, "expected a missing_critical_field finding for the no-phone/no-email lead").toBeTruthy();

    const stale = findings.find((f) => f.findingType === "stale_data" && f.entityId === staleLeadId);
    expect(stale, "expected a stale_data finding for the backdated lead").toBeTruthy();

    // Re-running the scan must not pile up duplicate finding rows for the same issue.
    await scanDataQuality({ tenantId: TENANT_ID });
    const findingsAfterRescan = await withTenant(TENANT_ID, (db) =>
      db.select().from(dataQualityFindings).where(eq(dataQualityFindings.tenantId, TENANT_ID)),
    );
    expect(findingsAfterRescan).toHaveLength(findings.length);
  });
});
