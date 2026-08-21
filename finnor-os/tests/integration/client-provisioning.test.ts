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

function manifest(key: string, email: string, overrides: Record<string, unknown> = {}): ClientManifest {
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

  it("repeats a 100-employee Company World manifest without duplicate parties", async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `hundred-${suffix}`;
    const employeeUsers = Array.from({ length: 100 }, (_, index) => ({
      email: `${key}-${index}@example.test`,
      role: index === 0 ? "owner" as const : "technician" as const,
      displayName: `Employee ${index}`,
      locationKey: "main-office",
    }));
    const desired = manifest(key, employeeUsers[0]!.email, {
      users: employeeUsers,
      orgUnits: [
        { key: "ops", name: "Operations", kind: "team", locationKey: "main-office" },
        { key: "dispatch", name: "Dispatch", kind: "department" },
      ],
      orgUnitMemberships: employeeUsers.map((user) => ({ employeeEmail: user.email, orgUnitKey: "ops" })),
      employeeRelationships: employeeUsers.slice(1).map((user) => ({
        subjectEmployeeEmail: user.email,
        relatedEmployeeEmail: employeeUsers[0]!.email,
        relationshipType: "manager" as const,
      })),
      aliases: [
        { key: "ops-alias", partyType: "team", partyKey: "ops", alias: "Field Operations" },
        { key: "owner-alias", partyType: "employee", partyKey: employeeUsers[0]!.email, alias: "Operations Lead" },
        { key: "supplier-alias", partyType: "external_organization", partyKey: "parts-supplier", alias: "Our Parts Supplier" },
        { key: "contact-alias", partyType: "external_contact", partyKey: "parts-jane", alias: "Jane at Parts" },
      ],
      externalOrganizations: [{ key: "parts-supplier", name: "Parts Supplier", kind: "supplier", businessEmail: "sales@parts.test" }],
      externalContacts: [{ key: "parts-jane", name: "Jane Parts", externalOrganizationKey: "parts-supplier", businessEmail: "jane@parts.test" }],
    });
    const auth = fakeAuth();
    const first = await provisionClient(desired, { auth: auth.auth });
    const second = await provisionClient(desired, { auth: auth.auth });

    expect(second.tenantId).toBe(first.tenantId);
    expect(second.companyWorld).toMatchObject({
      orgUnits: 2,
      memberships: 100,
      relationships: 99,
      aliases: 4,
      externalOrganizations: 1,
      externalContacts: 1,
    });
    const counts = await getPool().query<{
      users: number; org_units: number; memberships: number; relationships: number;
      aliases: number; external_organizations: number; external_contacts: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM finnor_os.users WHERE tenant_id=$1) users,
        (SELECT count(*)::int FROM finnor_os.org_units WHERE tenant_id=$1 AND managed_by=$2) org_units,
        (SELECT count(*)::int FROM finnor_os.org_unit_memberships WHERE tenant_id=$1 AND managed_by=$2 AND active) memberships,
        (SELECT count(*)::int FROM finnor_os.employee_relationships WHERE tenant_id=$1 AND managed_by=$2 AND active) relationships,
        (SELECT count(*)::int FROM finnor_os.party_aliases WHERE tenant_id=$1 AND managed_by=$2 AND active) aliases,
        (SELECT count(*)::int FROM finnor_os.external_organizations WHERE tenant_id=$1 AND managed_by=$2 AND active) external_organizations,
        (SELECT count(*)::int FROM finnor_os.external_contacts WHERE tenant_id=$1 AND managed_by=$2 AND active) external_contacts`,
      [first.tenantId, desired.clientKey],
    );
    expect(counts.rows[0]).toEqual({ users: 100, org_units: 2, memberships: 100, relationships: 99, aliases: 4, external_organizations: 1, external_contacts: 1 });
    const identities = await getPool().query(
      `SELECT
        (SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='ops') org_id,
        (SELECT id FROM finnor_os.external_organizations WHERE tenant_id=$1 AND organization_key='parts-supplier') organization_id,
        (SELECT id FROM finnor_os.external_contacts WHERE tenant_id=$1 AND contact_key='parts-jane') contact_id,
        (SELECT id FROM finnor_os.party_aliases WHERE tenant_id=$1 AND alias_key='ops-alias') alias_id,
        (SELECT m.id FROM finnor_os.org_unit_memberships m JOIN finnor_os.users u ON u.id=m.employee_id JOIN finnor_os.org_units o ON o.id=m.org_unit_id WHERE m.tenant_id=$1 AND u.email=$2 AND o.unit_key='ops') membership_id`,
      [first.tenantId, employeeUsers[0]!.email],
    );
    await provisionClient(desired, { auth: auth.auth });
    const repeatedIdentities = await getPool().query(
      `SELECT
        (SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='ops') org_id,
        (SELECT id FROM finnor_os.external_organizations WHERE tenant_id=$1 AND organization_key='parts-supplier') organization_id,
        (SELECT id FROM finnor_os.external_contacts WHERE tenant_id=$1 AND contact_key='parts-jane') contact_id,
        (SELECT id FROM finnor_os.party_aliases WHERE tenant_id=$1 AND alias_key='ops-alias') alias_id,
        (SELECT m.id FROM finnor_os.org_unit_memberships m JOIN finnor_os.users u ON u.id=m.employee_id JOIN finnor_os.org_units o ON o.id=m.org_unit_id WHERE m.tenant_id=$1 AND u.email=$2 AND o.unit_key='ops') membership_id`,
      [first.tenantId, employeeUsers[0]!.email],
    );
    expect(repeatedIdentities.rows[0]).toEqual(identities.rows[0]);
  }, 180_000);

  it("preserves omitted Company World collections and safely inactivates only manifest-owned removals", async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `modify-${suffix}`;
    const managerEmail = `manager-${suffix}@example.test`;
    const workerEmail = `worker-${suffix}@example.test`;
    const auth = fakeAuth();
    const initial = manifest(key, managerEmail, {
      users: [
        { email: managerEmail, role: "owner", displayName: "Manager", locationKey: "main-office" },
        { email: workerEmail, role: "technician", displayName: "Worker" },
      ],
      orgUnits: [
        { key: "ops", name: "Operations", kind: "team" },
        { key: "support", name: "Support", kind: "team" },
      ],
      orgUnitMemberships: [
        { employeeEmail: managerEmail, orgUnitKey: "ops", membershipRole: "lead" },
        { employeeEmail: workerEmail, orgUnitKey: "support" },
      ],
      employeeRelationships: [{ subjectEmployeeEmail: workerEmail, relatedEmployeeEmail: managerEmail, relationshipType: "manager" }],
      aliases: [
        { key: "ops-alias", partyType: "team", partyKey: "ops", alias: "Ops Team" },
        { key: "worker-alias", partyType: "employee", partyKey: workerEmail, alias: "Field Worker" },
      ],
      externalOrganizations: [{ key: "old-supplier", name: "Old Supplier", kind: "supplier" }],
      externalContacts: [{ key: "old-contact", name: "Old Contact", externalOrganizationKey: "old-supplier" }],
    });
    const first = await provisionClient(initial, { auth: auth.auth });
    const before = await getPool().query<{
      ops_id: string; support_id: string; membership_id: string; removed_membership_id: string;
      relationship_id: string; alias_id: string; supplier_id: string; contact_id: string; location_id: string;
    }>(
      `SELECT
        (SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='ops') ops_id,
        (SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='support') support_id,
        (SELECT m.id FROM finnor_os.org_unit_memberships m JOIN finnor_os.users u ON u.id=m.employee_id JOIN finnor_os.org_units o ON o.id=m.org_unit_id WHERE m.tenant_id=$1 AND u.email=$2 AND o.unit_key='ops') membership_id,
        (SELECT m.id FROM finnor_os.org_unit_memberships m JOIN finnor_os.users u ON u.id=m.employee_id JOIN finnor_os.org_units o ON o.id=m.org_unit_id WHERE m.tenant_id=$1 AND u.email=$3 AND o.unit_key='support') removed_membership_id,
        (SELECT id FROM finnor_os.employee_relationships WHERE tenant_id=$1) relationship_id,
        (SELECT id FROM finnor_os.party_aliases WHERE tenant_id=$1 AND alias_key='ops-alias') alias_id,
        (SELECT id FROM finnor_os.external_organizations WHERE tenant_id=$1 AND organization_key='old-supplier') supplier_id,
        (SELECT id FROM finnor_os.external_contacts WHERE tenant_id=$1 AND contact_key='old-contact') contact_id,
        (SELECT primary_location_id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2) location_id`,
      [first.tenantId, managerEmail, workerEmail],
    );
    expect(before.rows[0]!.location_id).toBeTruthy();

    // An operator-authored row is outside this client's managed_by scope.
    await getPool().query(
      `INSERT INTO finnor_os.org_units (tenant_id, unit_key, name, kind, managed_by)
       VALUES ($1, 'operator-team', 'Operator Team', 'team', NULL)`,
      [first.tenantId],
    );
    const operatorTeam = await getPool().query<{ id: string }>("SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='operator-team'", [first.tenantId]);
    const manager = await getPool().query<{ id: string }>("SELECT id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2", [first.tenantId, managerEmail]);
    const worker = await getPool().query<{ id: string }>("SELECT id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2", [first.tenantId, workerEmail]);
    await getPool().query(
      `INSERT INTO finnor_os.org_unit_memberships (tenant_id, org_unit_id, employee_id, managed_by)
       VALUES ($1, $2, $3, NULL)`,
      [first.tenantId, operatorTeam.rows[0]!.id, worker.rows[0]!.id],
    );
    await getPool().query(
      `INSERT INTO finnor_os.employee_relationships (tenant_id, subject_employee_id, related_employee_id, relationship_type, managed_by)
       VALUES ($1, $2, $3, 'backup', NULL)`,
      [first.tenantId, worker.rows[0]!.id, manager.rows[0]!.id],
    );
    await getPool().query(
      `INSERT INTO finnor_os.party_aliases (tenant_id, alias_key, party_type, party_id, alias, normalized_alias, managed_by)
       VALUES ($1, 'operator-alias', 'employee', $2, 'Operator Alias', 'operator alias', NULL)`,
      [first.tenantId, worker.rows[0]!.id],
    );
    await getPool().query(
      `INSERT INTO finnor_os.external_organizations (tenant_id, organization_key, name, kind, managed_by)
       VALUES ($1, 'operator-supplier', 'Operator Supplier', 'supplier', NULL)`,
      [first.tenantId],
    );
    const operatorOrg = await getPool().query<{ id: string }>("SELECT id FROM finnor_os.external_organizations WHERE tenant_id=$1 AND organization_key='operator-supplier'", [first.tenantId]);
    await getPool().query(
      `INSERT INTO finnor_os.external_contacts (tenant_id, contact_key, external_organization_id, name, managed_by)
       VALUES ($1, 'operator-contact', $2, 'Operator Contact', NULL)`,
      [first.tenantId, operatorOrg.rows[0]!.id],
    );

    // A pre-P0 manifest omits every Company World collection and must leave all
    // existing rows, including the primary location, as-is.
    const omitted = manifest(key, managerEmail, {
      users: [{ email: managerEmail, role: "owner", displayName: "Manager" }, { email: workerEmail, role: "technician", displayName: "Worker" }],
    });
    await provisionClient(omitted, { auth: auth.auth });
    const afterOmission = await getPool().query(
      `SELECT
        (SELECT active FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='support') support_active,
        (SELECT primary_location_id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2) location_id,
        (SELECT active FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='operator-team') operator_active,
        (SELECT managed_by FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='operator-team') operator_managed_by`,
      [first.tenantId, managerEmail],
    );
    expect(afterOmission.rows[0]).toMatchObject({ support_active: true, location_id: before.rows[0]!.location_id, operator_active: true, operator_managed_by: null });

    const changed = parseClientManifest({
      ...omitted,
      users: [{ email: managerEmail, role: "owner", displayName: "Manager" }, { email: workerEmail, role: "technician", displayName: "Worker" }],
      orgUnits: [{ key: "ops", name: "Renamed Operations", kind: "team" }],
      orgUnitMemberships: [{ employeeEmail: managerEmail, orgUnitKey: "ops", membershipRole: "lead" }],
      employeeRelationships: [],
      aliases: [],
      externalOrganizations: [],
      externalContacts: [],
    });
    await provisionClient(changed, { auth: auth.auth });
    const after = await getPool().query(
      `SELECT
        (SELECT id FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='ops') ops_id,
        (SELECT name FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='ops') ops_name,
        (SELECT active FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='support') support_active,
        (SELECT active FROM finnor_os.org_unit_memberships WHERE id=$2) retained_membership_active,
        (SELECT active FROM finnor_os.org_unit_memberships WHERE id=$3) removed_membership_active,
        (SELECT active FROM finnor_os.employee_relationships WHERE id=$4) removed_relationship_active,
        (SELECT active FROM finnor_os.party_aliases WHERE id=$5) removed_alias_active,
        (SELECT active FROM finnor_os.external_organizations WHERE id=$6) removed_supplier_active,
        (SELECT active FROM finnor_os.external_contacts WHERE id=$7) removed_contact_active,
        (SELECT active FROM finnor_os.org_units WHERE tenant_id=$1 AND unit_key='operator-team') operator_active,
        (SELECT m.active FROM finnor_os.org_unit_memberships m JOIN finnor_os.org_units o ON o.id=m.org_unit_id WHERE m.tenant_id=$1 AND o.unit_key='operator-team') operator_membership_active,
        (SELECT active FROM finnor_os.employee_relationships WHERE tenant_id=$1 AND relationship_type='backup') operator_relationship_active,
        (SELECT active FROM finnor_os.party_aliases WHERE tenant_id=$1 AND alias_key='operator-alias') operator_alias_active,
        (SELECT active FROM finnor_os.external_organizations WHERE tenant_id=$1 AND organization_key='operator-supplier') operator_supplier_active,
        (SELECT active FROM finnor_os.external_contacts WHERE tenant_id=$1 AND contact_key='operator-contact') operator_contact_active,
        (SELECT primary_location_id FROM finnor_os.users WHERE tenant_id=$1 AND email=$8) preserved_location_id`,
      [first.tenantId, before.rows[0]!.membership_id, before.rows[0]!.removed_membership_id, before.rows[0]!.relationship_id, before.rows[0]!.alias_id, before.rows[0]!.supplier_id, before.rows[0]!.contact_id, managerEmail],
    );
    expect(after.rows[0]).toMatchObject({
      ops_id: before.rows[0]!.ops_id,
      ops_name: "Renamed Operations",
      support_active: false,
      retained_membership_active: true,
      removed_membership_active: false,
      removed_relationship_active: false,
      removed_alias_active: false,
      removed_supplier_active: false,
      removed_contact_active: false,
      operator_active: true,
      operator_membership_active: true,
      operator_relationship_active: true,
      operator_alias_active: true,
      operator_supplier_active: true,
      operator_contact_active: true,
      preserved_location_id: before.rows[0]!.location_id,
    });

    const cleared = parseClientManifest({ ...changed, users: [{ email: managerEmail, role: "owner", locationKey: null }, { email: workerEmail, role: "technician" }] });
    await provisionClient(cleared, { auth: auth.auth });
    const location = await getPool().query("SELECT primary_location_id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2", [first.tenantId, managerEmail]);
    expect(location.rows[0].primary_location_id).toBeNull();
  }, 180_000);

  it("limits per-user orgUnitKeys convergence to employees that declared the field", async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `user-scope-${suffix}`;
    const firstEmail = `first-${suffix}@example.test`;
    const secondEmail = `second-${suffix}@example.test`;
    const auth = fakeAuth();
    const users = [
      { email: firstEmail, role: "owner" as const, displayName: "First Employee" },
      { email: secondEmail, role: "technician" as const, displayName: "Second Employee" },
    ];
    const orgUnits = [
      { key: "alpha-team", name: "Alpha Team", kind: "team" as const },
      { key: "beta-team", name: "Beta Team", kind: "team" as const },
    ];
    const initial = manifest(key, firstEmail, {
      users,
      orgUnits,
      orgUnitMemberships: [
        { employeeEmail: firstEmail, orgUnitKey: "alpha-team" },
        { employeeEmail: secondEmail, orgUnitKey: "beta-team" },
      ],
    });
    const provisioned = await provisionClient(initial, { auth: auth.auth });

    const partial = manifest(key, firstEmail, {
      users: [
        { ...users[0]!, orgUnitKeys: [] },
        users[1]!,
      ],
      orgUnits,
      // Omitted: the collection is not globally authoritative. Only the first
      // employee's explicit orgUnitKeys field is a membership convergence scope.
    });
    await provisionClient(partial, { auth: auth.auth });

    const rows = await getPool().query<{ email: string; active: boolean }>(
      `SELECT u.email, m.active
       FROM finnor_os.org_unit_memberships m
       JOIN finnor_os.users u ON u.tenant_id=m.tenant_id AND u.id=m.employee_id
       WHERE m.tenant_id=$1 AND m.managed_by=$2
       ORDER BY u.email`,
      [provisioned.tenantId, key],
    );
    expect(rows.rows).toEqual([
      { email: firstEmail, active: false },
      { email: secondEmail, active: true },
    ]);
  }, 120_000);
});
