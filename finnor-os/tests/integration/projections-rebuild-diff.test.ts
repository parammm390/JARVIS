// B1 EXIT GATE: "projector rebuild rows === query-time rows (diff test green)". Seeds
// real data, computes each of the 3 projected views live via @finnor/read-models
// directly, computes the same views via rebuildProjection (the projector's own
// recompute-and-cache path), and asserts they're identical (asOf/ts timestamps
// excluded — those are wall-clock-of-computation, not view content, and will always
// differ by a few ms between two separate calls).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, adminDb, tenants, leads, domainActions, actionLog } from "@finnor/db";
import { pipelineHealth, reliability, activitySnapshot } from "@finnor/read-models";
import { rebuildProjection, getProjection } from "@finnor/projections";

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

describe.skipIf(!available)("B1.T3 — projection rebuild matches live query-time computation", () => {
  let tenantId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    const [tenant] = await adminDb().insert(tenants).values({ name: "B1.T3 rebuild-diff test tenant" }).returning();
    tenantId = tenant!.id;

    await adminDb().insert(leads).values({ tenantId, name: "Test Lead", status: "new" });
    const [action] = await adminDb().insert(domainActions).values({ tenantId, actionType: "test_action", payload: {}, status: "draft" }).returning();
    await adminDb().insert(actionLog).values({ domainActionId: action!.id, tenantId, step: "drafted", input: {}, output: {} });
  });

  afterAll(async () => {
    await closePool();
  });

  it("pipeline-health: rebuilt cache row equals live computation", async () => {
    const live = await pipelineHealth(tenantId);
    const rebuilt = await rebuildProjection(tenantId, "pipeline-health");
    expect(rebuilt).toEqual(live);
    const cached = await getProjection(tenantId, "pipeline-health");
    expect(cached).toEqual(live);
  });

  it("reliability: rebuilt cache row equals live computation (asOf excluded)", async () => {
    const live = await reliability(tenantId);
    const rebuilt = await rebuildProjection(tenantId, "reliability");
    expect({ ...rebuilt, asOf: null }).toEqual({ ...live, asOf: null });
  });

  it("activity-snapshot: rebuilt cache row equals live computation (asOf excluded)", async () => {
    const live = await activitySnapshot(tenantId);
    const rebuilt = await rebuildProjection(tenantId, "activity-snapshot");
    expect({ ...rebuilt, asOf: null }).toEqual({ ...live, asOf: null });
  });
});
