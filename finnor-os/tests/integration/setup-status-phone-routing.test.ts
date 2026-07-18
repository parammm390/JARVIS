// GET /api/setup/status gains a phoneRouting field (Phase 14): whether this tenant has
// a registered tenant_phone_numbers row, so an un-configured line shows up in the same
// "what's still left to configure" report as everything else on this endpoint.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool } from "@finnor/db";
import { GET } from "../../apps/api/app/api/setup/status/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000e6"; // dedicated, isolated from other fixtures

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

function req(): Request {
  return new Request("http://localhost/api/setup/status", { headers: { "x-tenant-id": TENANT_ID, "x-user-role": "owner" } });
}

describe.skipIf(!available)("GET /api/setup/status — phoneRouting (Phase 14)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Setup Status Phone Routing Test Tenant') ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
    ]);
    // Reset any row left by a prior run of this suite against the same persistent DB —
    // test 1 asserts "unconfigured," which only holds on a clean slate.
    await getPool().query(`DELETE FROM tenant_phone_numbers WHERE tenant_id = $1 OR tenant_id = $2`, [
      TENANT_ID,
      "00000000-0000-4000-8000-0000000000e7",
    ]);
  });

  afterAll(async () => {
    await closePool();
  });

  it("reports unconfigured when the tenant has no registered phone line", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phoneRouting: { configured: boolean; numbers: unknown[] } };
    expect(body.phoneRouting.configured).toBe(false);
    expect(body.phoneRouting.numbers).toEqual([]);
  });

  it("reports configured once a phone line is registered, without leaking another tenant's line", async () => {
    const OTHER_TENANT = "00000000-0000-4000-8000-0000000000e7";
    const myNumber = `+1555${randomUUID().replace(/-/g, "").slice(0, 7)}`;
    const otherNumber = `+1555${randomUUID().replace(/-/g, "").slice(0, 7)}`;
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Other Tenant') ON CONFLICT (id) DO NOTHING`, [OTHER_TENANT]);
    await getPool().query(`INSERT INTO tenant_phone_numbers (tenant_id, phone_number, vapi_phone_number_id) VALUES ($1, $2, $3)`, [
      OTHER_TENANT,
      otherNumber,
      `other-${randomUUID()}`,
    ]);
    await getPool().query(
      `INSERT INTO tenant_phone_numbers (tenant_id, phone_number, vapi_phone_number_id, label) VALUES ($1, $2, $3, $4)`,
      [TENANT_ID, myNumber, `mine-${randomUUID()}`, "Main line"],
    );
    const res = await GET(req());
    const body = (await res.json()) as { phoneRouting: { configured: boolean; numbers: Array<{ phoneNumber: string }> } };
    expect(body.phoneRouting.configured).toBe(true);
    expect(body.phoneRouting.numbers).toHaveLength(1);
    expect(body.phoneRouting.numbers[0]!.phoneNumber).toBe(myNumber);
  });

  it("reports the environment block (Phase 16c): nodeEnv, secret provider, and every binding switch", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      environment: { nodeEnv: string; secretProvider: { provider: string; loaded: boolean }; bindings: Record<string, string> };
    };
    expect(body.environment.nodeEnv).toBeTruthy();
    expect(body.environment.secretProvider.provider).toBe("env"); // no SECRETS_PROVIDER set in this test run
    // Every binding defaults to "emulator" until a dealer opts a real provider in —
    // same safe-until-configured posture as the *_BINDING switches themselves.
    for (const key of ["scheduling", "communications", "documents", "esign", "inventory", "accounting", "payments", "crm", "marketing"]) {
      expect(body.environment.bindings[key]).toBe("emulator");
    }
  });
});
