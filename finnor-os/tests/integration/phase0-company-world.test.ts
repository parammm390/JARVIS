import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { closePool } from "@finnor/db";
import { companyContext, executeOperationalQuery, resolveParty } from "@finnor/read-models";
import { assembleOperatingContext } from "@finnor/orchestration";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function canConnect(connectionString: string): Promise<boolean> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const superAvailable = await canConnect(SUPER_URL);

describe.skipIf(!superAvailable)("Phase 0 Company World migration", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const clientKeyA = `phase0-a-${randomUUID().slice(0, 8)}`;
  const clientKeyB = `phase0-b-${randomUUID().slice(0, 8)}`;
  const locationA = randomUUID();
  const locationB = randomUUID();
  const userA = randomUUID();
  const userA2 = randomUUID();
  const userB = randomUUID();
  const marioA = randomUUID();
  const backupA = randomUUID();
  const suspendedA = randomUUID();
  const unitA = randomUUID();
  const unitB = randomUUID();
  const phoenixUnitA = randomUUID();
  const externalOrgA = randomUUID();
  const externalOrgB = randomUUID();
  const externalContactA = randomUUID();
  const externalContactB = randomUUID();
  const householdA = randomUUID();
  const workA = randomUUID();
  const taskA = randomUUID();
  const roleA = randomUUID();

  let admin: pg.Client;
  let app: pg.Client;

  beforeAll(async () => {
    process.env.DATABASE_URL = SUPER_URL;
    await migrate(SUPER_URL);
    admin = new pg.Client({ connectionString: SUPER_URL });
    await admin.connect();
    app = new pg.Client({ connectionString: APP_URL });
    await app.connect();

    await admin.query(
      `INSERT INTO finnor_os.tenants(id, client_key, name)
       VALUES ($1, $2, 'Phase 0 A'), ($3, $4, 'Phase 0 B')`,
      [tenantA, clientKeyA, tenantB, clientKeyB],
    );
    await admin.query(
      `INSERT INTO finnor_os.tenant_locations(id, tenant_id, location_key, name)
       VALUES ($1, $3, 'hq', 'Phase 0 A HQ'), ($2, $4, 'hq', 'Phase 0 B HQ')`,
      [locationA, locationB, tenantA, tenantB],
    );
    await admin.query(
      `INSERT INTO finnor_os.users(id, tenant_id, email, role, display_name, primary_location_id)
       VALUES ($1, $4, $5, 'owner', NULL, $7),
              ($2, $4, $6, 'technician', 'Phase 0 Manager', $7),
              ($3, $8, $9, 'owner', 'Tenant B Employee', $10)`,
      [userA, userA2, userB, tenantA, `phase0-a-${randomUUID()}@example.test`, `phase0-manager-${randomUUID()}@example.test`, locationA, tenantB, `phase0-b-${randomUUID()}@example.test`, locationB],
    );
    await admin.query(
      `INSERT INTO finnor_os.users(id, tenant_id, email, role, display_name, status, primary_location_id)
       VALUES ($1, $4, $5, 'technician', 'Mario', 'active', $8),
              ($2, $4, $6, 'dispatcher', 'Elena Backup', 'active', $8),
              ($3, $4, $7, 'technician', 'Suspended Riley', 'suspended', $8)`,
      [marioA, backupA, suspendedA, tenantA,
        `mario-${randomUUID()}@example.test`, `backup-${randomUUID()}@example.test`, `suspended-${randomUUID()}@example.test`, locationA],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_units(id, tenant_id, unit_key, name, kind, location_id, managed_by)
       VALUES ($1, $3, 'field-service', 'Field Service', 'team', $5, $7),
              ($2, $4, 'other-team', 'Other Team', 'department', $6, $8)`,
      [unitA, unitB, tenantA, tenantB, locationA, locationB, clientKeyA, clientKeyB],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_units(id, tenant_id, unit_key, name, kind, location_id, managed_by)
       VALUES ($1, $2, 'phoenix-install', 'Phoenix Installation', 'team', $3, $4)`,
      [phoenixUnitA, tenantA, locationA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_unit_memberships(tenant_id, org_unit_id, employee_id, membership_role, is_primary, managed_by)
       VALUES ($1, $2, $3, 'member', true, $4)`,
      [tenantA, unitA, userA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_unit_memberships(tenant_id, org_unit_id, employee_id, membership_role, is_primary, managed_by)
       VALUES ($1, $2, $3, 'installer', true, $5),
              ($1, $2, $4, 'installer', false, $5)`,
      [tenantA, phoenixUnitA, marioA, suspendedA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.employee_relationships(tenant_id, subject_employee_id, related_employee_id, relationship_type, managed_by)
       VALUES ($1, $2, $3, 'manager', $4)`,
      [tenantA, userA, userA2, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.employee_relationships(tenant_id, subject_employee_id, related_employee_id, relationship_type, managed_by)
       VALUES ($1, $2, $3, 'manager', $5),
              ($1, $2, $4, 'backup', $5)`,
      [tenantA, marioA, userA2, backupA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.external_organizations(id, tenant_id, organization_key, name, kind, business_email, business_phone, managed_by)
       VALUES ($1, $3, 'acme', 'Acme Supplier', 'supplier', 'ops@acme.test', '+1-555-0100', $5),
              ($2, $4, 'other', 'Other Supplier', 'vendor', 'ops@other.test', '+1-555-0101', $6)`,
      [externalOrgA, externalOrgB, tenantA, tenantB, clientKeyA, clientKeyB],
    );
    await admin.query(
      `INSERT INTO finnor_os.external_contacts(id, tenant_id, contact_key, external_organization_id, name, business_email, business_phone, managed_by)
       VALUES ($1, $3, 'acme-owner', $5, 'Acme Owner', 'owner@acme.test', '+1-555-0110', $7),
              ($2, $4, 'other-owner', $6, 'Other Owner', 'owner@other.test', '+1-555-0111', $8)`,
      [externalContactA, externalContactB, tenantA, tenantB, externalOrgA, externalOrgB, clientKeyA, clientKeyB],
    );
    await admin.query(
      `INSERT INTO finnor_os.party_aliases(tenant_id, alias_key, party_type, party_id, alias, normalized_alias, managed_by)
       VALUES ($1, 'phase0-field-service', 'team', $2, 'Fíeld-Service', 'placeholder', $3)`,
      [tenantA, unitA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.party_aliases(tenant_id, alias_key, party_type, party_id, alias, normalized_alias, managed_by)
       VALUES ($1, 'phoenix-install-alias', 'team', $2, 'Phoenix install team', 'placeholder', $4),
              ($1, 'membrane-supplier-alias', 'external_organization', $3, 'our membrane supplier', 'placeholder', $4)`,
      [tenantA, phoenixUnitA, externalOrgA, clientKeyA],
    );
    await admin.query(
      `INSERT INTO finnor_os.households(id, tenant_id, address, contact_info)
       VALUES ($1, $2, 'PRIVATE ADDRESS', '{"name":"Configured household","email":"private@example.test"}')`,
      [householdA, tenantA],
    );
    await admin.query(
      `INSERT INTO finnor_os.works(id, tenant_id, initial_channel, initial_instruction, created_by)
       VALUES ($1, $2, 'console', 'Review Phase 0 context', $3)`,
      [workA, tenantA, userA],
    );
    await admin.query(
      `UPDATE finnor_os.works SET assigned_to=$2, current_owner_id=$2 WHERE id=$1 AND tenant_id=$3`,
      [workA, marioA, tenantA],
    );
    await admin.query(
      `INSERT INTO finnor_os.work_entity_links(tenant_id, work_id, entity_type, entity_id, relationship)
       VALUES ($1, $2, 'org_unit', $3, 'about')`,
      [tenantA, workA, unitA],
    );
    await admin.query(
      `INSERT INTO finnor_os.tasks(id, tenant_id, subject_type, subject_id, title, assignee_type, assignee_id, status)
       VALUES ($1, $2, 'household', $3, 'Confirm membrane delivery', 'user', $4, 'open')`,
      [taskA, tenantA, householdA, marioA],
    );
    await admin.query(
      `INSERT INTO finnor_os.user_operating_profiles(user_id, tenant_id, title)
       VALUES ($1, $2, 'Installation Lead')`,
      [marioA, tenantA],
    );
    await admin.query(
      `INSERT INTO finnor_os.employee_roles(id, tenant_id, key, name)
       VALUES ($1, $2, 'installation_lead', 'Installation Lead')`,
      [roleA, tenantA],
    );
    await admin.query(
      `INSERT INTO finnor_os.employee_role_assignments(tenant_id, employee_id, role_id)
       VALUES ($1, $2, $3)`,
      [tenantA, marioA, roleA],
    );
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await closePool();
  });

  it("applies 0084 on upgrade and is idempotent on replay", async () => {
    const migration = await admin.query<{ name: string }>(
      "SELECT name FROM finnor_os._migrations WHERE name = '0084_phase0_company_world.sql'",
    );
    expect(migration.rows).toHaveLength(1);
    expect((await migrate(SUPER_URL)).filter((name) => name === "0084_phase0_company_world.sql")).toHaveLength(0);

    const columns = await admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema='finnor_os'
         AND ((table_name IN ('org_units','org_unit_memberships','employee_relationships','party_aliases','external_organizations','external_contacts')
               AND column_name IN ('unit_key','kind','location_id','is_primary','subject_employee_id','alias_key','business_email','business_phone','external_organization_id'))
              OR (table_name='users' AND column_name='primary_location_id'))`,
    );
    expect(columns.rows.length).toBeGreaterThanOrEqual(10);
    expect((await admin.query("SELECT to_regclass('finnor_os.user_location_refs') AS table_name")).rows[0]?.table_name).toBeNull();
    expect((await admin.query("SELECT to_regclass('finnor_os.company_graph_edges') AS table_name")).rows[0]?.table_name).toBe("company_graph_edges");
    expect((await admin.query("SELECT to_regclass('finnor_os.company_graph_nodes') AS table_name")).rows[0]?.table_name).toBe("company_graph_nodes");
  });

  it("normalizes punctuation and accents exactly at the SQL boundary", async () => {
    const normalized = await admin.query<{ mario: string; phrase: string }>(
      `SELECT finnor_os.normalize_party_text('Mario!') AS mario,
              finnor_os.normalize_party_text('  Beyoncé / Field-Service  ') AS phrase`,
    );
    expect(normalized.rows[0]).toEqual({ mario: "mario", phrase: "beyonce field service" });
  });

  it("resolves names, relationships, Work assignment, aliases, and business contacts deterministically", async () => {
    const mario = await resolveParty(tenantA, { query: "Mario" });
    expect(mario).toMatchObject({ status: "resolved", method: "exact_name", party: { ref: { partyType: "employee", partyId: marioA }, displayName: "Mario", status: "active" } });
    expect(mario.party).not.toHaveProperty("email");
    expect(mario.party).not.toHaveProperty("phone");

    await expect(resolveParty(tenantA, { query: "my manager" }, { requesterEmployeeId: marioA })).resolves.toMatchObject({
      status: "resolved",
      method: "relationship",
      party: { ref: { partyType: "employee", partyId: userA2 } },
    });
    await expect(resolveParty(tenantA, { query: "Mario's backup" })).resolves.toMatchObject({
      status: "resolved",
      method: "relationship",
      party: { ref: { partyType: "employee", partyId: backupA } },
    });
    await expect(resolveParty(tenantA, { query: "Phoenix install team" })).resolves.toMatchObject({
      status: "resolved",
      method: "alias",
      party: { ref: { partyType: "team", partyId: phoenixUnitA } },
    });
    await expect(resolveParty(tenantA, { query: "field service" })).resolves.toMatchObject({
      status: "resolved",
      method: "alias",
      party: { ref: { partyType: "team", partyId: unitA } },
    });
    await expect(resolveParty(tenantA, { query: "our membrane supplier" })).resolves.toMatchObject({
      status: "resolved",
      method: "alias",
      party: { ref: { partyType: "external_organization", partyId: externalOrgA } },
    });
    await expect(resolveParty(tenantA, { query: "ops@acme.test" })).resolves.toMatchObject({
      status: "resolved",
      method: "business_contact",
      party: { ref: { partyType: "external_organization", partyId: externalOrgA } },
    });
    await expect(resolveParty(tenantA, { query: "the technician assigned to this Work" }, { workId: workA })).resolves.toMatchObject({
      status: "resolved",
      method: "work_context",
      party: { ref: { partyType: "employee", partyId: marioA } },
    });
  });

  it("fails closed for suspended and cross-tenant parties", async () => {
    const suspended = await resolveParty(tenantA, { query: "Suspended Riley" });
    expect(suspended).toMatchObject({ status: "inactive", party: null, candidates: [{ ref: { partyType: "employee", partyId: suspendedA }, status: "suspended" }] });
    await expect(resolveParty(tenantA, { ref: { partyType: "employee", partyId: userB } })).resolves.toMatchObject({ status: "not_found", party: null, candidates: [] });
    await expect(resolveParty(tenantA, { query: "Tenant B Employee" })).resolves.toMatchObject({ status: "not_found", party: null, candidates: [] });
  });

  it("executes the four canonical party reads with exact active roster semantics", async () => {
    const roster = await executeOperationalQuery(tenantA, {
      intent: "team_roster",
      teamRef: { partyType: "team", partyId: phoenixUnitA },
      page: { limit: 100 },
    }, { employeeId: marioA });
    expect(roster).toMatchObject({ status: "ok", resolution: "exact", team: { ref: { partyType: "team", partyId: phoenixUnitA } } });
    expect(roster.members.map((member) => member.ref.partyId)).toEqual([marioA]);
    expect(roster.page).toMatchObject({ returned: 1, totalCount: 1, totalCountExact: true, truncated: false });

    const context = await executeOperationalQuery(tenantA, { intent: "party_context", query: "my manager" }, { employeeId: marioA });
    expect(context).toMatchObject({ status: "ok", resolution: "unique", party: { ref: { partyType: "employee", partyId: userA2 } } });

    const supplier = await executeOperationalQuery(tenantA, { intent: "party_lookup", query: "our membrane supplier" });
    expect(supplier).toMatchObject({ status: "ok", resolution: "unique", rows: [{ ref: { partyType: "external_organization", partyId: externalOrgA } }] });
    expect(supplier.rows[0]).not.toHaveProperty("businessEmail");
    expect(supplier.rows[0]).not.toHaveProperty("businessPhone");

    const availability = await executeOperationalQuery(tenantA, {
      intent: "party_availability",
      ref: { partyType: "employee", partyId: marioA },
      localDateRange: { startDate: "today" },
    });
    expect(availability).toMatchObject({ status: "ok", resolution: "exact", party: { ref: { partyType: "employee", partyId: marioA } }, availability: "unknown" });
  });

  it("anchors CompanyContext on company parties without requiring a household", async () => {
    const anchors = [
      { partyType: "employee" as const, partyId: marioA },
      { partyType: "team" as const, partyId: phoenixUnitA },
      { partyType: "location" as const, partyId: locationA },
      { partyType: "external_organization" as const, partyId: externalOrgA },
    ];
    for (const anchor of anchors) {
      const context = await companyContext(tenantA, anchor);
      expect(context).toMatchObject({ anchor, household: null });
      expect(context?.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ entityId: anchor.partyId }),
      ]));
    }
    const legacy = await companyContext(tenantA, { partyType: "household", partyId: householdA });
    expect(legacy?.household?.id).toBe(householdA);

    const inactiveContext = await executeOperationalQuery(tenantA, {
      intent: "company_context",
      anchor: { partyType: "employee", partyId: suspendedA },
    });
    expect(inactiveContext).toMatchObject({ status: "inactive", resolution: "inactive", context: null });
  });

  it("assembles bounded canonical companyDirectory data for the authenticated employee", async () => {
    const assembled = await assembleOperatingContext(
      { tenantId: tenantA, userId: marioA, employeeId: marioA, role: "technician", authorityRoles: ["technician"] },
      { instruction: "Show my company context", workId: workA, includeMemory: false, includeCanonicalBusinessState: false },
    );
    expect(assembled.context.companyDirectory).toMatchObject({
      employee: { ref: { partyType: "employee", partyId: marioA }, title: "Installation Lead" },
      reporting: {
        manager: { ref: { partyType: "employee", partyId: userA2 } },
        backups: [{ ref: { partyType: "employee", partyId: backupA } }],
      },
      authorityRoles: expect.arrayContaining(["installation_lead", "technician"]),
    });
    expect(assembled.context.companyDirectory.teams.map((team) => team.ref.partyId)).toContain(phoenixUnitA);
    expect(assembled.context.companyDirectory.locations.map((location) => location.ref.partyId)).toContain(locationA);
    expect(assembled.context.companyDirectory.currentWork.map((work) => work.id)).toContain(workA);
    expect(assembled.context.companyDirectory.currentTasks.map((task) => task.id)).toContain(taskA);
    expect(assembled.context.companyDirectory.referencedParties.map((party) => party.ref.partyId)).toContain(unitA);
  });

  it("returns explicit ambiguity when two active employees share the same exact name", async () => {
    const duplicateMario = randomUUID();
    await admin.query(
      `INSERT INTO finnor_os.users(id, tenant_id, email, role, display_name, status)
       VALUES ($1, $2, $3, 'dispatcher', 'Mario', 'active')`,
      [duplicateMario, tenantA, `duplicate-mario-${randomUUID()}@example.test`],
    );
    const resolution = await resolveParty(tenantA, { query: "Mario" });
    expect(resolution).toMatchObject({ status: "ambiguous", party: null, method: "exact_name" });
    expect(resolution.candidates.map((candidate) => candidate.ref.partyId).sort()).toEqual([marioA, duplicateMario].sort());
  });

  it("enforces RLS for both reads and forged tenant writes", async () => {
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [tenantA]);
    expect((await app.query("SELECT id FROM finnor_os.org_units WHERE tenant_id=$1", [tenantA])).rows)
      .toEqual(expect.arrayContaining([{ id: unitA }, { id: phoenixUnitA }]));
    expect((await app.query("SELECT id FROM finnor_os.org_units WHERE tenant_id=$1", [tenantB])).rows).toHaveLength(0);
    await expect(app.query(
      `INSERT INTO finnor_os.org_units(tenant_id, unit_key, name, kind) VALUES ($1, 'forged', 'Forged', 'team')`,
      [tenantB],
    )).rejects.toThrow(/row-level security|policy/i);
  });

  it("rejects cross-tenant employee/team/alias/org references as an owner bypass", async () => {
    await expect(admin.query(
      `INSERT INTO finnor_os.users(tenant_id, email, role, primary_location_id)
       VALUES ($1, $2, 'owner', $3)`,
      [tenantA, `forged-location-${randomUUID()}@example.test`, locationB],
    )).rejects.toThrow(/foreign key|violates/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.org_unit_memberships(tenant_id, org_unit_id, employee_id)
       VALUES ($1, $2, $3)`,
      [tenantA, unitB, userA],
    )).rejects.toThrow(/foreign key|violates/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.employee_relationships(tenant_id, subject_employee_id, related_employee_id, relationship_type)
       VALUES ($1, $2, $3, 'manager')`,
      [tenantA, userA, userB],
    )).rejects.toThrow(/foreign key|violates/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.party_aliases(tenant_id, alias_key, party_type, party_id, alias, normalized_alias)
       VALUES ($1, $2, 'team', $3, 'Forged team', 'forged team')`,
      [tenantA, `forged-${randomUUID().slice(0, 8)}`, unitB],
    )).rejects.toThrow(/tenant|missing|boundary/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.external_contacts(tenant_id, contact_key, external_organization_id, name)
       VALUES ($1, $2, $3, 'Forged contact')`,
      [tenantA, `forged-${randomUUID().slice(0, 8)}`, externalOrgB],
    )).rejects.toThrow(/foreign key|violates/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.org_units(tenant_id, unit_key, name, kind, location_id)
       VALUES ($1, $2, 'Forged location', 'team', $3)`,
      [tenantA, `forged-${randomUUID().slice(0, 8)}`, locationB],
    )).rejects.toThrow(/foreign key|violates/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.work_entity_links(tenant_id, work_id, entity_type, entity_id)
       VALUES ($1, $2, 'org_unit', $3)`,
      [tenantA, workA, unitB],
    )).rejects.toThrow(/tenant|unknown|boundary/i);
    await expect(admin.query(
      `INSERT INTO finnor_os.org_units(tenant_id, unit_key, name, kind, managed_by)
       VALUES ($1, $2, 'Forged manager', 'team', $3)`,
      [tenantA, `forged-${randomUUID().slice(0, 8)}`, clientKeyB],
    )).rejects.toThrow(/foreign key|violates/i);
  });

  it("integrates company edges and privacy-safe nodes on the existing graph surface", async () => {
    await app.query("SELECT set_config('app.tenant_id', $1, false)", [tenantA]);
    const edges = await app.query<{ from_entity_type: string; from_entity_id: string; relationship: string; to_entity_type: string; to_entity_id: string; source_table: string; source_column: string }>(
      `SELECT from_entity_type, from_entity_id, relationship, to_entity_type, to_entity_id, source_table, source_column
       FROM finnor_os.company_graph_edges WHERE tenant_id=$1`,
      [tenantA],
    );
    expect(edges.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ from_entity_type: "user", from_entity_id: userA, relationship: "member_of", to_entity_type: "org_unit", to_entity_id: unitA }),
      expect.objectContaining({ from_entity_type: "org_unit", from_entity_id: unitA, relationship: "located_at", to_entity_type: "tenant_location", to_entity_id: locationA }),
      expect.objectContaining({ from_entity_type: "user", from_entity_id: userA, relationship: "located_at", to_entity_type: "tenant_location", to_entity_id: locationA }),
      expect.objectContaining({ from_entity_type: "user", from_entity_id: userA, relationship: "manager", to_entity_type: "user", to_entity_id: userA2 }),
      expect.objectContaining({ from_entity_type: "user", from_entity_id: userA2, relationship: "report", to_entity_type: "user", to_entity_id: userA }),
      expect.objectContaining({ from_entity_type: "external_contact", from_entity_id: externalContactA, relationship: "works_for", to_entity_type: "external_organization", to_entity_id: externalOrgA }),
    ]));

    const nodes = await app.query<{ entity_type: string; entity_id: string; label: string; status: string | null; source_table: string }>(
      `SELECT entity_type, entity_id, label, status, source_table
       FROM finnor_os.company_graph_nodes WHERE tenant_id=$1`,
      [tenantA],
    );
    expect(nodes.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_type: "user", entity_id: userA, label: "Employee" }),
      expect.objectContaining({ entity_type: "org_unit", entity_id: unitA, label: "Field Service" }),
      expect.objectContaining({ entity_type: "external_organization", entity_id: externalOrgA, label: "Acme Supplier" }),
      expect.objectContaining({ entity_type: "external_contact", entity_id: externalContactA, label: "Acme Owner" }),
    ]));
    const householdNode = nodes.rows.find((row) => row.entity_type === "household" && row.entity_id === householdA);
    expect(householdNode?.label).toBe("Configured household");

    const nodeColumns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='finnor_os' AND table_name='company_graph_nodes'
       ORDER BY ordinal_position`,
    );
    expect(nodeColumns.rows.map((row) => row.column_name)).toEqual([
      "tenant_id", "entity_type", "entity_id", "label", "status", "occurred_at", "source_table",
    ]);
  });
});
