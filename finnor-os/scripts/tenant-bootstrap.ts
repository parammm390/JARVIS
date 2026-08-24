// Database half of convergent client provisioning. Every manifest-owned row has a
// stable natural key and updates only when its desired configuration differs.
// Supabase Auth creation remains a separate recoverable step in client-provisioning.
import type pg from "pg";
import { getPool } from "@finnor/db";
import { DEFAULT_WORKSPACE_CONFIG } from "../apps/api/lib/workspace-config";
import { DEFAULT_UNIVERSAL_ACTION_CONFIG, type ClientManifest } from "./client-manifest";
import { seedTenantPolicies } from "./seed-tenant-policies";

export interface ProvisionedManifestUser {
  id: string;
  email: string;
}

export interface BootstrapTenantResult {
  tenantId: string;
  clientKey: string;
  policies: Awaited<ReturnType<typeof seedTenantPolicies>>;
  integrations: number;
  locations: number;
  humanOnlyField: string | null;
}

export interface CompanyWorldConvergenceResult {
  orgUnits: number;
  memberships: number;
  relationships: number;
  aliases: number;
  externalOrganizations: number;
  externalContacts: number;
  userLocations: number;
}

export interface IdentityAccessConvergenceResult {
  communicationIdentities: number;
  communicationIdentityBindings: number;
  applicationAccounts: number;
  authProfiles: number;
  compatibilityMode: boolean;
}

async function withClientMutation<T>(
  manifest: ClientManifest,
  pool: pg.Pool,
  mutation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    await client.query("SET LOCAL row_security = off");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`client:${manifest.clientKey}`]);
    const result = await mutation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function companyWorldManifestHasReferences(manifest: ClientManifest): boolean {
  return manifest.orgUnits !== undefined
    || manifest.orgUnitMemberships !== undefined
    || manifest.employeeRelationships !== undefined
    || manifest.aliases !== undefined
    || manifest.externalOrganizations !== undefined
    || manifest.externalContacts !== undefined
    || manifest.users.some((user) => user.orgUnitKeys !== undefined || user.locationKey !== undefined);
}

async function companyWorldTablesAvailable(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    `SELECT to_regclass('finnor_os.org_units') IS NOT NULL
       AND to_regclass('finnor_os.org_unit_memberships') IS NOT NULL
       AND to_regclass('finnor_os.employee_relationships') IS NOT NULL
       AND to_regclass('finnor_os.party_aliases') IS NOT NULL
       AND to_regclass('finnor_os.external_organizations') IS NOT NULL
       AND to_regclass('finnor_os.external_contacts') IS NOT NULL AS present`,
  );
  return result.rows[0]?.present === true;
}

function ensureManifestOwned(
  rows: Array<{ natural_key: string; managed_by: string | null }>,
  clientKey: string,
  kind: string,
): void {
  const conflict = rows.find((row) => row.managed_by !== clientKey);
  if (conflict) {
    throw new Error(`${kind} key ${conflict.natural_key} is owned by another source; refusing to mutate it`);
  }
}

/** Converge only the stable tenant identity/presentation row. */
export async function ensureTenantRecord(manifest: ClientManifest, pool: pg.Pool = getPool()): Promise<string> {
  return withClientMutation(manifest, pool, async (client) => {
    const existing = await client.query<{ id: string }>("SELECT id FROM tenants WHERE client_key = $1", [manifest.clientKey]);
    if (existing.rows[0]) {
      const tenantId = existing.rows[0].id;
      await client.query(
        `UPDATE tenants SET name = $2, timezone = $3, owner_phone = $4
         WHERE id = $1 AND (name, timezone, owner_phone) IS DISTINCT FROM ($2, $3, $4)`,
        [tenantId, manifest.tenant.name, manifest.tenant.timezone, manifest.tenant.ownerPhone ?? null],
      );
      return tenantId;
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tenants (client_key, name, timezone, owner_phone)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [manifest.clientKey, manifest.tenant.name, manifest.tenant.timezone, manifest.tenant.ownerPhone ?? null],
    );
    return inserted.rows[0]!.id;
  });
}

/** Converge workspace settings, locations, and versioned policies only. */
export async function convergeWorkspaceAndPolicies(
  manifest: ClientManifest,
  tenantId: string,
  pool: pg.Pool = getPool(),
): Promise<Pick<BootstrapTenantResult, "policies" | "locations" | "humanOnlyField">> {
  await withClientMutation(manifest, pool, async (client) => {
    const tenant = await client.query("SELECT id FROM tenants WHERE id = $1 AND client_key = $2", [tenantId, manifest.clientKey]);
    if (!tenant.rows[0]) throw new Error(`Tenant ${tenantId} does not match client ${manifest.clientKey}`);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const settings = manifest.tenant.settings;
    const desiredWorkspace = manifest.workspaceConfig ?? null;
    const desiredUniversalActions = manifest.universalActions ?? null;
    await client.query(
      `INSERT INTO tenant_settings
         (tenant_id, is_dealer_zero, simulator_enabled, training_mode, workspace_config, universal_action_config)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE
       SET is_dealer_zero = EXCLUDED.is_dealer_zero,
           simulator_enabled = EXCLUDED.simulator_enabled,
           training_mode = EXCLUDED.training_mode,
           workspace_config = COALESCE($7::jsonb, tenant_settings.workspace_config),
           universal_action_config = COALESCE($8::jsonb, tenant_settings.universal_action_config),
           updated_at = now()
       WHERE (tenant_settings.is_dealer_zero, tenant_settings.simulator_enabled, tenant_settings.training_mode,
              tenant_settings.workspace_config, tenant_settings.universal_action_config)
             IS DISTINCT FROM
             (EXCLUDED.is_dealer_zero, EXCLUDED.simulator_enabled, EXCLUDED.training_mode,
              COALESCE($7::jsonb, tenant_settings.workspace_config),
              COALESCE($8::jsonb, tenant_settings.universal_action_config))`,
      [tenantId, settings.isDealerZero, settings.simulatorEnabled, settings.trainingMode,
        JSON.stringify(desiredWorkspace ?? DEFAULT_WORKSPACE_CONFIG),
        JSON.stringify(desiredUniversalActions ?? DEFAULT_UNIVERSAL_ACTION_CONFIG),
        desiredWorkspace ? JSON.stringify(desiredWorkspace) : null,
        desiredUniversalActions ? JSON.stringify(desiredUniversalActions) : null],
    );
    if (manifest.computer !== undefined || manifest.connectionRequirements !== undefined || manifest.connectionPolicy !== undefined) {
      await client.query(
        `UPDATE tenant_settings
            SET computer_config=coalesce($2::jsonb,computer_config),
                connection_requirements=coalesce($3::jsonb,connection_requirements),
                connection_policy=coalesce($4::jsonb,connection_policy),
                updated_at=now()
          WHERE tenant_id=$1
            AND (computer_config,connection_requirements,connection_policy) IS DISTINCT FROM
                (coalesce($2::jsonb,computer_config),coalesce($3::jsonb,connection_requirements),coalesce($4::jsonb,connection_policy))`,
        [tenantId,
          manifest.computer ? JSON.stringify(manifest.computer) : null,
          manifest.connectionRequirements ? JSON.stringify(manifest.connectionRequirements) : null,
          manifest.connectionPolicy ? JSON.stringify(manifest.connectionPolicy) : null],
      );
    }

    if (manifest.retentionPolicies !== undefined) {
      for (const policy of manifest.retentionPolicies) {
        await client.query(
          `INSERT INTO tenant_retention_policies(tenant_id,data_class,retention_days,legal_hold,managed_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id,data_class) DO UPDATE
             SET retention_days=EXCLUDED.retention_days,legal_hold=EXCLUDED.legal_hold,
                 managed_by=EXCLUDED.managed_by,updated_at=now()
           WHERE tenant_retention_policies.managed_by=EXCLUDED.managed_by
             AND (tenant_retention_policies.retention_days,tenant_retention_policies.legal_hold,tenant_retention_policies.managed_by)
                 IS DISTINCT FROM (EXCLUDED.retention_days,EXCLUDED.legal_hold,EXCLUDED.managed_by)`,
          [tenantId, policy.dataClass, policy.retentionDays, policy.legalHold, manifest.clientKey],
        );
      }
      await client.query(
        `DELETE FROM tenant_retention_policies
          WHERE tenant_id=$1 AND managed_by=$2 AND NOT (data_class=ANY($3::text[]))`,
        [tenantId, manifest.clientKey, manifest.retentionPolicies.map((policy) => policy.dataClass)],
      );
    }
    if (manifest.durableLimits !== undefined) {
      for (const limit of manifest.durableLimits) {
        await client.query(
          `INSERT INTO tenant_rate_limit_policies(tenant_id,provider,action,per_minute,managed_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id,provider,action) DO UPDATE
             SET per_minute=EXCLUDED.per_minute,managed_by=EXCLUDED.managed_by,updated_at=now()
           WHERE tenant_rate_limit_policies.managed_by=EXCLUDED.managed_by
             AND (tenant_rate_limit_policies.per_minute,tenant_rate_limit_policies.managed_by)
                 IS DISTINCT FROM (EXCLUDED.per_minute,EXCLUDED.managed_by)`,
          [tenantId, limit.provider, limit.action, limit.perMinute, manifest.clientKey],
        );
      }
      await client.query(
        `DELETE FROM tenant_rate_limit_policies
          WHERE tenant_id=$1 AND managed_by=$2
            AND NOT ((provider||':'||action)=ANY($3::text[]))`,
        [tenantId, manifest.clientKey, manifest.durableLimits.map((limit) => `${limit.provider}:${limit.action}`)],
      );
    }

    for (const location of manifest.locations) {
      await client.query(
        `INSERT INTO tenant_locations (tenant_id, location_key, name, address, timezone, active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, location_key) DO UPDATE
         SET name = EXCLUDED.name, address = EXCLUDED.address, timezone = EXCLUDED.timezone,
             active = EXCLUDED.active, updated_at = now()
         WHERE (tenant_locations.name, tenant_locations.address, tenant_locations.timezone, tenant_locations.active)
               IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.address, EXCLUDED.timezone, EXCLUDED.active)`,
        [tenantId, location.key, location.name, location.address ?? null, location.timezone ?? null, location.active],
      );
    }
    await client.query(
      `UPDATE tenant_locations SET active = false, updated_at = now()
       WHERE tenant_id = $1 AND active = true AND NOT (location_key = ANY($2::text[]))`,
      [tenantId, manifest.locations.map((location) => location.key)],
    );
  });

  // Policy convergence already owns a tenant transaction and preserves immutable
  // revisions. Keeping it outside the settings transaction preserves Phase 1's safe
  // partial-checkpoint behavior.
  const policies = await seedTenantPolicies(tenantId, { overrides: manifest.policyOverrides });
  const reviewPolicy = manifest.policyOverrides.create_review_request?.policy;
  const hasReviewLink = typeof reviewPolicy?.review_link_url === "string" && reviewPolicy.review_link_url.length > 0;
  return {
    policies,
    locations: manifest.locations.length,
    humanOnlyField: hasReviewLink ? null : "create_review_request.review_link_url",
  };
}

/**
 * Converge the additive Company World after users exist. Every write is keyed by
 * the client manifest's natural key and carries `managed_by = clientKey`; rows
 * created by an operator or another source are never claimed or deactivated.
 *
 * The table-existence guard keeps old development databases and old manifests
 * readable during the migration rollout. A manifest that actually asks for
 * Company World data fails clearly when the Phase 0 migration is absent.
 */
export async function convergeCompanyWorld(
  manifest: ClientManifest,
  tenantId: string,
  provisionedUsers: readonly ProvisionedManifestUser[] = [],
  pool: pg.Pool = getPool(),
): Promise<CompanyWorldConvergenceResult> {
  return withClientMutation(manifest, pool, async (client) => {
    const empty: CompanyWorldConvergenceResult = {
      orgUnits: 0,
      memberships: 0,
      relationships: 0,
      aliases: 0,
      externalOrganizations: 0,
      externalContacts: 0,
      userLocations: 0,
    };
    const tenant = await client.query("SELECT id FROM tenants WHERE id = $1 AND client_key = $2", [tenantId, manifest.clientKey]);
    if (!tenant.rows[0]) throw new Error(`Tenant ${tenantId} does not match client ${manifest.clientKey}`);

    const tablesAvailable = await companyWorldTablesAvailable(client);
    if (!tablesAvailable) {
      if (companyWorldManifestHasReferences(manifest)) {
        throw new Error("Company World provisioning requires the Phase 0 database migration");
      }
      return empty;
    }

    const managedTables = [
      "org_units", "org_unit_memberships", "employee_relationships",
      "party_aliases", "external_organizations", "external_contacts",
    ];
    const managedColumns = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.columns
       WHERE table_schema='finnor_os' AND column_name='managed_by'
         AND table_name = ANY($1::text[])`,
      [managedTables],
    );
    if (managedColumns.rows[0]?.count !== managedTables.length) {
      throw new Error("Company World migration is incomplete: manifest ownership columns are missing");
    }

    // A pre-P0 manifest has no Company World intent. Preserve every existing
    // manifest-managed row until a later manifest explicitly supplies the
    // corresponding collection (an explicit [] is an intentional clear).
    if (!companyWorldManifestHasReferences(manifest)) return empty;

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const orgUnits = manifest.orgUnits ?? [];
    const externalOrganizations = manifest.externalOrganizations ?? [];
    const externalContacts = manifest.externalContacts ?? [];
    const aliases = manifest.aliases ?? [];
    const relationships = manifest.employeeRelationships ?? [];
    const memberships = manifest.orgUnitMemberships ?? [];
    const hasOrgUnitIntent = manifest.orgUnits !== undefined;
    const hasExternalOrganizationIntent = manifest.externalOrganizations !== undefined;
    const hasExternalContactIntent = manifest.externalContacts !== undefined;
    const hasAliasIntent = manifest.aliases !== undefined;
    const hasRelationshipIntent = manifest.employeeRelationships !== undefined;
    const hasGlobalMembershipIntent = manifest.orgUnitMemberships !== undefined;
    const hasMembershipIntent = hasGlobalMembershipIntent
      || manifest.users.some((user) => user.orgUnitKeys !== undefined);

    const userEmails = manifest.users.map((user) => user.email);
    const userRows = userEmails.length === 0
      ? []
      : (await client.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE tenant_id=$1 AND email=ANY($2::text[])",
        [tenantId, userEmails],
      )).rows;
    const userIds = new Map(userRows.map((row) => [row.email.toLowerCase(), row.id]));
    for (const user of manifest.users) {
      if (!userIds.has(user.email)) throw new Error(`Manifest user ${user.email} was not provisioned in tenant ${tenantId}`);
    }
    // Keep the function's call contract honest even when a caller supplies a
    // subset of user results: the database lookup above is the tenant authority.
    for (const user of provisionedUsers) {
      if (userIds.get(user.email.toLowerCase()) !== user.id) {
        throw new Error(`Provisioned user ${user.email} does not belong to tenant ${tenantId}`);
      }
    }

    const locationRows = (await client.query<{ id: string; location_key: string }>(
      "SELECT id, location_key FROM tenant_locations WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    const locationIds = new Map(locationRows.map((row) => [row.location_key, row.id]));
    const requestedLocationKeys = [
      ...manifest.locations.map((location) => location.key),
      ...manifest.users.flatMap((user) => [
        ...(user.locationKey ? [user.locationKey] : []),
      ]),
      ...orgUnits.flatMap((unit) => unit.locationKey ? [unit.locationKey] : []),
      ...aliases.filter((alias) => alias.partyType === "location").map((alias) => alias.partyKey),
    ];
    for (const key of new Set(requestedLocationKeys)) {
      if (!locationIds.has(key)) throw new Error(`Manifest location reference ${key} was not found in tenant ${tenantId}`);
    }

    const orgUnitKeys = orgUnits.map((unit) => unit.key);
    const existingOrgUnits = (await client.query<{ id: string; unit_key: string; managed_by: string | null }>(
      "SELECT id, unit_key, managed_by FROM org_units WHERE tenant_id=$1 AND unit_key=ANY($2::text[])",
      [tenantId, orgUnitKeys],
    )).rows;
    if (hasOrgUnitIntent) {
      ensureManifestOwned(existingOrgUnits.map((row) => ({ natural_key: row.unit_key, managed_by: row.managed_by })), manifest.clientKey, "org unit");
    }

    for (const unit of orgUnits) {
      await client.query(
        `INSERT INTO org_units
           (tenant_id, unit_key, name, kind, description, location_id, active, managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, unit_key) DO UPDATE
         SET name=EXCLUDED.name, kind=EXCLUDED.kind, description=EXCLUDED.description,
             location_id=EXCLUDED.location_id, active=EXCLUDED.active,
             managed_by=EXCLUDED.managed_by, updated_at=now()
         WHERE org_units.managed_by=EXCLUDED.managed_by
           AND (org_units.name, org_units.kind, org_units.description, org_units.location_id,
                org_units.active, org_units.managed_by)
             IS DISTINCT FROM
               (EXCLUDED.name, EXCLUDED.kind, EXCLUDED.description, EXCLUDED.location_id,
                EXCLUDED.active, EXCLUDED.managed_by)`,
        [tenantId, unit.key, unit.name, unit.kind ?? "team", unit.description ?? null, unit.locationKey ? locationIds.get(unit.locationKey) : null, unit.active, manifest.clientKey],
      );
    }
    if (hasOrgUnitIntent) {
      await client.query(
        `UPDATE org_units SET active=false, updated_at=now()
         WHERE tenant_id=$1 AND managed_by=$2
           AND NOT (unit_key=ANY($3::text[])) AND active=true`,
        [tenantId, manifest.clientKey, orgUnitKeys],
      );
    }
    const persistedOrgUnits = (await client.query<{ id: string; unit_key: string }>(
      "SELECT id, unit_key FROM org_units WHERE tenant_id=$1 AND unit_key=ANY($2::text[])",
      [tenantId, orgUnitKeys],
    )).rows;
    const orgUnitIds = new Map(persistedOrgUnits.map((row) => [row.unit_key, row.id]));
    for (const unit of orgUnits) {
      if (!orgUnitIds.has(unit.key)) throw new Error(`Org unit ${unit.key} did not converge`);
    }

    const organizationKeys = externalOrganizations.map((organization) => organization.key);
    const existingOrganizations = (await client.query<{ id: string; organization_key: string; managed_by: string | null }>(
      "SELECT id, organization_key, managed_by FROM external_organizations WHERE tenant_id=$1 AND organization_key=ANY($2::text[])",
      [tenantId, organizationKeys],
    )).rows;
    if (hasExternalOrganizationIntent) {
      ensureManifestOwned(existingOrganizations.map((row) => ({ natural_key: row.organization_key, managed_by: row.managed_by })), manifest.clientKey, "external organization");
    }
    for (const organization of externalOrganizations) {
      await client.query(
        `INSERT INTO external_organizations
           (tenant_id, organization_key, name, kind, business_email, business_phone, active, managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, organization_key) DO UPDATE
         SET name=EXCLUDED.name, kind=EXCLUDED.kind, business_email=EXCLUDED.business_email,
             business_phone=EXCLUDED.business_phone, active=EXCLUDED.active,
             managed_by=EXCLUDED.managed_by, updated_at=now()
         WHERE external_organizations.managed_by=EXCLUDED.managed_by
           AND (external_organizations.name, external_organizations.kind,
                external_organizations.business_email, external_organizations.business_phone,
                external_organizations.active, external_organizations.managed_by)
             IS DISTINCT FROM
               (EXCLUDED.name, EXCLUDED.kind, EXCLUDED.business_email,
                EXCLUDED.business_phone, EXCLUDED.active, EXCLUDED.managed_by)`,
        [tenantId, organization.key, organization.name, organization.kind ?? "other", organization.businessEmail ?? null, organization.businessPhone ?? null, organization.active, manifest.clientKey],
      );
    }
    if (hasExternalOrganizationIntent) {
      await client.query(
        `UPDATE external_organizations SET active=false, updated_at=now()
         WHERE tenant_id=$1 AND managed_by=$2
           AND NOT (organization_key=ANY($3::text[])) AND active=true`,
        [tenantId, manifest.clientKey, organizationKeys],
      );
    }
    const persistedOrganizations = (await client.query<{ id: string; organization_key: string }>(
      "SELECT id, organization_key FROM external_organizations WHERE tenant_id=$1 AND organization_key=ANY($2::text[])",
      [tenantId, organizationKeys],
    )).rows;
    const organizationIds = new Map(persistedOrganizations.map((row) => [row.organization_key, row.id]));

    const contactKeys = externalContacts.map((contact) => contact.key);
    const existingContacts = (await client.query<{ id: string; contact_key: string; managed_by: string | null }>(
      "SELECT id, contact_key, managed_by FROM external_contacts WHERE tenant_id=$1 AND contact_key=ANY($2::text[])",
      [tenantId, contactKeys],
    )).rows;
    if (hasExternalContactIntent) {
      ensureManifestOwned(existingContacts.map((row) => ({ natural_key: row.contact_key, managed_by: row.managed_by })), manifest.clientKey, "external contact");
    }
    for (const contact of externalContacts) {
      const organizationId = contact.externalOrganizationKey ? organizationIds.get(contact.externalOrganizationKey) : null;
      if (contact.externalOrganizationKey && !organizationId) throw new Error(`External contact ${contact.key} references undeclared organization ${contact.externalOrganizationKey}`);
      await client.query(
        `INSERT INTO external_contacts
           (tenant_id, contact_key, external_organization_id, name, title, business_email, business_phone, active, managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, contact_key) DO UPDATE
         SET external_organization_id=EXCLUDED.external_organization_id, name=EXCLUDED.name,
             title=EXCLUDED.title, business_email=EXCLUDED.business_email,
             business_phone=EXCLUDED.business_phone, active=EXCLUDED.active,
             managed_by=EXCLUDED.managed_by, updated_at=now()
         WHERE external_contacts.managed_by=EXCLUDED.managed_by
           AND (external_contacts.external_organization_id, external_contacts.name,
                external_contacts.title, external_contacts.business_email,
                external_contacts.business_phone, external_contacts.active,
                external_contacts.managed_by)
             IS DISTINCT FROM
               (EXCLUDED.external_organization_id, EXCLUDED.name, EXCLUDED.title,
                EXCLUDED.business_email, EXCLUDED.business_phone, EXCLUDED.active,
                EXCLUDED.managed_by)`,
        [tenantId, contact.key, organizationId, contact.name, contact.title ?? null, contact.businessEmail ?? null, contact.businessPhone ?? null, contact.active, manifest.clientKey],
      );
    }
    if (hasExternalContactIntent) {
      await client.query(
        `UPDATE external_contacts SET active=false, updated_at=now()
         WHERE tenant_id=$1 AND managed_by=$2
           AND NOT (contact_key=ANY($3::text[])) AND active=true`,
        [tenantId, manifest.clientKey, contactKeys],
      );
    }
    const persistedContacts = (await client.query<{ id: string; contact_key: string }>(
      "SELECT id, contact_key FROM external_contacts WHERE tenant_id=$1 AND contact_key=ANY($2::text[])",
      [tenantId, contactKeys],
    )).rows;
    const contactIds = new Map(persistedContacts.map((row) => [row.contact_key, row.id]));

    const desiredMemberships = new Map<string, {
      userEmail: string;
      orgUnitKey: string;
      membershipRole: string | null;
      isPrimary: boolean;
      active: boolean;
    }>();
    for (const membership of memberships) {
      desiredMemberships.set(`${membership.orgUnitKey}:${membership.employeeEmail}`, {
        userEmail: membership.employeeEmail,
        orgUnitKey: membership.orgUnitKey,
        membershipRole: membership.membershipRole ?? null,
        isPrimary: membership.isPrimary,
        active: membership.active,
      });
    }
    for (const user of manifest.users) {
      if (user.orgUnitKeys === undefined) continue;
      for (const orgUnitKey of user.orgUnitKeys) {
        const key = `${orgUnitKey}:${user.email}`;
        if (!desiredMemberships.has(key)) {
          desiredMemberships.set(key, {
            userEmail: user.email,
            orgUnitKey,
            membershipRole: null,
            isPrimary: false,
            active: true,
          });
        }
      }
    }
    if (hasMembershipIntent) {
      const desiredMembershipKeys = new Set([...desiredMemberships.values()].map((membership) => `${orgUnitIds.get(membership.orgUnitKey)}:${userIds.get(membership.userEmail)}`));
      const userScopedMembershipIntentIds = new Set(
        manifest.users
          .filter((user) => user.orgUnitKeys !== undefined)
          .map((user) => userIds.get(user.email))
          .filter((id): id is string => Boolean(id)),
      );
      const allMembershipRows = (await client.query<{ id: string; org_unit_id: string; employee_id: string; managed_by: string | null }>(
        "SELECT id, org_unit_id, employee_id, managed_by FROM org_unit_memberships WHERE tenant_id=$1",
        [tenantId],
      )).rows;
      for (const row of allMembershipRows) {
        const key = `${row.org_unit_id}:${row.employee_id}`;
        if (desiredMembershipKeys.has(key) && row.managed_by !== manifest.clientKey) {
          throw new Error(`Membership ${key} is owned by another source; refusing to mutate it`);
        }
      }
      for (const membership of desiredMemberships.values()) {
        const orgUnitId = orgUnitIds.get(membership.orgUnitKey);
        const employeeId = userIds.get(membership.userEmail);
        if (!orgUnitId || !employeeId) throw new Error(`Membership ${membership.orgUnitKey}:${membership.userEmail} has an unresolved reference`);
        await client.query(
          `INSERT INTO org_unit_memberships
             (tenant_id, org_unit_id, employee_id, membership_role, is_primary, active, managed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, org_unit_id, employee_id) DO UPDATE
           SET membership_role=EXCLUDED.membership_role, is_primary=EXCLUDED.is_primary,
               active=EXCLUDED.active, managed_by=EXCLUDED.managed_by, updated_at=now()
           WHERE org_unit_memberships.managed_by=EXCLUDED.managed_by
             AND (org_unit_memberships.membership_role, org_unit_memberships.is_primary,
                  org_unit_memberships.active, org_unit_memberships.managed_by)
               IS DISTINCT FROM
                 (EXCLUDED.membership_role, EXCLUDED.is_primary, EXCLUDED.active, EXCLUDED.managed_by)`,
          [tenantId, orgUnitId, employeeId, membership.membershipRole, membership.isPrimary, membership.active, manifest.clientKey],
        );
      }
      const persistedMemberships = (await client.query<{ id: string; org_unit_id: string; employee_id: string }>(
        "SELECT id, org_unit_id, employee_id FROM org_unit_memberships WHERE tenant_id=$1 AND managed_by=$2",
        [tenantId, manifest.clientKey],
      )).rows;
      for (const row of persistedMemberships) {
        const rowIsInDeclaredScope = hasGlobalMembershipIntent || userScopedMembershipIntentIds.has(row.employee_id);
        if (rowIsInDeclaredScope && !desiredMembershipKeys.has(`${row.org_unit_id}:${row.employee_id}`)) {
          await client.query("UPDATE org_unit_memberships SET active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND managed_by=$3 AND active=true", [row.id, tenantId, manifest.clientKey]);
        }
      }
    }

    const desiredRelationships = new Map<string, { subjectEmployeeId: string; relatedEmployeeId: string; relationshipType: "manager" | "backup" | "assistant"; active: boolean }>();
    for (const relationship of relationships) {
      const subject = userIds.get(relationship.subjectEmployeeEmail);
      const related = userIds.get(relationship.relatedEmployeeEmail);
      if (!subject || !related) throw new Error(`Relationship ${relationship.subjectEmployeeEmail}:${relationship.relatedEmployeeEmail} has an unresolved employee reference`);
      desiredRelationships.set(`${subject}:${relationship.relationshipType}:${related}`, {
        subjectEmployeeId: subject, relatedEmployeeId: related, relationshipType: relationship.relationshipType, active: relationship.active,
      });
    }
    const existingRelationships = (await client.query<{ id: string; subject_employee_id: string; related_employee_id: string; relationship_type: string; managed_by: string | null }>(
      "SELECT id, subject_employee_id, related_employee_id, relationship_type, managed_by FROM employee_relationships WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    const desiredRelationshipKeys = new Set(desiredRelationships.keys());
    if (hasRelationshipIntent) {
      for (const row of existingRelationships) {
        const key = `${row.subject_employee_id}:${row.relationship_type}:${row.related_employee_id}`;
        if (desiredRelationshipKeys.has(key) && row.managed_by !== manifest.clientKey) {
          throw new Error(`Employee relationship ${key} is owned by another source; refusing to mutate it`);
        }
      }
      for (const relationship of desiredRelationships.values()) {
        await client.query(
          `INSERT INTO employee_relationships
             (tenant_id, subject_employee_id, related_employee_id, relationship_type, active, managed_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, subject_employee_id, relationship_type, related_employee_id) DO UPDATE
           SET active=EXCLUDED.active, managed_by=EXCLUDED.managed_by, updated_at=now()
           WHERE employee_relationships.managed_by=EXCLUDED.managed_by
             AND (employee_relationships.active, employee_relationships.managed_by)
               IS DISTINCT FROM (EXCLUDED.active, EXCLUDED.managed_by)`,
          [tenantId, relationship.subjectEmployeeId, relationship.relatedEmployeeId, relationship.relationshipType, relationship.active, manifest.clientKey],
        );
      }
      const persistedRelationships = (await client.query<{ id: string; subject_employee_id: string; related_employee_id: string; relationship_type: string }>(
        "SELECT id, subject_employee_id, related_employee_id, relationship_type FROM employee_relationships WHERE tenant_id=$1 AND managed_by=$2",
        [tenantId, manifest.clientKey],
      )).rows;
      for (const row of persistedRelationships) {
        if (!desiredRelationshipKeys.has(`${row.subject_employee_id}:${row.relationship_type}:${row.related_employee_id}`)) {
          await client.query("UPDATE employee_relationships SET active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND managed_by=$3 AND active=true", [row.id, tenantId, manifest.clientKey]);
        }
      }
    }

    const desiredAliases = new Map<string, { partyType: string; partyId: string; alias: string; active: boolean }>();
    for (const alias of aliases) {
      const partyId = alias.partyType === "employee"
        ? userIds.get(alias.partyKey)
        : alias.partyType === "team"
          ? orgUnitIds.get(alias.partyKey)
          : alias.partyType === "location"
            ? locationIds.get(alias.partyKey)
            : alias.partyType === "external_organization"
              ? organizationIds.get(alias.partyKey)
              : contactIds.get(alias.partyKey);
      if (!partyId) throw new Error(`Alias ${alias.key} has an unresolved ${alias.partyType} reference ${alias.partyKey}`);
      desiredAliases.set(alias.key, {
        partyType: alias.partyType,
        partyId,
        alias: alias.alias,
        active: alias.active,
      });
    }
    if (hasAliasIntent) {
      const aliasKeys = [...desiredAliases.keys()];
      const existingAliases = (await client.query<{ alias_key: string; managed_by: string | null }>(
        "SELECT alias_key, managed_by FROM party_aliases WHERE tenant_id=$1 AND alias_key=ANY($2::text[])",
        [tenantId, aliasKeys],
      )).rows;
      ensureManifestOwned(existingAliases.map((row) => ({ natural_key: row.alias_key, managed_by: row.managed_by })), manifest.clientKey, "party alias");
      for (const [aliasKey, alias] of desiredAliases) {
        await client.query(
          `INSERT INTO party_aliases
             (tenant_id, alias_key, party_type, party_id, alias, normalized_alias, active, managed_by)
           VALUES ($1,$2,$3,$4,$5,finnor_os.normalize_party_text($5),$6,$7)
           ON CONFLICT (tenant_id, alias_key) DO UPDATE
           SET party_type=EXCLUDED.party_type, party_id=EXCLUDED.party_id,
               alias=EXCLUDED.alias, normalized_alias=EXCLUDED.normalized_alias,
               active=EXCLUDED.active, managed_by=EXCLUDED.managed_by, updated_at=now()
           WHERE party_aliases.managed_by=EXCLUDED.managed_by
             AND (party_aliases.party_type, party_aliases.party_id, party_aliases.alias,
                  party_aliases.normalized_alias, party_aliases.active, party_aliases.managed_by)
               IS DISTINCT FROM
                 (EXCLUDED.party_type, EXCLUDED.party_id, EXCLUDED.alias,
                  EXCLUDED.normalized_alias, EXCLUDED.active, EXCLUDED.managed_by)`,
          [tenantId, aliasKey, alias.partyType, alias.partyId, alias.alias, alias.active, manifest.clientKey],
        );
      }
      const persistedAliases = (await client.query<{ id: string; alias_key: string }>(
        "SELECT id, alias_key FROM party_aliases WHERE tenant_id=$1 AND managed_by=$2",
        [tenantId, manifest.clientKey],
      )).rows;
      for (const row of persistedAliases) {
        if (!desiredAliases.has(row.alias_key)) {
          await client.query("UPDATE party_aliases SET active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND managed_by=$3 AND active=true", [row.id, tenantId, manifest.clientKey]);
        }
      }
    }

    let userLocations = 0;
    for (const user of manifest.users) {
      const hasLocationIntent = user.locationKey !== undefined;
      if (!hasLocationIntent) continue;
      const requested = user.locationKey;
      const primaryLocationId = requested ? locationIds.get(requested) ?? null : null;
      const result = await client.query(
        `UPDATE users SET primary_location_id=$1
         WHERE tenant_id=$2 AND email=$3
           AND primary_location_id IS DISTINCT FROM $1`,
        [primaryLocationId, tenantId, user.email],
      );
      userLocations += result.rowCount ?? 0;
    }

    return {
      orgUnits: hasOrgUnitIntent ? orgUnits.length : 0,
      memberships: desiredMemberships.size,
      relationships: hasRelationshipIntent ? desiredRelationships.size : 0,
      aliases: hasAliasIntent ? desiredAliases.size : 0,
      externalOrganizations: hasExternalOrganizationIntent ? externalOrganizations.length : 0,
      externalContacts: hasExternalContactIntent ? externalContacts.length : 0,
      userLocations,
    };
  });
}

type ManifestPrincipal =
  | { type: "employee"; employeeEmail: string }
  | { type: "team"; orgUnitKey: string }
  | { type: "location"; locationKey: string }
  | { type: "tenant" };

function legacyAccessKey(capability: string, binding: string): string {
  return `legacy-${capability}-${binding}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64);
}

function substitutedCredential(
  credential: { provider: "aws-secrets-manager" | "os-keychain" | "legacy-env"; ref: string; version?: string } | undefined,
  tenantId: string,
): { provider: "aws-secrets-manager" | "os-keychain" | "legacy-env" | null; ref: string | null; version: string | null } {
  return credential
    ? { provider: credential.provider, ref: credential.ref.replaceAll("{tenantId}", tenantId), version: credential.version ?? null }
    : { provider: null, ref: null, version: null };
}

const LEGACY_PUBLIC_ROUTING_KEYS = [
  "address", "fromAddress", "user", "phoneNumberId", "locationId",
  "adapter", "accountId", "realmId", "customerId",
] as const;

/** Older manifests kept non-secret provider routing in `integration.config` before
 * `credential.metadata` existed. Copy only the bounded public fields required to
 * preserve the selected sender/account; never project the arbitrary config object. */
function legacyPublicRoutingMetadata(
  config: Record<string, unknown>,
  credentialMetadata: Record<string, unknown> = {},
): Record<(typeof LEGACY_PUBLIC_ROUTING_KEYS)[number], string | undefined> {
  return Object.fromEntries(LEGACY_PUBLIC_ROUTING_KEYS.map((key) => {
    const preferred = credentialMetadata[key];
    const fallback = config[key];
    const value = typeof preferred === "string" && preferred.trim()
      ? preferred.trim()
      : typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
    return [key, value];
  })) as Record<(typeof LEGACY_PUBLIC_ROUTING_KEYS)[number], string | undefined>;
}

/** Converge governed identities/accounts after canonical users, locations, and Company
 * World exist. Secret values never enter this path: only opaque references are stored.
 * Old manifests synthesize explicit tenant/shared rows from their live integration
 * declarations, preserving the existing deployment model without process-global
 * sender guessing. */
export async function convergeIdentityAccess(
  manifest: ClientManifest,
  tenantId: string,
  pool: pg.Pool = getPool(),
): Promise<IdentityAccessConvergenceResult> {
  return withClientMutation(manifest, pool, async (client) => {
    const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 AND client_key=$2", [tenantId, manifest.clientKey]);
    if (!tenant.rows[0]) throw new Error(`Tenant ${tenantId} does not match client ${manifest.clientKey}`);
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const compatibilityMode = manifest.communicationIdentities === undefined
      && manifest.communicationIdentityBindings === undefined
      && manifest.applicationAccounts === undefined
      && manifest.authProfiles === undefined;

    const communicationIdentities = compatibilityMode
      ? manifest.integrations.flatMap((integration) => {
          if (integration.mode === "emulator" || !["gmail", "resend", "vapi", "ghl"].includes(integration.binding)) return [];
          const routing = legacyPublicRoutingMetadata(integration.config, integration.credential?.metadata);
          const address = routing.fromAddress ?? routing.address ?? routing.user ?? null;
          const providerIdentityRef = routing.phoneNumberId ?? routing.locationId ?? `integration:${integration.capability}`;
          return [{
            key: legacyAccessKey(integration.capability, integration.binding),
            provider: integration.binding,
            channel: integration.binding === "vapi" ? "voice" as const
              : integration.binding === "ghl" && integration.capability === "scheduling" ? "calendar" as const
                : integration.binding === "ghl" ? "sms" as const : "email" as const,
            address,
            providerIdentityRef,
            status: "active" as const,
            capabilities: [integration.capability],
            credential: integration.credential,
            authProfileRef: undefined,
          }];
        })
      : manifest.communicationIdentities ?? [];
    const communicationBindings = compatibilityMode
      ? communicationIdentities.map((identity) => ({
          identityKey: identity.key,
          principal: { type: "tenant" as const },
          purpose: "default",
          priority: 0,
          status: "active" as const,
        }))
      : manifest.communicationIdentityBindings ?? [];

    const applicationAccounts = compatibilityMode
      ? manifest.integrations.flatMap((integration) => {
          if (integration.mode === "emulator" || ["native", "emulator", "dry_run"].includes(integration.binding)) return [];
          const routing = legacyPublicRoutingMetadata(integration.config, integration.credential?.metadata);
          const adapter = integration.binding === "ads" && routing.adapter ? routing.adapter : integration.binding;
          const providerAccountRef = routing.accountId ?? routing.realmId ?? routing.customerId ?? null;
          return [{
            key: legacyAccessKey(integration.capability, integration.binding),
            application: adapter,
            provider: adapter,
            displayName: `${integration.binding.replaceAll("_", " ")} shared account`,
            providerAccountRef,
            status: "active" as const,
            capabilities: [integration.capability],
            // Legacy tenant integration config remains in its existing private
            // record. Do not project an arbitrary historical object into the new
            // planner-visible account metadata surface; older deployments may
            // predate the secret-shaped-key guard.
            metadata: {},
          }];
        })
      : manifest.applicationAccounts ?? [];
    const authProfiles = compatibilityMode
      ? applicationAccounts.map((account) => {
          const integration = manifest.integrations.find((candidate) => legacyAccessKey(candidate.capability, candidate.binding) === account.key)!;
          return {
            ref: account.key,
            principal: { type: "tenant" as const },
            applicationAccountKey: account.key,
            purpose: "default",
            priority: 0,
            scope: {},
            credential: integration.credential,
            authMethod: "managed_secret" as const,
            connectionRequired: true,
            requiredScopes: [] as string[],
            status: "active" as const,
            capabilities: [integration.capability],
            restrictions: {},
          };
        })
      : manifest.authProfiles ?? [];

    const [employees, teams, locations] = await Promise.all([
      client.query<{ id: string; email: string }>("SELECT id,email FROM users WHERE tenant_id=$1", [tenantId]),
      client.query<{ id: string; unit_key: string }>("SELECT id,unit_key FROM org_units WHERE tenant_id=$1", [tenantId]),
      client.query<{ id: string; location_key: string }>("SELECT id,location_key FROM tenant_locations WHERE tenant_id=$1", [tenantId]),
    ]);
    const employeeIds = new Map(employees.rows.map((row) => [row.email.toLowerCase(), row.id]));
    const teamIds = new Map(teams.rows.map((row) => [row.unit_key, row.id]));
    const locationIds = new Map(locations.rows.map((row) => [row.location_key, row.id]));
    const resolvePrincipal = (principal: ManifestPrincipal): { type: ManifestPrincipal["type"]; id: string } => {
      const id = principal.type === "employee" ? employeeIds.get(principal.employeeEmail.toLowerCase())
        : principal.type === "team" ? teamIds.get(principal.orgUnitKey)
          : principal.type === "location" ? locationIds.get(principal.locationKey)
            : tenantId;
      if (!id) throw new Error(`Identity principal ${JSON.stringify(principal)} has not been provisioned yet; rerun after identity/location convergence`);
      return { type: principal.type, id };
    };

    const identityKeys = communicationIdentities.map((identity) => identity.key);
    if (compatibilityMode) {
      await client.query(
        "UPDATE communication_identities SET managed_by=$2 WHERE tenant_id=$1 AND managed_by IS NULL AND identity_key=ANY($3::text[])",
        [tenantId, manifest.clientKey, identityKeys],
      );
    }
    const existingIdentityKeys = (await client.query<{ identity_key: string; managed_by: string | null }>(
      "SELECT identity_key,managed_by FROM communication_identities WHERE tenant_id=$1 AND identity_key=ANY($2::text[])",
      [tenantId, identityKeys],
    )).rows;
    ensureManifestOwned(existingIdentityKeys.map((row) => ({ natural_key: row.identity_key, managed_by: row.managed_by })), manifest.clientKey, "communication identity");
    for (const identity of communicationIdentities) {
      const credential = substitutedCredential(identity.credential, tenantId);
      await client.query(
        `INSERT INTO communication_identities
           (tenant_id,identity_key,provider,channel,address,provider_identity_ref,status,capabilities,
            credential_provider,credential_ref,credential_version,managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
         ON CONFLICT (tenant_id,identity_key) DO UPDATE
         SET provider=EXCLUDED.provider,channel=EXCLUDED.channel,address=EXCLUDED.address,
             provider_identity_ref=EXCLUDED.provider_identity_ref,status=EXCLUDED.status,
             capabilities=EXCLUDED.capabilities,credential_provider=EXCLUDED.credential_provider,
             credential_ref=EXCLUDED.credential_ref,credential_version=EXCLUDED.credential_version,
             managed_by=EXCLUDED.managed_by,updated_at=now()
         WHERE communication_identities.managed_by=EXCLUDED.managed_by
           AND (communication_identities.provider,communication_identities.channel,communication_identities.address,
                communication_identities.provider_identity_ref,communication_identities.status,communication_identities.capabilities,
                communication_identities.credential_provider,communication_identities.credential_ref,
                communication_identities.credential_version,communication_identities.managed_by)
             IS DISTINCT FROM
               (EXCLUDED.provider,EXCLUDED.channel,EXCLUDED.address,EXCLUDED.provider_identity_ref,
                EXCLUDED.status,EXCLUDED.capabilities,EXCLUDED.credential_provider,EXCLUDED.credential_ref,
                EXCLUDED.credential_version,EXCLUDED.managed_by)`,
        [tenantId, identity.key, identity.provider, identity.channel, identity.address ?? null,
          identity.providerIdentityRef ?? null, identity.status, JSON.stringify(identity.capabilities),
          credential.provider, credential.ref, credential.version, manifest.clientKey],
      );
    }
    const persistedIdentities = (await client.query<{ id: string; identity_key: string }>(
      "SELECT id,identity_key FROM communication_identities WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    const identityIds = new Map(persistedIdentities.map((row) => [row.identity_key, row.id]));

    const accountKeys = applicationAccounts.map((account) => account.key);
    if (compatibilityMode) {
      await client.query(
        "UPDATE application_accounts SET managed_by=$2 WHERE tenant_id=$1 AND managed_by IS NULL AND account_key=ANY($3::text[])",
        [tenantId, manifest.clientKey, accountKeys],
      );
    }
    const existingAccountKeys = (await client.query<{ account_key: string; managed_by: string | null }>(
      "SELECT account_key,managed_by FROM application_accounts WHERE tenant_id=$1 AND account_key=ANY($2::text[])",
      [tenantId, accountKeys],
    )).rows;
    ensureManifestOwned(existingAccountKeys.map((row) => ({ natural_key: row.account_key, managed_by: row.managed_by })), manifest.clientKey, "application account");
    for (const account of applicationAccounts) {
      await client.query(
        `INSERT INTO application_accounts
           (tenant_id,account_key,application,provider,display_name,provider_account_ref,status,capabilities,metadata,managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
         ON CONFLICT (tenant_id,account_key) DO UPDATE
         SET application=EXCLUDED.application,provider=EXCLUDED.provider,display_name=EXCLUDED.display_name,
             provider_account_ref=EXCLUDED.provider_account_ref,status=EXCLUDED.status,
             capabilities=EXCLUDED.capabilities,metadata=EXCLUDED.metadata,managed_by=EXCLUDED.managed_by,updated_at=now()
         WHERE application_accounts.managed_by=EXCLUDED.managed_by
           AND (application_accounts.application,application_accounts.provider,application_accounts.display_name,
                application_accounts.provider_account_ref,application_accounts.status,application_accounts.capabilities,
                application_accounts.metadata,application_accounts.managed_by)
             IS DISTINCT FROM
               (EXCLUDED.application,EXCLUDED.provider,EXCLUDED.display_name,EXCLUDED.provider_account_ref,
                EXCLUDED.status,EXCLUDED.capabilities,EXCLUDED.metadata,EXCLUDED.managed_by)`,
        [tenantId, account.key, account.application, account.provider, account.displayName,
          account.providerAccountRef ?? null, account.status, JSON.stringify(account.capabilities),
          JSON.stringify(account.metadata), manifest.clientKey],
      );
    }
    const persistedAccounts = (await client.query<{ id: string; account_key: string; provider: string }>(
      "SELECT id,account_key,provider FROM application_accounts WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    const accountIds = new Map(persistedAccounts.map((row) => [row.account_key, row.id]));
    const accountProviders = new Map(persistedAccounts.map((row) => [row.account_key, row.provider]));

    const desiredBindingKeys = new Set<string>();
    const resolvedBindings = communicationBindings.map((binding) => {
      const identityId = identityIds.get(binding.identityKey);
      if (!identityId) throw new Error(`Communication binding references unprovisioned identity ${binding.identityKey}`);
      const principal = resolvePrincipal(binding.principal);
      const key = `${identityId}:${principal.type}:${principal.id}:${binding.purpose}`;
      desiredBindingKeys.add(key);
      return { ...binding, identityId, principal, key };
    });
    if (compatibilityMode) {
      await client.query(
        `UPDATE communication_identity_bindings b SET managed_by=$2
         FROM communication_identities i
         WHERE b.tenant_id=$1 AND b.managed_by IS NULL
           AND i.tenant_id=b.tenant_id AND i.id=b.communication_identity_id AND i.managed_by=$2`,
        [tenantId, manifest.clientKey],
      );
    }
    const allBindings = (await client.query<{ id: string; communication_identity_id: string; principal_type: ManifestPrincipal["type"]; principal_id: string; purpose: string; managed_by: string | null }>(
      "SELECT id,communication_identity_id,principal_type,principal_id,purpose,managed_by FROM communication_identity_bindings WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    for (const row of allBindings) {
      const key = `${row.communication_identity_id}:${row.principal_type}:${row.principal_id}:${row.purpose}`;
      if (desiredBindingKeys.has(key) && row.managed_by !== manifest.clientKey) throw new Error(`Communication identity binding ${key} is owned by another source; refusing to mutate it`);
    }
    for (const binding of resolvedBindings) {
      await client.query(
        `INSERT INTO communication_identity_bindings
           (tenant_id,communication_identity_id,principal_type,principal_id,purpose,priority,status,managed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id,communication_identity_id,principal_type,principal_id,purpose) DO UPDATE
         SET priority=EXCLUDED.priority,status=EXCLUDED.status,managed_by=EXCLUDED.managed_by,updated_at=now()
         WHERE communication_identity_bindings.managed_by=EXCLUDED.managed_by
           AND (communication_identity_bindings.priority,communication_identity_bindings.status,communication_identity_bindings.managed_by)
             IS DISTINCT FROM (EXCLUDED.priority,EXCLUDED.status,EXCLUDED.managed_by)`,
        [tenantId, binding.identityId, binding.principal.type, binding.principal.id,
          binding.purpose, binding.priority, binding.status, manifest.clientKey],
      );
    }

    const desiredProfileRefs = new Set(authProfiles.map((profile) => profile.ref));
    const desiredProfileBindingKeys = new Set<string>();
    const resolvedProfiles = authProfiles.map((profile) => {
      const applicationAccountId = accountIds.get(profile.applicationAccountKey);
      if (!applicationAccountId) throw new Error(`Auth profile references unprovisioned application account ${profile.applicationAccountKey}`);
      const principal = resolvePrincipal(profile.principal);
      const bindingKey = `${applicationAccountId}:${principal.type}:${principal.id}:${profile.purpose}`;
      desiredProfileBindingKeys.add(bindingKey);
      return { ...profile, applicationAccountId, principal, bindingKey };
    });
    if (compatibilityMode) {
      await client.query(
        `UPDATE auth_profiles p SET managed_by=$2
         FROM application_accounts a
         WHERE p.tenant_id=$1 AND p.managed_by IS NULL
           AND a.tenant_id=p.tenant_id AND a.id=p.application_account_id AND a.managed_by=$2`,
        [tenantId, manifest.clientKey],
      );
    }
    const allProfiles = (await client.query<{ id: string; auth_profile_ref: string; application_account_id: string; principal_type: ManifestPrincipal["type"]; principal_id: string; purpose: string; managed_by: string | null }>(
      "SELECT id,auth_profile_ref,application_account_id,principal_type,principal_id,purpose,managed_by FROM auth_profiles WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    for (const row of allProfiles) {
      const bindingKey = `${row.application_account_id}:${row.principal_type}:${row.principal_id}:${row.purpose}`;
      if ((desiredProfileRefs.has(row.auth_profile_ref) || desiredProfileBindingKeys.has(bindingKey)) && row.managed_by !== manifest.clientKey) {
        throw new Error(`Auth profile ${row.auth_profile_ref} is owned by another source; refusing to mutate it`);
      }
    }
    for (const profile of resolvedProfiles) {
      const credential = substitutedCredential(profile.credential, tenantId);
      const authMethod = profile.authMethod ?? "managed_secret";
      const connectionRequired = profile.connectionRequired ?? true;
      const requiredScopes = profile.requiredScopes ?? [];
      const initialConnectionStatus = profile.status !== "active"
        ? "disabled"
        : credential.provider || compatibilityMode || authMethod === "managed_secret" ? "active" : "disconnected";
      await client.query(
        `INSERT INTO auth_profiles
           (tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,priority,scope,
            credential_provider,credential_ref,credential_version,status,auth_method,connection_required,
            connection_status,required_scopes,capabilities,restrictions,managed_by,connected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::text[],$17::jsonb,$18::jsonb,$19,
                 CASE WHEN $15='active' THEN now() ELSE NULL END)
         ON CONFLICT (tenant_id,auth_profile_ref) DO UPDATE
         SET principal_type=EXCLUDED.principal_type,principal_id=EXCLUDED.principal_id,
             application_account_id=EXCLUDED.application_account_id,purpose=EXCLUDED.purpose,
             priority=EXCLUDED.priority,scope=EXCLUDED.scope,
             credential_provider=CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_provider IS NULL THEN auth_profiles.credential_provider ELSE EXCLUDED.credential_provider END,
             credential_ref=CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_ref IS NULL THEN auth_profiles.credential_ref ELSE EXCLUDED.credential_ref END,
             credential_version=CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_ref IS NULL THEN auth_profiles.credential_version ELSE EXCLUDED.credential_version END,
             status=EXCLUDED.status,auth_method=EXCLUDED.auth_method,connection_required=EXCLUDED.connection_required,
             connection_status=CASE
               WHEN EXCLUDED.status<>'active' THEN 'disabled'
               WHEN auth_profiles.auth_method<>EXCLUDED.auth_method THEN EXCLUDED.connection_status
               WHEN NOT (EXCLUDED.required_scopes <@ auth_profiles.granted_scopes) AND auth_profiles.connection_status='active' THEN 'reauth_required'
               WHEN EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_provider IS NULL THEN auth_profiles.connection_status
               ELSE EXCLUDED.connection_status END,
             required_scopes=EXCLUDED.required_scopes,
             capabilities=EXCLUDED.capabilities,restrictions=EXCLUDED.restrictions,
             managed_by=EXCLUDED.managed_by,updated_at=now()
         WHERE auth_profiles.managed_by=EXCLUDED.managed_by
           AND (auth_profiles.principal_type,auth_profiles.principal_id,auth_profiles.application_account_id,
                auth_profiles.purpose,auth_profiles.priority,auth_profiles.scope,auth_profiles.status,
                auth_profiles.auth_method,auth_profiles.connection_required,auth_profiles.required_scopes,
                auth_profiles.capabilities,auth_profiles.restrictions,auth_profiles.managed_by,
                auth_profiles.credential_provider,auth_profiles.credential_ref,auth_profiles.credential_version)
             IS DISTINCT FROM
               (EXCLUDED.principal_type,EXCLUDED.principal_id,EXCLUDED.application_account_id,
                EXCLUDED.purpose,EXCLUDED.priority,EXCLUDED.scope,EXCLUDED.status,
                EXCLUDED.auth_method,EXCLUDED.connection_required,EXCLUDED.required_scopes,
                EXCLUDED.capabilities,EXCLUDED.restrictions,EXCLUDED.managed_by,
                CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_provider IS NULL THEN auth_profiles.credential_provider ELSE EXCLUDED.credential_provider END,
                CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_ref IS NULL THEN auth_profiles.credential_ref ELSE EXCLUDED.credential_ref END,
                CASE WHEN auth_profiles.auth_method=EXCLUDED.auth_method AND EXCLUDED.auth_method IN ('oauth2','browser_profile') AND EXCLUDED.credential_ref IS NULL THEN auth_profiles.credential_version ELSE EXCLUDED.credential_version END)`,
        [tenantId, profile.ref, profile.principal.type, profile.principal.id, profile.applicationAccountId,
          profile.purpose, profile.priority, JSON.stringify(profile.scope), credential.provider, credential.ref,
          credential.version, profile.status, authMethod, connectionRequired, initialConnectionStatus, requiredScopes,
          JSON.stringify(profile.capabilities), JSON.stringify(profile.restrictions), manifest.clientKey],
      );
    }

    const persistedProfiles = (await client.query<{ id: string; auth_profile_ref: string; application_account_id: string }>(
      "SELECT id,auth_profile_ref,application_account_id FROM auth_profiles WHERE tenant_id=$1",
      [tenantId],
    )).rows;
    const profileIds = new Map(persistedProfiles.map((row) => [row.auth_profile_ref, row.id]));
    const profileAccountIds = new Map(persistedProfiles.map((row) => [row.auth_profile_ref, row.application_account_id]));
    for (const identity of communicationIdentities) {
      const linkedProfileId = identity.authProfileRef ? profileIds.get(identity.authProfileRef) : null;
      if (identity.authProfileRef && !linkedProfileId) throw new Error(`Communication identity references unprovisioned auth profile ${identity.authProfileRef}`);
      await client.query(
        `UPDATE communication_identities SET auth_profile_id=$4,updated_at=now()
          WHERE tenant_id=$1 AND identity_key=$2 AND managed_by=$3
            AND auth_profile_id IS DISTINCT FROM $4`,
        [tenantId, identity.key, manifest.clientKey, linkedProfileId],
      );
    }

    // Bind each provider capability to one exact tenant account/profile. Legacy
    // manifests converge to the same synthesized keys; native capabilities remain
    // intentionally unbound. This runs only after identity convergence so a first
    // provision never guesses or stores an unresolved cross-tenant identifier.
    for (const integration of manifest.integrations) {
      const legacyKey = compatibilityMode && integration.mode !== "emulator"
        && !["native", "emulator", "dry_run"].includes(integration.binding)
        ? legacyAccessKey(integration.capability, integration.binding)
        : undefined;
      const accountKey = integration.applicationAccountKey ?? legacyKey;
      const profileRef = integration.authProfileRef ?? legacyKey;
      const applicationAccountId = accountKey ? accountIds.get(accountKey) : undefined;
      const authProfileId = profileRef ? profileIds.get(profileRef) : undefined;
      if (integration.applicationAccountKey && !applicationAccountId) {
        throw new Error(`Integration ${integration.capability} references unprovisioned application account ${integration.applicationAccountKey}`);
      }
      if (integration.authProfileRef && !authProfileId) {
        throw new Error(`Integration ${integration.capability} references unprovisioned auth profile ${integration.authProfileRef}`);
      }
      const accountProvider = accountKey ? accountProviders.get(accountKey) : undefined;
      const providerMatches = accountProvider === integration.binding
        || (integration.binding === "ads" && ["meta_ads", "google_ads"].includes(accountProvider ?? ""));
      if (accountKey && applicationAccountId && !providerMatches) {
        throw new Error(`Integration ${integration.capability} provider does not match application account ${accountKey}`);
      }
      if (applicationAccountId && profileRef && authProfileId && profileAccountIds.get(profileRef) !== applicationAccountId) {
        throw new Error(`Integration ${integration.capability} auth profile ${profileRef} belongs to a different application account`);
      }
      await client.query(
        `UPDATE tenant_integrations
         SET application_account_id=$3,auth_profile_id=$4,updated_at=now()
         WHERE tenant_id=$1 AND capability=$2
           AND (application_account_id,auth_profile_id) IS DISTINCT FROM ($3::uuid,$4::uuid)`,
        [tenantId, integration.capability, applicationAccountId ?? null, authProfileId ?? null],
      );
    }

    if (compatibilityMode || manifest.communicationIdentityBindings !== undefined) {
      for (const row of allBindings) {
        const key = `${row.communication_identity_id}:${row.principal_type}:${row.principal_id}:${row.purpose}`;
        if (row.managed_by === manifest.clientKey && !desiredBindingKeys.has(key)) {
          await client.query("UPDATE communication_identity_bindings SET status='disabled',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND managed_by=$3 AND status<>'disabled'", [row.id, tenantId, manifest.clientKey]);
        }
      }
    }
    if (compatibilityMode || manifest.authProfiles !== undefined) {
      for (const row of allProfiles) {
        if (row.managed_by === manifest.clientKey && !desiredProfileRefs.has(row.auth_profile_ref)) {
          await client.query("UPDATE auth_profiles SET status='disabled',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND managed_by=$3 AND status<>'disabled'", [row.id, tenantId, manifest.clientKey]);
        }
      }
    }
    if (compatibilityMode || manifest.communicationIdentities !== undefined) {
      await client.query(
        "UPDATE communication_identities SET status='disabled',updated_at=now() WHERE tenant_id=$1 AND managed_by=$2 AND NOT (identity_key=ANY($3::text[])) AND status<>'disabled'",
        [tenantId, manifest.clientKey, identityKeys],
      );
    }
    if (compatibilityMode || manifest.applicationAccounts !== undefined) {
      await client.query(
        "UPDATE application_accounts SET status='disabled',updated_at=now() WHERE tenant_id=$1 AND managed_by=$2 AND NOT (account_key=ANY($3::text[])) AND status<>'disabled'",
        [tenantId, manifest.clientKey, accountKeys],
      );
    }

    return {
      communicationIdentities: communicationIdentities.length,
      communicationIdentityBindings: communicationBindings.length,
      applicationAccounts: applicationAccounts.length,
      authProfiles: authProfiles.length,
      compatibilityMode,
    };
  });
}

/** Converge integration bindings and credential references; resolved secrets never enter this path. */
export async function convergeIntegrations(
  manifest: ClientManifest,
  tenantId: string,
  pool: pg.Pool = getPool(),
): Promise<{ integrations: number }> {
  await withClientMutation(manifest, pool, async (client) => {
    const tenant = await client.query("SELECT id FROM tenants WHERE id = $1 AND client_key = $2", [tenantId, manifest.clientKey]);
    if (!tenant.rows[0]) throw new Error(`Tenant ${tenantId} does not match client ${manifest.clientKey}`);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const integration of manifest.integrations) {
      await client.query(
        `INSERT INTO tenant_integrations
           (tenant_id, capability, binding, mode, config, credential_provider, credential_ref, credential_version, credential_metadata,
            source_policy,freshness_policy,sync_scopes,outcome_packs)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb,$10::jsonb,$11::jsonb,$12::text[],$13::text[])
         ON CONFLICT (tenant_id, capability) DO UPDATE
         SET binding = EXCLUDED.binding, mode = EXCLUDED.mode, config = EXCLUDED.config,
             credential_provider = EXCLUDED.credential_provider,
             credential_ref = EXCLUDED.credential_ref,
             credential_version = EXCLUDED.credential_version,
             credential_metadata = EXCLUDED.credential_metadata,
             source_policy = EXCLUDED.source_policy,
             freshness_policy = EXCLUDED.freshness_policy,
             sync_scopes = EXCLUDED.sync_scopes,
             outcome_packs = EXCLUDED.outcome_packs,
             updated_at = now()
         WHERE (tenant_integrations.binding, tenant_integrations.mode, tenant_integrations.config,
                tenant_integrations.credential_provider, tenant_integrations.credential_ref,
                tenant_integrations.credential_version, tenant_integrations.credential_metadata,
                tenant_integrations.source_policy,tenant_integrations.freshness_policy,
                tenant_integrations.sync_scopes,tenant_integrations.outcome_packs)
               IS DISTINCT FROM
               (EXCLUDED.binding, EXCLUDED.mode, EXCLUDED.config, EXCLUDED.credential_provider,
                EXCLUDED.credential_ref, EXCLUDED.credential_version, EXCLUDED.credential_metadata,
                EXCLUDED.source_policy,EXCLUDED.freshness_policy,EXCLUDED.sync_scopes,EXCLUDED.outcome_packs)`,
        [tenantId, integration.capability, integration.binding, integration.mode, JSON.stringify(integration.config),
          integration.credential?.provider ?? null, integration.credential?.ref.replaceAll("{tenantId}", tenantId) ?? null,
          integration.credential?.version ?? null, JSON.stringify(integration.credential?.metadata ?? {}),
          JSON.stringify(integration.sourcePolicy ?? {}),JSON.stringify(integration.freshnessPolicy ?? {}),
          integration.syncScopes,integration.outcomePacks],
      );
    }
    await client.query(
      "DELETE FROM tenant_integrations WHERE tenant_id = $1 AND NOT (capability = ANY($2::text[]))",
      [tenantId, manifest.integrations.map((integration) => integration.capability)],
    );
  });
  return { integrations: manifest.integrations.length };
}

export async function bootstrapTenant(manifest: ClientManifest, pool: pg.Pool = getPool()): Promise<BootstrapTenantResult> {
  const tenantId = await ensureTenantRecord(manifest, pool);
  const workspace = await convergeWorkspaceAndPolicies(manifest, tenantId, pool);
  const integrations = await convergeIntegrations(manifest, tenantId, pool);
  return { tenantId, clientKey: manifest.clientKey, ...workspace, ...integrations };
}
