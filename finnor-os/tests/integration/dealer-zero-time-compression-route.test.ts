import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, tenantSettings, tenants, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { POST } from "../../apps/api/app/api/dealer-zero/time-compression/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const DEMO_TENANT = "00000000-0000-4000-8000-000000000b40";
const OTHER_TENANT = "00000000-0000-4000-8000-000000000b41";
async function dbUp() { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } }
const available = await dbUp();
function request(tenantId: string, role = "owner", body: object = {}) { return new Request("http://localhost/api/dealer-zero/time-compression", { method: "POST", headers: { "content-type": "application/json", "x-tenant-id": tenantId, "x-user-id": "00000000-0000-4000-8000-000000000b42", "x-user-role": role }, body: JSON.stringify(body) }); }

describe.skipIf(!available)("Dealer Zero time-compression API (B4.T2)", () => {
  beforeAll(async () => { process.env.DATABASE_URL = DB_URL; process.env.AUTH_DEV_BYPASS = "1"; await migrate(DB_URL); await withTenant(DEMO_TENANT, async (db) => { await db.insert(tenants).values([{ id: DEMO_TENANT, name: "B4 Demo" }, { id: OTHER_TENANT, name: "B4 Other" }]).onConflictDoNothing(); await db.insert(tenantSettings).values({ tenantId: DEMO_TENANT, isDealerZero: true, simulatorEnabled: true }).onConflictDoUpdate({ target: tenantSettings.tenantId, set: { isDealerZero: true } }); }); });
  afterAll(async () => { await withTenant(DEMO_TENANT, async (db) => { await db.delete(tenantSettings).where(eq(tenantSettings.tenantId, DEMO_TENANT)); await db.delete(tenants).where(eq(tenants.id, DEMO_TENANT)); }); await closePool(); });
  it("returns a deterministic explicitly-labeled 60x demo script for Dealer Zero", async () => { const one = await POST(request(DEMO_TENANT, "owner", { dateSeed: "2026-08-01", scenario: "chaos_day", multiplier: 60 })); const two = await POST(request(DEMO_TENANT, "owner", { dateSeed: "2026-08-01", scenario: "chaos_day", multiplier: 60 })); expect(one.status).toBe(200); const a = await one.json(); expect(await two.json()).toEqual(a); expect(a).toMatchObject({ demo: true, synthetic: true, scenario: "chaos_day", multiplier: 60 }); expect(a.frames[0].label).toContain("DEMO"); });
  it("refuses non-Dealer-Zero tenants and non-owner roles", async () => { expect((await POST(request(OTHER_TENANT))).status).toBe(403); expect((await POST(request(DEMO_TENANT, "dispatcher"))).status).toBe(403); });
});
