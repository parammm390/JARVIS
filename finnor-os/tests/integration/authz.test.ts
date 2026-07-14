// Auth/rate-limit/replay/RBAC acceptance — the real work of Area 4. Checked
// tenant-isolation.test.ts first: it covers RLS, not auth/rate-limit/replay/RBAC, so
// this is genuinely new coverage, not a duplicate.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool, withTenant, rolePermissions } from "@finnor/db";
import { requireContext, canApprove, AuthError } from "../../apps/api/lib/auth";
import { checkRateLimit } from "../../apps/api/lib/rate-limit";
import { checkAndRecordReceipt } from "../../apps/api/lib/webhook-replay";
import { eq, and } from "drizzle-orm";

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

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe.skipIf(!available)("authz — dev-bypass hardening, rate limiting, webhook replay, RBAC", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach(() => {
    process.env.AUTH_DEV_BYPASS = "1";
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dev-bypass headers are accepted outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const ctx = await requireContext(req({ "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" }));
    expect(ctx.tenantId).toBe(SEED_TENANT_ID);
  });

  it("dev-bypass headers are REJECTED when NODE_ENV=production, even with AUTH_DEV_BYPASS=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(requireContext(req({ "x-tenant-id": SEED_TENANT_ID, "x-user-role": "owner" }))).rejects.toThrow(AuthError);
  });

  it("rate limit trips after the configured number of requests in a window, then blocks further ones", async () => {
    const bucket = `test:${Date.now()}:${Math.random()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(bucket, 3));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("a replayed webhook payload is rejected the second time it's posted", async () => {
    const eventId = `evt-${Date.now()}-${Math.random()}`;
    const first = await checkAndRecordReceipt("test-provider", eventId, JSON.stringify({ hello: "world" }));
    const second = await checkAndRecordReceipt("test-provider", eventId, JSON.stringify({ hello: "world" }));
    expect(first).toBe("new");
    expect(second).toBe("duplicate");
  });

  it("canApprove defaults to deny for a role with no configured permission on an action type", async () => {
    const allowed = await canApprove({ tenantId: SEED_TENANT_ID, userId: "x", role: "technician" }, "__unconfigured_action_type__");
    expect(allowed).toBe(false);
  });

  it("canApprove defaults to allow for the owner role even with no configured row", async () => {
    const allowed = await canApprove({ tenantId: SEED_TENANT_ID, userId: "x", role: "owner" }, "__unconfigured_action_type__");
    expect(allowed).toBe(true);
  });

  it("canApprove honors an explicit grant row over the default", async () => {
    const actionType = "__test_explicit_grant__";
    await withTenant(SEED_TENANT_ID, (db) =>
      db.insert(rolePermissions).values({ tenantId: SEED_TENANT_ID, role: "technician", actionType, canApprove: true }),
    );
    const allowed = await canApprove({ tenantId: SEED_TENANT_ID, userId: "x", role: "technician" }, actionType);
    expect(allowed).toBe(true);
    await withTenant(SEED_TENANT_ID, (db) =>
      db.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, SEED_TENANT_ID), eq(rolePermissions.actionType, actionType))),
    );
  });
});
