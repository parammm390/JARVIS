// A4.T6 acceptance: claimOrGetCachedIntake()/completeIntakeClaim() (apps/api/lib/
// intake-idempotency.ts) — the mechanism POST /api/actions uses to make an opt-in
// idempotencyKey actually prevent a duplicate submission from double-creating
// DomainActions. Tested directly against the mechanism (not through the HTTP route,
// which would require a real or mocked LLM planner call to exercise end-to-end —
// out of scope here, same category of honest gap as this project's other "needs a
// real X" limitations).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants } from "@finnor/db";
import { claimOrGetCachedIntake, completeIntakeClaim } from "../../apps/api/lib/intake-idempotency";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f2";

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

describe.skipIf(!available)("intake idempotency (A4.T6)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Intake Idempotency Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("a fresh key claims successfully", async () => {
    const key = `test-${randomUUID()}`;
    const result = await claimOrGetCachedIntake(TENANT_ID, key);
    expect(result.status).toBe("claimed");
  });

  it("a second claim on the SAME key before completion reports in_progress — never a second claim, never silently dropped", async () => {
    const key = `test-${randomUUID()}`;
    const first = await claimOrGetCachedIntake(TENANT_ID, key);
    expect(first.status).toBe("claimed");
    const second = await claimOrGetCachedIntake(TENANT_ID, key);
    expect(second.status).toBe("in_progress");
  });

  it("after completion, a repeat submission with the SAME key returns the cached response — no double-execution", async () => {
    const key = `test-${randomUUID()}`;
    const claim = await claimOrGetCachedIntake(TENANT_ID, key);
    if (claim.status !== "claimed") throw new Error("expected a fresh claim");
    const realResponse = { planned: [{ actionType: "schedule_water_test", payload: {} }] };
    await completeIntakeClaim(TENANT_ID, claim.id, realResponse);

    const repeat = await claimOrGetCachedIntake(TENANT_ID, key);
    expect(repeat.status).toBe("cached");
    if (repeat.status === "cached") expect(repeat.response).toEqual(realResponse);

    // A third attempt with the same key is STILL cached, not a fresh claim — proves
    // this isn't a one-shot marker that resets.
    const third = await claimOrGetCachedIntake(TENANT_ID, key);
    expect(third.status).toBe("cached");
  });

  it("different idempotency keys for the same tenant claim independently", async () => {
    const a = await claimOrGetCachedIntake(TENANT_ID, `test-a-${randomUUID()}`);
    const b = await claimOrGetCachedIntake(TENANT_ID, `test-b-${randomUUID()}`);
    expect(a.status).toBe("claimed");
    expect(b.status).toBe("claimed");
  });

  it("the SAME idempotency key for a DIFFERENT tenant claims independently (no cross-tenant collision)", async () => {
    const otherTenantId = randomUUID();
    await withTenant(otherTenantId, (db) => db.insert(tenants).values({ id: otherTenantId, name: "Other Tenant" }).onConflictDoNothing());
    const key = `shared-key-${randomUUID()}`;
    const first = await claimOrGetCachedIntake(TENANT_ID, key);
    const second = await claimOrGetCachedIntake(otherTenantId, key);
    expect(first.status).toBe("claimed");
    expect(second.status).toBe("claimed"); // not "in_progress" — different tenant, same key string
  });
});
