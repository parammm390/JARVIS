import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, households, serviceVisits, technicians, tenants, users, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { GET, POST } from "../../apps/api/app/api/technician/my-day/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-0000000000d5";
const USER = "00000000-0000-4000-8000-000000000d51";
async function dbUp() { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true } catch { return false } }
const available = await dbUp();
function request(path = "", init?: RequestInit) { return new Request(`http://localhost/api/technician/my-day${path}`, { ...init, headers: { "x-tenant-id": TENANT, "x-user-id": USER, "x-user-role": "technician", ...(init?.headers ?? {}) } }) }

describe.skipIf(!available)("technician my-day route (D5)", () => {
  let ownVisit: string; let otherVisit: string;
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; process.env.AUTH_DEV_BYPASS = "1"; await migrate(DB_URL);
    await withTenant(TENANT, async (db) => {
      await db.insert(tenants).values({ id: TENANT, name: "D5 Route Test" }).onConflictDoNothing();
      const [a] = await db.insert(technicians).values({ tenantId: TENANT, name: "Linked Tech" }).returning();
      const [b] = await db.insert(technicians).values({ tenantId: TENANT, name: "Other Tech" }).returning();
      await db.insert(users).values({ id: USER, tenantId: TENANT, email: "d5-tech@example.test", role: "technician", technicianId: a!.id }).onConflictDoNothing();
      const [h] = await db.insert(households).values({ tenantId: TENANT, address: "100 Houston Test Way", latitude: 29.7604, longitude: -95.3698 }).returning();
      const today = new Date(); today.setUTCHours(14, 0, 0, 0);
      const [own] = await db.insert(serviceVisits).values({ householdId: h!.id, technicianId: a!.id, type: "maintenance", scheduledAt: today }).returning();
      const [other] = await db.insert(serviceVisits).values({ householdId: h!.id, technicianId: b!.id, type: "install", scheduledAt: today }).returning();
      ownVisit = own!.id; otherVisit = other!.id;
    });
  });
  afterAll(async () => { await withTenant(TENANT, async (db) => { await db.delete(serviceVisits).where(eq(serviceVisits.id, ownVisit)); await db.delete(serviceVisits).where(eq(serviceVisits.id, otherVisit)); await db.delete(users).where(eq(users.id, USER)); await db.delete(technicians).where(eq(technicians.tenantId, TENANT)); await db.delete(households).where(eq(households.tenantId, TENANT)); }); await closePool(); });
  it("returns only the linked technician's assigned visit with its stored location", async () => { const body = await (await GET(request())).json() as { visits: Array<{ id: string; latitude: number }> }; expect(body.visits.map((v) => v.id)).toEqual([ownVisit]); expect(body.visits[0]!.latitude).toBeCloseTo(29.7604); });
  it("requires explicit confirmation and atomically refuses someone else's visit", async () => { expect((await POST(request("", { method: "POST", body: JSON.stringify({ visitId: ownVisit }) }))).status).toBe(400); expect((await POST(request("", { method: "POST", body: JSON.stringify({ visitId: otherVisit, confirm: true }) }))).status).toBe(409); const ok = await POST(request("", { method: "POST", body: JSON.stringify({ visitId: ownVisit, confirm: true }) })); expect(ok.status).toBe(200); expect((await POST(request("", { method: "POST", body: JSON.stringify({ visitId: ownVisit, confirm: true }) }))).status).toBe(409); });
});
