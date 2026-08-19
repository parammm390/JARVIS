// Blueprint's required Phase 1 proof (docs/jarvis-90-execution-blueprint.md §1):
// "import synthetic dealer data, replay the import twice with no duplicates, and
// produce quality findings for malformed or ambiguous data."

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, leads, households, businessEvents, dataQualityFindings, importEntityRefs, importRows, importRuns } from "@finnor/db";
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
      await db.delete(importRows).where(eq(importRows.tenantId, TENANT_ID));
      await db.delete(importEntityRefs).where(eq(importEntityRefs.tenantId, TENANT_ID));
      await db.delete(importRuns).where(eq(importRuns.tenantId, TENANT_ID));
      await db.delete(leads).where(eq(leads.tenantId, TENANT_ID));
      await db.delete(households).where(eq(households.tenantId, TENANT_ID));
    });
  });
  afterAll(async () => {
    await closePool();
  });

  it("importing twice creates no duplicate rows (idempotent by provenance)", async () => {
    const first = await importSyntheticDealerData(TENANT_ID);
    expect(first.created).toBe(3);
    expect(first.skipped).toBe(1); // the exact shared phone resolves deterministically
    expect(first.quarantined).toBe(1); // no phone/email: never written to business data

    const second = await importSyntheticDealerData(TENANT_ID);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(4);
    expect(second.quarantined).toBe(1);
    // Same lead ids both times — a re-import upserts, never duplicates.
    expect(second.leadIdsByExternalId).toEqual(first.leadIdsByExternalId);

    const leadRows = await withTenant(TENANT_ID, (db) =>
      db.select().from(leads).where(and(eq(leads.tenantId, TENANT_ID), eq(leads.sourceSystem, "synthetic_dealer_import"))),
    );
    expect(leadRows).toHaveLength(3);

    const householdRows = await withTenant(TENANT_ID, (db) => db.select().from(households).where(eq(households.tenantId, TENANT_ID)));
    expect(householdRows).toHaveLength(3);
  });

  it("quarantines malformed input and still surfaces genuinely stale canonical data", async () => {
    const { leadIdsByExternalId, runId } = await importSyntheticDealerData(TENANT_ID);

    const [quarantine] = await withTenant(TENANT_ID, (db) => db.select().from(importRows).where(and(eq(importRows.runId, runId), eq(importRows.status, "quarantined"))));
    expect(quarantine!.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "contact_method_required" })]));

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
