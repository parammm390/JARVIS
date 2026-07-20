// Phase 7 MAESTRO PACK §7.1 — the Approval Inbox's third verb. A human can flag a
// still-pending action as needing review without approving or rejecting it. Mirrors
// rbac-approval.test.ts's real-route-through-decide() pattern for confirm/reject.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { getPool, closePool, withTenant, domainActions, rolePermissions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { POST as escalatePOST } from "../../apps/api/app/api/actions/[id]/escalate/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000ea";

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

function req(role: string, body?: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "x-tenant-id": TENANT_ID, "x-user-role": role, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seedPendingAction(actionType: string, payload: Record<string, unknown> = {}): Promise<string> {
  const [row] = await withTenant(TENANT_ID, (db) =>
    db.insert(domainActions).values({ tenantId: TENANT_ID, actionType, payload, status: "pending", summary: `test: ${actionType}` }).returning(),
  );
  return row!.id;
}

async function actionStatus(id: string): Promise<string> {
  const [row] = await withTenant(TENANT_ID, (db) => db.select({ status: domainActions.status }).from(domainActions).where(eq(domainActions.id, id)));
  return row!.status;
}

describe.skipIf(!available)("POST /api/actions/:id/escalate (Phase 7.1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Escalate Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
    await withTenant(TENANT_ID, (db) =>
      db.insert(rolePermissions).values([
        { tenantId: TENANT_ID, role: "owner", actionType: "*", canApprove: true },
        { tenantId: TENANT_ID, role: "dispatcher", actionType: "schedule_water_test", canApprove: true },
        { tenantId: TENANT_ID, role: "technician", actionType: "*", canApprove: false },
      ]),
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("owner escalates a pending action -> needs_human_review, 200", async () => {
    const id = await seedPendingAction("create_invoice");
    const res = await escalatePOST(req("owner", { note: "double check the amount" }), { params: { id } });
    expect(res.status).toBe(200);
    expect(await actionStatus(id)).toBe("needs_human_review");
  });

  it("escalating an already-needs_human_review action is idempotent, 200", async () => {
    const id = await seedPendingAction("create_invoice");
    const first = await escalatePOST(req("owner"), { params: { id } });
    expect(first.status).toBe(200);
    const second = await escalatePOST(req("owner"), { params: { id } });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.idempotent).toBe(true);
    expect(await actionStatus(id)).toBe("needs_human_review");
  });

  it("dispatcher without permission on this action type -> 403, action stays pending", async () => {
    const id = await seedPendingAction("create_invoice");
    const res = await escalatePOST(req("dispatcher"), { params: { id } });
    expect(res.status).toBe(403);
    expect(await actionStatus(id)).toBe("pending");
  });

  it("a terminal (completed) action cannot be escalated -> 409", async () => {
    const id = await seedPendingAction("create_invoice");
    await withTenant(TENANT_ID, (db) => db.update(domainActions).set({ status: "completed" }).where(eq(domainActions.id, id)));
    expect(await actionStatus(id)).toBe("completed");
    const res = await escalatePOST(req("owner"), { params: { id } });
    expect(res.status).toBe(409);
    expect(await actionStatus(id)).toBe("completed");
  });

  it("unknown action id -> 404", async () => {
    const res = await escalatePOST(req("owner"), { params: { id: "00000000-0000-4000-8000-00000000ffff" } });
    expect(res.status).toBe(404);
  });
});
