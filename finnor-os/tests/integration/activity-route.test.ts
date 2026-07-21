// A2.T6 acceptance: GET /api/activity merges action_log + workflow_steps + calls into
// one tenant-scoped, cursor-paginated feed — real rows from all three sources, real
// tenant isolation, and a monotonic since-cursor that never re-serves the same item.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, domainActions } from "@finnor/db";
import { appendEpisode } from "@finnor/memory";
import { persistCall } from "@finnor/data-platform";
import { submitCommand } from "@finnor/workflow-runtime";
import { GET as activityRoute } from "../../apps/api/app/api/activity/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-0000000000ca";
const TENANT_B = "00000000-0000-4000-8000-0000000000cb";

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

function req(tenantId: string, qs = ""): Request {
  return new Request(`http://localhost/api/activity${qs}`, { headers: { "x-tenant-id": tenantId, "x-user-role": "owner" } });
}

async function seedTenantActivity(tenantId: string, tag: string) {
  const [action] = await withTenant(tenantId, (db) =>
    db.insert(domainActions).values({ tenantId, actionType: `activity_test_${tag}` }).returning({ id: domainActions.id }),
  );
  await appendEpisode(tenantId, action!.id, "activity_test_step", {}, { tag });

  await withTenant(tenantId, (db) =>
    submitCommand(db, {
      tenantId,
      commandType: `activity_test_workflow_${tag}`,
      payload: {},
      workflowType: `activity_test_workflow_${tag}`,
      steps: [{ stepType: "activity_test_step", payload: {} }],
    }),
  );

  await withTenant(tenantId, (db) =>
    persistCall(db, {
      tenantId,
      provenance: { sourceSystem: "test", externalId: `activity-test-${tag}-${Math.random()}` },
      direction: "inbound",
      transcript: "activity test call",
    }),
  );
}

describe.skipIf(!available)("GET /api/activity", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_A, (db) => db.insert(tenants).values({ id: TENANT_A, name: "Activity Test Dealer A" }).onConflictDoNothing());
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Activity Test Dealer B" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("401s without auth", async () => {
    const original = process.env.AUTH_DEV_BYPASS;
    delete process.env.AUTH_DEV_BYPASS;
    const res = await activityRoute(new Request("http://localhost/api/activity"));
    expect(res.status).toBe(401);
    process.env.AUTH_DEV_BYPASS = original;
  });

  it("merges all three sources for the requesting tenant and excludes the other tenant's rows", async () => {
    await seedTenantActivity(TENANT_A, "merge");
    await seedTenantActivity(TENANT_B, "other-tenant");

    const res = await activityRoute(req(TENANT_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    const sources = new Set(body.items.map((i: { source: string }) => i.source));
    expect(sources.has("action_log")).toBe(true);
    expect(sources.has("workflow_step")).toBe(true);
    expect(sources.has("call")).toBe(true);

    // None of tenant B's rows leak into tenant A's feed.
    const detailStrings = JSON.stringify(body.items);
    expect(detailStrings).not.toContain("other-tenant");
  });

  it("since cursor is monotonic — a second page never re-serves an item from the first", async () => {
    await seedTenantActivity(TENANT_A, "page1");
    const page1 = await (await activityRoute(req(TENANT_A, "?limit=3"))).json();
    expect(page1.items.length).toBeGreaterThan(0);
    expect(page1.nextCursor).toBeTruthy();

    await seedTenantActivity(TENANT_A, "page2");
    const page2 = await (await activityRoute(req(TENANT_A, `?since=${encodeURIComponent(page1.nextCursor)}&limit=50`))).json();

    const page1Ids = new Set(page1.items.map((i: { id: string }) => i.id));
    for (const item of page2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
  });

  it("400s on a malformed since cursor", async () => {
    const res = await activityRoute(req(TENANT_A, "?since=not-a-real-cursor"));
    expect(res.status).toBe(400);
  });
});
