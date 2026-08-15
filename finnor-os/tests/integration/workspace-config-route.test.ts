import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  approvalChainSteps,
  approvalChains,
  authorityStates,
  closePool,
  employeeRoleAssignments,
  employeeRoles,
  roleAuthorityGrants,
  tenantSettings,
  tenants,
  users,
  withTenant,
} from "@finnor/db";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { DEFAULT_WORKSPACE_CONFIG, GET, PUT } from "../../apps/api/app/api/workspace-config/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-000000007601";
const OTHER_TENANT = "00000000-0000-4000-8000-000000007602";
const OWNER = "00000000-0000-4000-8000-000000007603";
const DISPATCHER = "00000000-0000-4000-8000-000000007604";

async function dbUp() { const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 }); try { await client.connect(); await client.end(); return true; } catch { return false; } }
const available = await dbUp();
function request(role: "owner" | "dispatcher" = "owner", init?: RequestInit) {
  return new Request("http://localhost/api/workspace-config", { ...init, headers: { "x-tenant-id": TENANT, "x-user-id": role === "owner" ? OWNER : DISPATCHER, "x-user-role": role, ...(init?.headers ?? {}) } });
}

describe.skipIf(!available)("tenant workspace configuration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; process.env.AUTH_DEV_BYPASS = "1"; await migrate(DB_URL);
    await withTenant(TENANT, async (db) => {
      await db.insert(tenants).values([{ id: TENANT, name: "Workspace Tenant" }, { id: OTHER_TENANT, name: "Other Workspace Tenant" }]).onConflictDoNothing();
      await db.insert(users).values([{ id: OWNER, tenantId: TENANT, email: "workspace-owner@example.test", role: "owner" }, { id: DISPATCHER, tenantId: TENANT, email: "workspace-dispatcher@example.test", role: "dispatcher" }]).onConflictDoNothing();
    });
    await withTenant(OTHER_TENANT, async (db) => { await db.insert(tenantSettings).values({ tenantId: OTHER_TENANT, workspaceConfig: { ...DEFAULT_WORKSPACE_CONFIG, terminology: { ...DEFAULT_WORKSPACE_CONFIG.terminology, work: "Other Work" } } }).onConflictDoNothing(); });
  });
  afterAll(async () => {
    const removeTenantOwnedAuthority = async (tenantId: string) => withTenant(tenantId, async (db) => {
      await db.delete(employeeRoleAssignments).where(eq(employeeRoleAssignments.tenantId, tenantId));
      await db.delete(roleAuthorityGrants).where(eq(roleAuthorityGrants.tenantId, tenantId));
      await db.delete(approvalChainSteps).where(eq(approvalChainSteps.tenantId, tenantId));
      await db.delete(employeeRoles).where(eq(employeeRoles.tenantId, tenantId));
      await db.delete(approvalChains).where(eq(approvalChains.tenantId, tenantId));
      await db.delete(authorityStates).where(eq(authorityStates.tenantId, tenantId));
    });
    await withTenant(TENANT, async (db) => { await db.delete(tenantSettings).where(eq(tenantSettings.tenantId, TENANT)); await db.delete(users).where(eq(users.tenantId, TENANT)); });
    await withTenant(OTHER_TENANT, async (db) => { await db.delete(tenantSettings).where(eq(tenantSettings.tenantId, OTHER_TENANT)); });
    await removeTenantOwnedAuthority(TENANT);
    await removeTenantOwnedAuthority(OTHER_TENANT);
    await withTenant(TENANT, async (db) => { await db.delete(tenants).where(eq(tenants.id, TENANT)); });
    await withTenant(OTHER_TENANT, async (db) => { await db.delete(tenants).where(eq(tenants.id, OTHER_TENANT)); });
    await closePool();
  });

  it("returns defaults and lets only the owner save tenant-wide controls", async () => {
    expect((await (await GET(request())).json()).config).toEqual(DEFAULT_WORKSPACE_CONFIG);
    const configured = { ...DEFAULT_WORKSPACE_CONFIG, enabledSurfaces: ["home", "work", "money"], terminology: { ...DEFAULT_WORKSPACE_CONFIG.terminology, work: "Cases" }, voiceEnabled: false };
    expect((await PUT(request("dispatcher", { method: "PUT", body: JSON.stringify(configured) }))).status).toBe(403);
    expect((await PUT(request("owner", { method: "PUT", body: JSON.stringify(configured) }))).status).toBe(200);
    expect((await (await GET(request("dispatcher"))).json()).config).toMatchObject({ enabledSurfaces: ["home", "work", "money"], terminology: { work: "Cases" }, voiceEnabled: false });
  });

  it("rejects unsafe or incomplete navigation contracts", async () => {
    expect((await PUT(request("owner", { method: "PUT", body: JSON.stringify({ ...DEFAULT_WORKSPACE_CONFIG, enabledSurfaces: ["work"] }) }))).status).toBe(400);
    expect((await PUT(request("owner", { method: "PUT", body: JSON.stringify({ ...DEFAULT_WORKSPACE_CONFIG, navigationPriority: ["home", "work", "work", "schedule", "money", "agents"] }) }))).status).toBe(400);
  });
});
