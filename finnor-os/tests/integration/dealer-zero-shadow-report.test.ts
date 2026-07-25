import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, dealerZeroShadowReports, tenants, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { writeShadowReport, type ReceiptLike } from "../../packages/orchestration/src/dealer-zero-replay";
const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-000000000b43";
async function dbUp() { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } }
const available = await dbUp();
const source: ReceiptLike[] = [{ proposedAction: { actionType: "create_invoice" }, expectedResult: null, actualResult: { invoice: "created" }, failure: null, approval: { required: true } }];
describe.skipIf(!available)("Dealer Zero shadow reports (B4.T4)", () => {
 beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); await withTenant(TENANT, (db) => db.insert(tenants).values({ id: TENANT, name: "B4 Shadow Test" }).onConflictDoNothing()); });
 afterAll(async () => { await withTenant(TENANT, async (db) => { await db.delete(dealerZeroShadowReports).where(eq(dealerZeroShadowReports.tenantId, TENANT)); await db.delete(tenants).where(eq(tenants.id, TENANT)); }); await closePool(); });
 it("persists a passing report for equivalent read-only receipt contracts", async () => { const diff = await writeShadowReport(TENANT, "production-mirror", "staging-candidate", new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T01:00:00Z"), source, source); expect(diff.equal).toBe(true); const rows = await withTenant(TENANT, (db) => db.select().from(dealerZeroShadowReports).where(eq(dealerZeroShadowReports.tenantId, TENANT))); expect(rows).toHaveLength(1); expect(rows[0]!.passed).toBe(true); });
 it("persists a failed report when the candidate changes a receipt", async () => { const candidate: ReceiptLike[] = [{ proposedAction: { actionType: "create_invoice" }, expectedResult: null, actualResult: { invoice: "failed" }, failure: null, approval: { required: true } }]; const diff = await writeShadowReport(TENANT, "production-mirror", "staging-candidate", new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T01:00:00Z"), source, candidate); expect(diff.equal).toBe(false); });
});
