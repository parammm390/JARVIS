// GET /api/events (Phase 10): real Postgres, real dev-bypass Request — proves the
// business_events timeline route's shape, entity filter, and before-cursor paging.
// Scoped entirely to a freshly created household's entityId so assertions never
// depend on (or mutate) other tests' shared seed-tenant fixtures.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool, withTenant, businessEvents, households } from "@finnor/db";
import { GET } from "../../apps/api/app/api/events/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

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

function req(qs = ""): Request {
  return new Request(`http://localhost/api/events${qs}`, {
    headers: { "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" },
  });
}

describe.skipIf(!available)("GET /api/events (Phase 10)", () => {
  let householdId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await seed(DB_URL);

    await withTenant(SEED_TENANT_ID, async (db) => {
      const [household] = await db
        .insert(households)
        .values({ tenantId: SEED_TENANT_ID, address: "1 Events Test Way" })
        .returning();
      householdId = household!.id;

      const base = Date.now();
      await db.insert(businessEvents).values([
        { tenantId: SEED_TENANT_ID, entityType: "household", entityId: householdId, eventType: "household_created", occurredAt: new Date(base - 3000), source: "test" },
        { tenantId: SEED_TENANT_ID, entityType: "household", entityId: householdId, eventType: "quote_sent", occurredAt: new Date(base - 2000), source: "test" },
        { tenantId: SEED_TENANT_ID, entityType: "household", entityId: householdId, eventType: "appointment_scheduled", occurredAt: new Date(base - 1000), source: "test" },
      ]);
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("returns events for the tenant newest-first", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string; occurredAt: string }> };
    const occurredTimes = body.events.map((e) => new Date(e.occurredAt).getTime());
    expect([...occurredTimes]).toEqual([...occurredTimes].sort((a, b) => b - a));
  });

  it("?entityType=&entityId= scopes to one entity, newest-first", async () => {
    const res = await GET(req(`?entityType=household&entityId=${householdId}`));
    const body = (await res.json()) as { events: Array<{ entityType: string; entityId: string; eventType: string }> };
    expect(body.events).toHaveLength(3);
    expect(body.events.every((e) => e.entityType === "household" && e.entityId === householdId)).toBe(true);
    expect(body.events.map((e) => e.eventType)).toEqual(["appointment_scheduled", "quote_sent", "household_created"]);
  });

  it("rejects entityType without entityId", async () => {
    const res = await GET(req(`?entityType=household`));
    expect(res.status).toBe(400);
  });

  it("?before= cursor pages backward within the scoped entity", async () => {
    const first = await GET(req(`?entityType=household&entityId=${householdId}`));
    const body = (await first.json()) as { events: Array<{ id: string; occurredAt: string }> };
    const oldest = body.events[body.events.length - 1]!;
    const paged = await GET(req(`?entityType=household&entityId=${householdId}&before=${encodeURIComponent(oldest.occurredAt)}`));
    const pagedBody = (await paged.json()) as { events: Array<{ id: string }> };
    expect(pagedBody.events).toHaveLength(0);
  });

  it("rejects requests without tenant context", async () => {
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
  });
});
