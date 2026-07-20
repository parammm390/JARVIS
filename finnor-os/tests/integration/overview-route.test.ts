// Phase 7 MAESTRO PACK §7.6 — the daily briefing panel's data source. Real
// get_business_overview run through draftKnownAction (the same deterministic,
// non-LLM primitive every proactive scan uses), receipted, with real citations.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, domainActions, households, domainPolicies } from "@finnor/db";
import { eq } from "drizzle-orm";
import { GET as overviewGET } from "../../apps/api/app/api/overview/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
// Fresh per test run, not a fixed id: domain_actions this test creates can never be
// cleaned up afterward (see afterAll's comment — action_log's append-only trigger has
// no escape hatch), so a fixed tenant id would leak a "cached" hit into the very next
// run's "runs a fresh action" assertion once one real row exists in the cache window.
const TENANT_ID = randomUUID();

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

function req(url = "http://localhost/api/overview"): Request {
  return new Request(url, { headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" } });
}

describe.skipIf(!available)("GET /api/overview (Phase 7.6)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Overview Route Test" }).onConflictDoNothing());
    await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "1 Test Way", contactInfo: { name: "Overview Test Household" } }).onConflictDoNothing(),
    );
    // Matches real production configuration (docs/policy-matrix.md: get_business_overview
    // is ungated, low risk) — the fail-closed defaultPolicy() otherwise requires
    // confirmation for any tenant with no seeded policy row, which is correct for an
    // unconfigured tenant but not what this route needs to prove against a real one.
    await withTenant(TENANT_ID, (db) =>
      db.insert(domainPolicies).values({ tenantId: TENANT_ID, actionType: "get_business_overview", requiresConfirmation: false }).onConflictDoNothing(),
    );
  });

  afterAll(async () => {
    // domain_actions/decision_receipts/domain_policies are deliberately NOT deleted
    // here: this run creates real action_log rows via draftKnownAction's
    // appendEpisode, and migration 0000's unconditional action_log_immutable trigger
    // (no GUC escape hatch, unlike 0015's action_log_append_only) rejects any DELETE
    // that actually touches a real row — a pre-existing gap, not something to work
    // around in this test. domain_policies has a real FK from domain_actions, so it
    // can't be deleted either while those rows remain. Harmless: TENANT_ID is unique
    // to this file, local embedded-dev-only data.
    await withTenant(TENANT_ID, (db) => db.delete(households).where(eq(households.tenantId, TENANT_ID)));
    await closePool();
  });

  it("runs a real get_business_overview action and returns real leads/pending/inventory/invoices/visits + citations", async () => {
    const res = await overviewGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.domainActionId).toBeTruthy();
    expect(body.leads.total).toBeGreaterThanOrEqual(1);
    expect(body.spokenSummary).toBeTruthy();
    expect(Array.isArray(body.citations)).toBe(true);

    const [action] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, body.domainActionId)));
    expect(action!.status).toBe("completed");
  });

  it("reuses the cached result on a second call within the cache window, without creating a new domain_action", async () => {
    const first = await (await overviewGET(req())).json();
    const countBefore = (await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.tenantId, TENANT_ID)))).length;

    const second = await overviewGET(req());
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(secondBody.domainActionId).toBe(first.domainActionId);

    const countAfter = (await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.tenantId, TENANT_ID)))).length;
    expect(countAfter).toBe(countBefore);
  });

  it("?refresh=1 forces a brand-new run even within the cache window", async () => {
    const first = await (await overviewGET(req())).json();
    const forced = await overviewGET(req("http://localhost/api/overview?refresh=1"));
    const forcedBody = await forced.json();
    expect(forcedBody.cached).toBe(false);
    expect(forcedBody.domainActionId).not.toBe(first.domainActionId);
  });
});
