// B3.T7 acceptance: actual usage events drive a gated review action, never an order.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { businessEvents, closePool, domainActions, domainPolicies, getPool, inventoryItems, scanFindings, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { scanEwmaReorder } from "../../apps/worker/src/handlers/scan-ewma-reorder";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000b3";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

describe.skipIf(!available)("B3 EWMA reorder scan", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query("INSERT INTO tenants (id, name) VALUES ($1, 'B3 EWMA Test Tenant') ON CONFLICT (id) DO NOTHING", [TENANT_ID]);
    const [policy] = await withTenant(TENANT_ID, (db) => db.select().from(domainPolicies).where(and(eq(domainPolicies.tenantId, TENANT_ID), eq(domainPolicies.actionType, "flag_reorder_needed"))).limit(1));
    const values = { policy: { autoDraftReorderFlags: true }, requiresConfirmation: true };
    if (policy) await withTenant(TENANT_ID, (db) => db.update(domainPolicies).set(values).where(eq(domainPolicies.id, policy.id)));
    else await withTenant(TENANT_ID, (db) => db.insert(domainPolicies).values({ tenantId: TENANT_ID, actionType: "flag_reorder_needed", ...values }));
  });

  afterAll(async () => { await closePool(); });

  it("uses 14 days of stored stock-use events to create a pending gated suggestion with explicit reasoning", async () => {
    const runId = Date.now().toString(36);
    const [item] = await withTenant(TENANT_ID, (db) => db.insert(inventoryItems).values({ tenantId: TENANT_ID, sku: `EWMA-${runId}`, name: `EWMA Test Filter ${runId}`, quantity: 10, reorderThreshold: 2 }).returning());
    const today = new Date();
    await withTenant(TENANT_ID, (db) => db.insert(businessEvents).values(Array.from({ length: 14 }, (_, index) => ({
      tenantId: TENANT_ID, entityType: "inventory_item", entityId: item!.id, eventType: "stock_used_on_visit", payload: { quantity: 3 },
      occurredAt: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index)),
    }))));

    await scanEwmaReorder({ tenantId: TENANT_ID });

    // Actions are append-only, so locate this run by its receipt-safe payload rather
    // than relying on a test-suite-global action count.
    const actions = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.actionType, "flag_reorder_needed"))));
    const action = actions.find((row) => (row.payload as Record<string, unknown>).sku === item!.sku);
    expect(action?.status).toBe("pending");
    expect(action?.payload).toMatchObject({ sku: item!.sku, suggestedQuantity: 32 });
    expect(String((action?.payload as Record<string, unknown>).reasoning)).toContain("EWMA usage is 3/day");
    const findings = await withTenant(TENANT_ID, (db) => db.select().from(scanFindings).where(and(eq(scanFindings.tenantId, TENANT_ID), eq(scanFindings.scanType, "ewma_reorder"))));
    const ownFinding = findings.find((row) => (row.details as Record<string, unknown>).sku === item!.sku);
    expect(ownFinding?.draftedActionId).toBe(action?.id);
    expect(ownFinding?.details).toMatchObject({ dailyUsage: 3, reorderPoint: 42, suggestedQuantity: 32 });
  });
});
