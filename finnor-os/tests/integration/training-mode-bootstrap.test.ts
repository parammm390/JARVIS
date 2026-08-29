import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, domainPolicies, inventoryItems, priceBookItems, tenantSettings, tenants, withTenant } from "@finnor/db";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";
import { eq } from "drizzle-orm";
import { bootstrapTrainingTenant } from "../../packages/orchestration/src/training-mode";
const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } }
const available = await dbUp(); let created: string;
describe.skipIf(!available)("training-mode bootstrap (B4.T5)", () => {
 beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); await withTenant(DEALER_ZERO_TENANT_ID, async (db) => { await db.insert(tenants).values({ id: DEALER_ZERO_TENANT_ID, name: "Dealer Zero Source" }).onConflictDoNothing(); await db.insert(tenantSettings).values({ tenantId: DEALER_ZERO_TENANT_ID, isDealerZero: true }).onConflictDoNothing(); await db.insert(domainPolicies).values({ tenantId: DEALER_ZERO_TENANT_ID, actionType: "create_invoice", policy: {}, requiresConfirmation: true }).onConflictDoNothing(); await db.insert(inventoryItems).values({ tenantId: DEALER_ZERO_TENANT_ID, sku: "TRAIN-SALT", name: "Training Salt", quantity: 4, reorderThreshold: 2 }).onConflictDoNothing(); await db.insert(priceBookItems).values({ tenantId: DEALER_ZERO_TENANT_ID, sku: "TRAIN-SALT", label: "Training Salt", priceUsd: "10" }).onConflictDoNothing(); }); });
 // The bootstrap records immutable business audit events. The ephemeral integration
 // database owns this generated training world for the rest of the run; deleting its
 // tenant would either orphan or illegally erase that evidence.
 afterAll(async () => { await closePool(); });
 it("copies only configuration into an explicit, non-simulating training tenant", async () => { const result = await bootstrapTrainingTenant("Training Tenant"); created = result.tenantId; expect(result.policies).toBeGreaterThan(0); const [settings] = await withTenant(created, (db) => db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, created))); expect(settings).toMatchObject({ trainingMode: true, isDealerZero: false, simulatorEnabled: false }); expect((await withTenant(created, (db) => db.select().from(domainPolicies).where(eq(domainPolicies.tenantId, created)))).length).toBeGreaterThan(0); });
});
