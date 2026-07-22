// Regression test for the critical finding first surfaced during A1 (2026-07-22):
// production was missing the entire finnor_langgraph schema because NOTHING in the
// real deploy pipeline ever provisioned it — graph/setup.ts's own header says "run
// once in CI right after db:migrate", but that was only ever wired into CI's
// ephemeral test Postgres (.github/workflows/ci.yml), never staging or prod.
// Reproduced for real this session: dropping the schema and constructing a
// FinnorOrchestrator exactly the way apps/api and apps/worker do (never calling
// .setup() anywhere in that real path) crashes with
// `relation "finnor_langgraph.checkpoints" does not exist` the instant a
// graph-routed action type (schedule_water_test, start_water_test_workflow,
// request_proposal_signature, start_installation_workflow,
// start_invoice_to_cash_workflow) is actually invoked.
//
// Fixed by making POST /api/admin/migrate — the established, secret-gated mechanism
// this repo already uses to provision staging/prod databases — also run
// PostgresSaver.setup() after migrate()/seed(). This test proves the fix two ways:
// (1) the route itself reports the schema ready and the tables really exist
// afterward, and (2) a real graph-routed action that would have crashed before no
// longer does, using the actual production code path (`new FinnorOrchestrator()`,
// not a test helper that self-provisions).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, domainActions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { POST as adminMigrateRoute } from "../../apps/api/app/api/admin/migrate/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000fd";
const ADMIN_SECRET = "test-admin-secret-langgraph-regression";

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

async function schemaExists(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { rows } = await c.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'finnor_langgraph'`);
  await c.end();
  return rows.length > 0;
}

async function dropSchema(): Promise<void> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS finnor_langgraph CASCADE`);
  await c.end();
}

describe.skipIf(!available)("A1 critical finding — finnor_langgraph schema provisioning", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "LangGraph Regression Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("reproduces the real crash when the schema is missing, using the actual production code path", async () => {
    await dropSchema();
    expect(await schemaExists()).toBe(false);

    const orchestrator = new FinnorOrchestrator(); // exactly how apps/api and apps/worker construct it — no .setup() anywhere in this path
    await expect(
      orchestrator.draftKnownAction("schedule_water_test", { address: "412 Maple Ridge Rd", contactPhone: "+13195550142" }, TENANT_ID, {
        source: "regression-test",
      }),
    ).rejects.toThrow(/finnor_langgraph\.checkpoints.*does not exist/);
  });

  it("POST /api/admin/migrate provisions the schema and reports it ready", async () => {
    await dropSchema();
    expect(await schemaExists()).toBe(false);

    const req = new Request("http://localhost/api/admin/migrate", {
      method: "POST",
      headers: { "x-admin-secret": ADMIN_SECRET },
    });
    const res = await adminMigrateRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.langGraphSchemaReady).toBe(true);

    expect(await schemaExists()).toBe(true);
    const c = new pg.Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'finnor_langgraph' ORDER BY table_name`);
    await c.end();
    expect(rows.map((r) => r.table_name)).toEqual(["checkpoint_blobs", "checkpoint_migrations", "checkpoint_writes", "checkpoints"]);
  });

  it("after admin/migrate runs, the same real action type that crashed before now succeeds", async () => {
    await dropSchema();
    await adminMigrateRoute(new Request("http://localhost/api/admin/migrate", { method: "POST", headers: { "x-admin-secret": ADMIN_SECRET } }));
    expect(await schemaExists()).toBe(true);

    const orchestrator = new FinnorOrchestrator();
    const { action } = await orchestrator.draftKnownAction(
      "schedule_water_test",
      { address: "412 Maple Ridge Rd", contactPhone: "+13195550142" },
      TENANT_ID,
      { source: "regression-test-post-fix" },
    );
    const row = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, action.id)));
    // The real point of this assertion: no crash. Whatever status it lands on
    // (pending/needs_human_review both mean "the graph engine ran cleanly and gated
    // it", which is all this regression test is proving) is a real, non-crashed status.
    expect(["pending", "needs_human_review"]).toContain(row[0]!.status);
  });

  it("admin/migrate rejects a bad secret before touching anything", async () => {
    const req = new Request("http://localhost/api/admin/migrate", { method: "POST", headers: { "x-admin-secret": "wrong" } });
    const res = await adminMigrateRoute(req);
    expect(res.status).toBe(403);
  });
});
