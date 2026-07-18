// RBAC (Phase 16d): canApprove() enforcement is real (apps/api/lib/auth.ts) but had no
// seeded baseline and no end-to-end test through the actual confirm/reject HTTP routes —
// only unit-style canApprove() calls (authz.test.ts). This file drives the real routes.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, domainActions, rolePermissions, voiceIdentities } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import { POST as confirmPOST } from "../../apps/api/app/api/actions/[id]/confirm/route";
import { resolveVoiceIdentity } from "@finnor/voice-os";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
// Dedicated tenant, isolated from every other fixture's role_permissions rows.
const TENANT_ID = "00000000-0000-4000-8000-0000000000e8";
// A second tenant with ZERO role_permissions rows — proves the no-rows-for-this-tenant
// default (owner-only) independent of any baseline seeded elsewhere.
const BARE_TENANT_ID = "00000000-0000-4000-8000-0000000000e9";

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

function req(role: string): Request {
  return new Request("http://localhost/api/test", { headers: { "x-tenant-id": TENANT_ID, "x-user-role": role } });
}

async function seedPendingAction(tenantId: string, actionType: string): Promise<string> {
  const [row] = await withTenant(tenantId, (db) =>
    db.insert(domainActions).values({ tenantId, actionType, payload: {}, status: "pending", summary: `test: ${actionType}` }).returning(),
  );
  return row!.id;
}

async function actionStatus(tenantId: string, id: string): Promise<string> {
  const [row] = await withTenant(tenantId, (db) => db.select({ status: domainActions.status }).from(domainActions).where(eq(domainActions.id, id)));
  return row!.status;
}

describe.skipIf(!available)("RBAC — confirm route enforcement (Phase 16d)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'RBAC Test Tenant'), ($2, 'RBAC Bare Tenant') ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      BARE_TENANT_ID,
    ]);
    // Mirror packages/db/seed.ts's Phase 16 baseline for this dedicated tenant, so this
    // test doesn't depend on (or pollute) the shared SEED_TENANT_ID's rows.
    await withTenant(TENANT_ID, (db) =>
      db.insert(rolePermissions).values([
        { tenantId: TENANT_ID, role: "owner", actionType: "*", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "schedule_water_test", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "reschedule_visit", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "assign_technician_to_visit", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "send_customer_message", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "send_follow_up", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "start_water_test_workflow", canApprove: true },
        { tenantId: TENANT_ID, role: "technician", actionType: "*", canApprove: false },
      ]),
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("dispatcher approves a scheduling action — 200", async () => {
    const id = await seedPendingAction(TENANT_ID, "schedule_water_test");
    const res = await confirmPOST(req("dispatcher"), { params: { id } });
    expect(res.status).toBe(200);
  });

  it("dispatcher is rejected (403) on create_invoice, and the action stays pending", async () => {
    const id = await seedPendingAction(TENANT_ID, "create_invoice");
    const res = await confirmPOST(req("dispatcher"), { params: { id } });
    expect(res.status).toBe(403);
    expect(await actionStatus(TENANT_ID, id)).toBe("pending");
  });

  it("technician is rejected (403) on both a scheduling action and create_invoice", async () => {
    const schedId = await seedPendingAction(TENANT_ID, "schedule_water_test");
    const invId = await seedPendingAction(TENANT_ID, "create_invoice");
    expect((await confirmPOST(req("technician"), { params: { id: schedId } })).status).toBe(403);
    expect((await confirmPOST(req("technician"), { params: { id: invId } })).status).toBe(403);
    expect(await actionStatus(TENANT_ID, schedId)).toBe("pending");
    expect(await actionStatus(TENANT_ID, invId)).toBe("pending");
  });

  it("owner's wildcard row is honored for an action type with no explicit grant", async () => {
    const id = await seedPendingAction(TENANT_ID, "__no_explicit_grant_probe__");
    const res = await confirmPOST(req("owner"), { params: { id } });
    expect(res.status).toBe(200);
  });

  it("no role_permissions rows at all for a tenant falls back to owner-only (regression)", async () => {
    const id = await seedPendingAction(BARE_TENANT_ID, "schedule_water_test");
    const bareReq = (role: string) => new Request("http://localhost/api/test", { headers: { "x-tenant-id": BARE_TENANT_ID, "x-user-role": role } });
    expect((await confirmPOST(bareReq("dispatcher"), { params: { id } })).status).toBe(403);
    expect((await confirmPOST(bareReq("owner"), { params: { id } })).status).toBe(200);
  });

  it("voice-path decide() only ever runs as the resolved owner identity — dispatcher-by-voice is not resolvable today", async () => {
    // A dispatcher's own caller-ID row (if one somehow already existed) still can't
    // grant voice-approval authority: apps/api/app/api/webhooks/vapi/route.ts:189-190
    // computes staffCtx as `identity?.role === "owner" ? {...} : null` — nothing but
    // an "owner" role identity ever produces a non-null staffCtx, and finnor_confirm
    // refuses to call decide() at all when staffCtx is null (route.ts:320-323). The
    // users table has no phone column (voice-os/src/index.ts's own comment), so a
    // dispatcher's identity can never auto-resolve to "owner" — dispatcher-by-voice
    // approval is out of scope until that gap is closed (future work, not this phase).
    const phone = `+1555${Date.now()}`;
    await withTenant(TENANT_ID, (db) =>
      db.insert(voiceIdentities).values({ tenantId: TENANT_ID, phoneNumber: phone, role: "dispatcher" }),
    );
    const identity = await resolveVoiceIdentity(TENANT_ID, phone);
    expect(identity.role).toBe("dispatcher");
    const staffCtx = identity.role === "owner" ? { userId: identity.matchedUserId ?? identity.id, role: "owner" as const } : null;
    expect(staffCtx).toBeNull();
    await withTenant(TENANT_ID, (db) => db.delete(voiceIdentities).where(and(eq(voiceIdentities.tenantId, TENANT_ID), eq(voiceIdentities.phoneNumber, phone))));
  });
});
