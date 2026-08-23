import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { adminDb, closePool, domainActions, getPool, readOperationalDeltas, tenants } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = DB_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");
const available = await (async () => {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
})();

describe.skipIf(!available)("durable tenant operational deltas", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await adminDb().insert(tenants).values([{ id: tenantA, name: "Delta Tenant A" }, { id: tenantB, name: "Delta Tenant B" }]);
  });
  afterAll(async () => { await closePool(); });

  it("replays missed changes exactly, exposes no business payload, and fails closed cross-tenant", async () => {
    const baseline = await readOperationalDeltas(tenantA);
    const [action] = await adminDb().insert(domainActions).values({ tenantId: tenantA, actionType: "delta_test", payload: { secretLikeBusinessValue: "must-not-project" }, status: "draft" }).returning();
    const page = await readOperationalDeltas(tenantA, baseline.cursor);
    expect(page.status).toBe("ok");
    expect(page.deltas).toHaveLength(1);
    expect(page.deltas[0]).toMatchObject({ changeType: "domain_actions.insert", entityRefs: [{ entityType: "domain_action", entityId: action!.id }] });
    expect(JSON.stringify(page)).not.toContain("secretLikeBusinessValue");

    const replay = await readOperationalDeltas(tenantA, baseline.cursor);
    expect(replay.deltas.map((delta) => delta.cursor)).toEqual(page.deltas.map((delta) => delta.cursor));
    await expect(readOperationalDeltas(tenantB, page.cursor)).rejects.toMatchObject({ code: "scope_mismatch" });
  });

  it("returns resync_required when retention has removed a cursor gap", async () => {
    const baseline = await readOperationalDeltas(tenantA);
    await adminDb().insert(domainActions).values([
      { tenantId: tenantA, actionType: "gap_one", payload: {}, status: "draft" },
      { tenantId: tenantA, actionType: "gap_two", payload: {}, status: "draft" },
    ]);
    const firstPage = await readOperationalDeltas(tenantA, baseline.cursor);
    const firstSeq = firstPage.deltas[0]!.cursor.split(":").at(-1)!;
    await getPool().query("DELETE FROM finnor_os.operational_deltas WHERE tenant_id=$1 AND seq<=$2::bigint", [tenantA, firstSeq]);
    const gap = await readOperationalDeltas(tenantA, baseline.cursor);
    expect(gap.status).toBe("resync_required");
    expect(gap.deltas).toEqual([]);
  });

  it("keeps a 300-change burst bounded and replayable without duplicate cursors", async () => {
    const baseline = await readOperationalDeltas(tenantA);
    await adminDb().insert(domainActions).values(Array.from({ length: 300 }, (_, index) => ({
      tenantId: tenantA,
      actionType: `burst_${index}`,
      payload: {},
      status: "draft" as const,
    })));
    const first = await readOperationalDeltas(tenantA, baseline.cursor, 1_000);
    expect(first.deltas).toHaveLength(250);
    expect(first.hasMore).toBe(true);
    const second = await readOperationalDeltas(tenantA, first.cursor, 1_000);
    expect(second.deltas).toHaveLength(50);
    expect(second.hasMore).toBe(false);
    const cursors = [...first.deltas, ...second.deltas].map((delta) => delta.cursor);
    expect(new Set(cursors).size).toBe(300);
  });

  it("enforces RLS and withholds direct ledger mutation from the runtime role", async () => {
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path=finnor_os,public");
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
      const own = await client.query("SELECT seq FROM operational_deltas WHERE tenant_id=$1", [tenantA]);
      const foreign = await client.query("SELECT seq FROM operational_deltas WHERE tenant_id=$1", [tenantB]);
      expect(own.rowCount).toBeGreaterThan(0);
      expect(foreign.rowCount).toBe(0);
      await expect(client.query("SELECT * FROM ensure_operational_delta_cursor($1)", [tenantB])).rejects.toThrow(/tenant mismatch/);
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SET LOCAL search_path=finnor_os,public");
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
      await expect(client.query("DELETE FROM operational_deltas WHERE tenant_id=$1", [tenantA])).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  });
});
