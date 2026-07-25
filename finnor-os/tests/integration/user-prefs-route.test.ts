import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closePool, tenants, users, userPrefs, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { DELETE, GET, PUT } from "../../apps/api/app/api/user-prefs/route";
import { GET as digestGET } from "../../apps/api/app/api/user-prefs/digest/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-000000000d61";
const OWNER = "00000000-0000-4000-8000-000000000d62";
const DISPATCHER = "00000000-0000-4000-8000-000000000d63";

async function dbUp() {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();
function request(userId = OWNER, init?: RequestInit) {
  return new Request("http://localhost/api/user-prefs", {
    ...init,
    headers: { "x-tenant-id": TENANT, "x-user-id": userId, "x-user-role": "owner", ...(init?.headers ?? {}) },
  });
}

describe.skipIf(!available)("user preferences route (D6.T1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT, async (db) => {
      await db.insert(tenants).values({ id: TENANT, name: "D6 Preferences Test" }).onConflictDoNothing();
      await db.insert(users).values([
        { id: OWNER, tenantId: TENANT, email: "d6-owner@example.test", role: "owner" },
        { id: DISPATCHER, tenantId: TENANT, email: "d6-dispatcher@example.test", role: "dispatcher" },
      ]).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await withTenant(TENANT, async (db) => {
      await db.delete(userPrefs).where(eq(userPrefs.userId, OWNER));
    }, OWNER);
    await withTenant(TENANT, async (db) => {
      await db.delete(userPrefs).where(eq(userPrefs.userId, DISPATCHER));
    }, DISPATCHER);
    await withTenant(TENANT, async (db) => {
      await db.delete(users).where(eq(users.tenantId, TENANT));
    });
    await closePool();
  });

  it("returns honest defaults before a user has saved anything", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).prefs).toEqual({
      homepage: null, density: "comfortable", pinnedPanels: [], accent: null,
      soundEnabled: false, notificationPreferences: {}, quietHoursStart: null, quietHoursEnd: null,
    });
  });

  it("requires an authenticated identity", async () => {
    expect((await GET(new Request("http://localhost/api/user-prefs"))).status).toBe(401);
  });

  it("upserts and retrieves only the caller's validated preferences", async () => {
    const saved = await PUT(request(OWNER, {
      method: "PUT",
      body: JSON.stringify({ homepage: "bridge", density: "compact", pinnedPanels: ["approvals", "activity"], accent: "teal", soundEnabled: true, notificationPreferences: { push: true }, quietHoursStart: "21:30", quietHoursEnd: "07:00" }),
    }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).prefs).toMatchObject({ homepage: "bridge", density: "compact", pinnedPanels: ["approvals", "activity"], accent: "teal", soundEnabled: true, notificationPreferences: { push: true }, quietHoursStart: "21:30", quietHoursEnd: "07:00" });
    expect((await (await GET(request(OWNER))).json()).prefs.homepage).toBe("bridge");
  });

  it("rejects incomplete or invalid quiet-hour changes", async () => {
    const incomplete = await PUT(request(OWNER, { method: "PUT", body: JSON.stringify({ quietHoursStart: "22:00" }) }));
    const invalid = await PUT(request(OWNER, { method: "PUT", body: JSON.stringify({ quietHoursStart: "25:00", quietHoursEnd: "07:00" }) }));
    expect(incomplete.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("does not expose or overwrite another user in the same tenant", async () => {
    expect((await (await GET(request(DISPATCHER))).json()).prefs.homepage).toBeNull();
    const saved = await PUT(request(DISPATCHER, { method: "PUT", body: JSON.stringify({ homepage: "map" }) }));
    expect(saved.status).toBe(200);
    expect((await (await GET(request(OWNER))).json()).prefs.homepage).toBe("bridge");
    expect((await (await GET(request(DISPATCHER))).json()).prefs.homepage).toBe("map");
  });

  it("deletes only the caller's row and restores defaults", async () => {
    expect((await DELETE(request(OWNER, { method: "DELETE" }))).status).toBe(200);
    expect((await (await GET(request(OWNER))).json()).prefs.homepage).toBeNull();
    expect((await (await GET(request(DISPATCHER))).json()).prefs.homepage).toBe("map");
  });

  it("records an honest first-visit marker rather than fabricating a delta", async () => {
    const first = await digestGET(request(OWNER));
    expect(first.status).toBe(200);
    expect((await first.json()).firstVisit).toBe(true);
    const next = await digestGET(request(OWNER));
    expect((await next.json()).firstVisit).toBe(false);
  });
});
