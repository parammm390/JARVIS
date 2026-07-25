import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closePool, domainPolicies, tenantIntegrations, tenantSettings, withTenant } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { bootstrapTenant } from "../../scripts/tenant-bootstrap";
import { eq } from "drizzle-orm";
const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } }
const available = await dbUp(); let tenantId = "";
describe.skipIf(!available)("B6 tenant bootstrap", () => {
 beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); }); afterAll(async () => { await closePool(); });
 it("boots policy and integration completeness while honestly retaining the human-only review link", async () => { const result = await bootstrapTenant({ name: "B6 Fresh Tenant", timezone: "America/Chicago" }); tenantId = result.tenantId; expect(result).toMatchObject({ integrations: 9, humanOnlyField: "create_review_request.review_link_url" }); const [settings] = await withTenant(tenantId, (db) => db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId))); const policies = await withTenant(tenantId, (db) => db.select().from(domainPolicies).where(eq(domainPolicies.tenantId, tenantId))); const integrations = await withTenant(tenantId, (db) => db.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId))); expect(settings).toMatchObject({ trainingMode: false, simulatorEnabled: false }); expect(policies).toHaveLength(result.policies.actionTypesSeeded); expect(integrations).toHaveLength(9); });
});
