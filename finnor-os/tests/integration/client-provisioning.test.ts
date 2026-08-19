import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { closePool, getPool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { parseClientManifest, type ClientManifest } from "../../scripts/client-manifest";
import { provisionClient } from "../../scripts/client-provisioning";
import { bootstrapTenant } from "../../scripts/tenant-bootstrap";
import { CrossTenantUserError, type TenantAuthAdmin } from "../../scripts/tenant-user";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

function fakeAuth() {
  const users = new Map<string, { id: string; email: string }>();
  const listUsers = vi.fn(async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => {
    const all = [...users.values()];
    const start = (page - 1) * perPage;
    const pageUsers = all.slice(start, start + perPage);
    return {
      data: { users: pageUsers, aud: "authenticated", nextPage: start + perPage < all.length ? page + 1 : null, lastPage: Math.ceil(all.length / perPage), total: all.length },
      error: null,
    };
  });
  const createUser = vi.fn(async ({ email }: { email: string }) => {
    const key = email.toLowerCase();
    if (users.has(key)) return { data: { user: null }, error: { message: "User already registered" } };
    const user = { id: randomUUID(), email: key };
    users.set(key, user);
    return { data: { user }, error: null };
  });
  const updateUserById = vi.fn(async () => ({ data: { user: {} }, error: null }));
  return { users, listUsers, createUser, updateUserById, auth: { listUsers, createUser, updateUserById } as unknown as TenantAuthAdmin };
}

function manifest(key: string, email: string, overrides: Partial<ClientManifest> = {}): ClientManifest {
  return parseClientManifest({
    clientKey: key,
    tenant: { name: "Convergence Water", timezone: "America/Chicago" },
    locations: [{ key: "main-office", name: "Main Office", address: "1 Water Way" }],
    users: [{ email, role: "owner", displayName: "Owner One" }],
    requiredCapabilities: ["crm", "communications"],
    policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
    ...overrides,
  });
}

describe.skipIf(!available)("client identity and convergent provisioning", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  });
  afterAll(async () => closePool());

  it("converges ten identical runs to one tenant and one copy of every configuration row", async () => {
    const suffix = randomUUID().slice(0, 8);
    const desired = manifest(`repeat-${suffix}`, `repeat-${suffix}@example.test`);
    const auth = fakeAuth();
    let tenantId = "";
    for (let run = 0; run < 10; run++) {
      const result = await provisionClient(desired, { auth: auth.auth });
      tenantId ||= result.tenantId;
      expect(result.tenantId).toBe(tenantId);
      if (run > 0) expect(result.policies.updated).toBe(0);
    }
    const counts = await getPool().query<{
      tenants: string; users: string; settings: string; integrations: string;
      locations: string; policies: string; revisions: string;
    }>(
      `SELECT
        (SELECT count(*) FROM finnor_os.tenants WHERE client_key=$1)::text tenants,
        (SELECT count(*) FROM finnor_os.users WHERE tenant_id=$2)::text users,
        (SELECT count(*) FROM finnor_os.tenant_settings WHERE tenant_id=$2)::text settings,
        (SELECT count(*) FROM finnor_os.tenant_integrations WHERE tenant_id=$2)::text integrations,
        (SELECT count(*) FROM finnor_os.tenant_locations WHERE tenant_id=$2)::text locations,
        (SELECT count(*) FROM finnor_os.domain_policies WHERE tenant_id=$2)::text policies,
        (SELECT count(*) FROM finnor_os.domain_policy_revisions WHERE tenant_id=$2)::text revisions`,
      [desired.clientKey, tenantId],
    );
    expect(counts.rows[0]).toMatchObject({ tenants: "1", users: "1", settings: "1", integrations: "9", locations: "1" });
    expect(counts.rows[0]!.revisions).toBe(counts.rows[0]!.policies);
    expect(auth.createUser).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("recovers a partial database-only run without creating another tenant", async () => {
    const suffix = randomUUID().slice(0, 8);
    const desired = manifest(`partial-${suffix}`, `partial-${suffix}@example.test`);
    const first = await bootstrapTenant(desired);
    const completed = await provisionClient(desired, { auth: fakeAuth().auth });
    expect(completed.tenantId).toBe(first.tenantId);
    expect(completed.users).toHaveLength(1);
    expect(completed.policies.updated).toBe(0);
  }, 60_000);

  it("converges an existing same-tenant user without changing its identity", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `same-${suffix}@example.test`;
    const auth = fakeAuth();
    const first = await provisionClient(manifest(`same-${suffix}`, email, {
      users: [{ email, role: "dispatcher", displayName: "Before", phoneNumber: null, status: "active" }],
    }), { auth: auth.auth });
    const second = await provisionClient(manifest(`same-${suffix}`, email, {
      users: [{ email, role: "owner", displayName: "After", phoneNumber: "+15555550100", status: "active" }],
    }), { auth: auth.auth });
    expect(second.users[0]!.id).toBe(first.users[0]!.id);
    const row = await getPool().query("SELECT tenant_id, role, display_name, phone_number FROM finnor_os.users WHERE email=$1", [email]);
    expect(row.rows[0]).toMatchObject({ tenant_id: first.tenantId, role: "owner", display_name: "After", phone_number: "+15555550100" });
    expect(auth.createUser).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("hard-fails a cross-tenant email before tenant or auth mutation", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `boundary-${suffix}@example.test`;
    const auth = fakeAuth();
    const first = await provisionClient(manifest(`boundary-a-${suffix}`, email), { auth: auth.auth });
    const authCalls = auth.listUsers.mock.calls.length + auth.createUser.mock.calls.length + auth.updateUserById.mock.calls.length;
    await expect(provisionClient(manifest(`boundary-b-${suffix}`, email), { auth: auth.auth })).rejects.toBeInstanceOf(CrossTenantUserError);
    const tenantB = await getPool().query("SELECT id FROM finnor_os.tenants WHERE client_key=$1", [`boundary-b-${suffix}`]);
    const appUser = await getPool().query("SELECT tenant_id, role FROM finnor_os.users WHERE email=$1", [email]);
    expect(tenantB.rowCount).toBe(0);
    expect(appUser.rows[0]).toMatchObject({ tenant_id: first.tenantId, role: "owner" });
    expect(auth.listUsers.mock.calls.length + auth.createUser.mock.calls.length + auth.updateUserById.mock.calls.length).toBe(authCalls);
  }, 60_000);

  it("does not version unchanged policies and creates exactly one revision for a changed policy", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `policy-${suffix}@example.test`;
    const auth = fakeAuth();
    const desired = manifest(`policy-${suffix}`, email);
    const first = await provisionClient(desired, { auth: auth.auth });
    const before = await getPool().query(
      `SELECT p.id, p.version, count(r.id)::int revision_count
       FROM finnor_os.domain_policies p JOIN finnor_os.domain_policy_revisions r ON r.policy_id=p.id
       WHERE p.tenant_id=$1 AND p.action_type='launch_ad_campaign' GROUP BY p.id`,
      [first.tenantId],
    );
    await provisionClient(desired, { auth: auth.auth });
    const unchanged = await getPool().query("SELECT version FROM finnor_os.domain_policies WHERE id=$1", [before.rows[0].id]);
    expect(unchanged.rows[0].version).toBe(before.rows[0].version);

    const changed = parseClientManifest({
      ...desired,
      policyOverrides: { ...desired.policyOverrides, launch_ad_campaign: { policy: { max_daily_budget_usd: 75 } } },
    });
    const result = await provisionClient(changed, { auth: auth.auth });
    expect(result.policies.updated).toBe(1);
    const after = await getPool().query(
      "SELECT p.version, count(r.id)::int revision_count FROM finnor_os.domain_policies p JOIN finnor_os.domain_policy_revisions r ON r.policy_id=p.id WHERE p.id=$1 GROUP BY p.id",
      [before.rows[0].id],
    );
    expect(after.rows[0].version).toBe(before.rows[0].version + 1);
    expect(after.rows[0].revision_count).toBe(before.rows[0].revision_count + 1);
  }, 60_000);

  it("converges tenant, workspace, location, and integration configuration without timestamp churn", async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `config-${suffix}@example.test`;
    const auth = fakeAuth();
    const base = manifest(`config-${suffix}`, email);
    const first = await provisionClient(base, { auth: auth.auth });
    const changed = parseClientManifest({
      ...base,
      tenant: { ...base.tenant, name: "Converged Water", timezone: "America/New_York", settings: { ...base.tenant.settings, trainingMode: true } },
      workspaceConfig: {
        enabledSurfaces: ["home", "work", "customers"],
        terminology: { home: "HQ", work: "Cases", customers: "Accounts", schedule: "Calendar", money: "Finance", agents: "Team" },
        voiceEnabled: false,
        navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
        brand: { accent: "teal", radius: "precise", mark: "CW" },
        visibility: { policy: true, authority: false },
      },
      locations: [{ key: "main-office", name: "HQ", address: "2 Water Way", active: true }],
      integrations: base.integrations.map((integration) => integration.capability === "communications"
        ? { ...integration, binding: "vapi", mode: "sandbox", config: { region: "us" } }
        : integration),
    });
    await provisionClient(changed, { auth: auth.auth });
    const snapshot = await getPool().query(
      `SELECT t.name, t.timezone, s.training_mode, s.workspace_config, s.updated_at settings_updated_at,
              i.binding, i.mode, i.config, i.updated_at integration_updated_at,
              l.name location_name, l.address, l.updated_at location_updated_at
       FROM finnor_os.tenants t
       JOIN finnor_os.tenant_settings s ON s.tenant_id=t.id
       JOIN finnor_os.tenant_integrations i ON i.tenant_id=t.id AND i.capability='communications'
       JOIN finnor_os.tenant_locations l ON l.tenant_id=t.id AND l.location_key='main-office'
       WHERE t.id=$1`,
      [first.tenantId],
    );
    expect(snapshot.rows[0]).toMatchObject({ name: "Converged Water", timezone: "America/New_York", training_mode: true, binding: "vapi", mode: "sandbox", config: { region: "us" }, location_name: "HQ", address: "2 Water Way" });
    await provisionClient(changed, { auth: auth.auth });
    const stable = await getPool().query(
      `SELECT s.updated_at settings_updated_at, i.updated_at integration_updated_at, l.updated_at location_updated_at
       FROM finnor_os.tenant_settings s
       JOIN finnor_os.tenant_integrations i ON i.tenant_id=s.tenant_id AND i.capability='communications'
       JOIN finnor_os.tenant_locations l ON l.tenant_id=s.tenant_id AND l.location_key='main-office'
       WHERE s.tenant_id=$1`,
      [first.tenantId],
    );
    expect(stable.rows[0]).toEqual({
      settings_updated_at: snapshot.rows[0].settings_updated_at,
      integration_updated_at: snapshot.rows[0].integration_updated_at,
      location_updated_at: snapshot.rows[0].location_updated_at,
    });
  }, 60_000);
});
