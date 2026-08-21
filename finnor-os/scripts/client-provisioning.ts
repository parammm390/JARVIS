import type pg from "pg";
import { getPool } from "@finnor/db";
import type { ClientManifest } from "./client-manifest";
import { bootstrapTenant, convergeCompanyWorld, convergeIdentityAccess } from "./tenant-bootstrap";
import { CrossTenantUserError, ensureTenantUser, normalizeEmail, type TenantAuthAdmin } from "./tenant-user";

function companyWorldManifestHasReferences(manifest: ClientManifest): boolean {
  return manifest.orgUnits !== undefined
    || manifest.orgUnitMemberships !== undefined
    || manifest.employeeRelationships !== undefined
    || manifest.aliases !== undefined
    || manifest.externalOrganizations !== undefined
    || manifest.externalContacts !== undefined
    || manifest.users.some((user) => user.orgUnitKeys !== undefined || user.locationKey !== undefined);
}

async function assertManifestOwned(
  client: pg.PoolClient,
  query: string,
  values: unknown[],
  clientKey: string,
  kind: string,
): Promise<void> {
  const result = await client.query<{ natural_key: string; managed_by: string | null }>(query, values);
  const conflict = result.rows.find((row) => row.managed_by !== clientKey);
  if (conflict) throw new Error(`${kind} key ${conflict.natural_key} is owned by another source; refusing to mutate it`);
}

export async function preflightUserAssignments(manifest: ClientManifest, pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = finnor_os, public");
    // Provisioning requires the migration/admin connection. On a restricted RLS
    // role this setting makes the query fail instead of silently hiding a conflict.
    await client.query("SET LOCAL row_security = off");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`client:${manifest.clientKey}`]);
    const tenantResult = await client.query<{ id: string }>("SELECT id FROM tenants WHERE client_key = $1", [manifest.clientKey]);
    const expectedTenantId = tenantResult.rows[0]?.id ?? null;
    for (const user of manifest.users) {
      const email = normalizeEmail(user.email);
      const result = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE email = $1", [email]);
      const existingTenantId = result.rows[0]?.tenant_id;
      if (existingTenantId && existingTenantId !== expectedTenantId) {
        throw new CrossTenantUserError(email, existingTenantId, expectedTenantId ?? `new client ${manifest.clientKey}`);
      }
    }

    if (companyWorldManifestHasReferences(manifest)) {
      const tables = await client.query<{ present: boolean }>(
        `SELECT to_regclass('finnor_os.org_units') IS NOT NULL
           AND to_regclass('finnor_os.org_unit_memberships') IS NOT NULL
           AND to_regclass('finnor_os.employee_relationships') IS NOT NULL
           AND to_regclass('finnor_os.party_aliases') IS NOT NULL
           AND to_regclass('finnor_os.external_organizations') IS NOT NULL
           AND to_regclass('finnor_os.external_contacts') IS NOT NULL AS present`,
      );
      if (!tables.rows[0]?.present) throw new Error("Company World provisioning requires the Phase 0 database migration");
      const managedColumns = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM information_schema.columns
         WHERE table_schema='finnor_os' AND column_name='managed_by'
           AND table_name = ANY($1::text[])`,
        [["org_units", "org_unit_memberships", "employee_relationships", "party_aliases", "external_organizations", "external_contacts"]],
      );
      if (managedColumns.rows[0]?.count !== 6) throw new Error("Company World migration is incomplete: manifest ownership columns are missing");

      // A new client has no existing canonical rows to conflict with. The manifest
      // parser already proved all internal references, so defer row resolution until
      // after the stable tenant and users exist.
      if (expectedTenantId) {
        // Location/team/external keys are resolved against the desired manifest
        // first and may be newly created by the following workspace/company-world
        // checkpoints. Existing rows are checked for ownership below; absence is
        // not an error here.

        const orgKeys = (manifest.orgUnits ?? []).map((unit) => unit.key);
        if (orgKeys.length > 0) {
          await assertManifestOwned(client,
            "SELECT unit_key AS natural_key, managed_by FROM org_units WHERE tenant_id=$1 AND unit_key=ANY($2::text[])",
            [expectedTenantId, orgKeys], manifest.clientKey, "org unit");
        }
        const organizationKeys = (manifest.externalOrganizations ?? []).map((organization) => organization.key);
        if (organizationKeys.length > 0) {
          await assertManifestOwned(client,
            "SELECT organization_key AS natural_key, managed_by FROM external_organizations WHERE tenant_id=$1 AND organization_key=ANY($2::text[])",
            [expectedTenantId, organizationKeys], manifest.clientKey, "external organization");
        }
        const contactKeys = (manifest.externalContacts ?? []).map((contact) => contact.key);
        if (contactKeys.length > 0) {
          await assertManifestOwned(client,
            "SELECT contact_key AS natural_key, managed_by FROM external_contacts WHERE tenant_id=$1 AND contact_key=ANY($2::text[])",
            [expectedTenantId, contactKeys], manifest.clientKey, "external contact");
        }

        const membershipPairs = new Map<string, { orgUnitKey: string; userEmail: string }>();
        for (const membership of manifest.orgUnitMemberships ?? []) {
          membershipPairs.set(`${membership.orgUnitKey}:${membership.employeeEmail}`, { orgUnitKey: membership.orgUnitKey, userEmail: membership.employeeEmail });
        }
        for (const user of manifest.users) {
          for (const orgUnitKey of user.orgUnitKeys ?? []) {
            membershipPairs.set(`${orgUnitKey}:${user.email}`, { orgUnitKey, userEmail: user.email });
          }
        }
        for (const pair of membershipPairs.values()) {
          const existing = await client.query<{ managed_by: string | null }>(
            `SELECT m.managed_by
             FROM org_unit_memberships m
             JOIN org_units o ON o.tenant_id=m.tenant_id AND o.id=m.org_unit_id
             JOIN users u ON u.tenant_id=m.tenant_id AND u.id=m.employee_id
             WHERE m.tenant_id=$1 AND o.unit_key=$2 AND u.email=$3`,
            [expectedTenantId, pair.orgUnitKey, pair.userEmail],
          );
          if (existing.rows.some((row) => row.managed_by !== manifest.clientKey)) {
            throw new Error(`Membership ${pair.orgUnitKey}:${pair.userEmail} is owned by another source; refusing to mutate it`);
          }
        }

        for (const relationship of manifest.employeeRelationships ?? []) {
          const subject = relationship.subjectEmployeeEmail;
          const related = relationship.relatedEmployeeEmail;
          const relationshipType = relationship.relationshipType;
          const existing = await client.query<{ managed_by: string | null }>(
            `SELECT r.managed_by
             FROM employee_relationships r
             JOIN users subject_user ON subject_user.tenant_id=r.tenant_id AND subject_user.id=r.subject_employee_id
             JOIN users related_user ON related_user.tenant_id=r.tenant_id AND related_user.id=r.related_employee_id
             WHERE r.tenant_id=$1 AND subject_user.email=$2 AND related_user.email=$3 AND r.relationship_type=$4`,
            [expectedTenantId, subject, related, relationshipType],
          );
          if (existing.rows.some((row) => row.managed_by !== manifest.clientKey)) {
            throw new Error(`Relationship ${relationship.subjectEmployeeEmail}:${relationship.relatedEmployeeEmail} is owned by another source; refusing to mutate it`);
          }
        }

        for (const alias of manifest.aliases ?? []) {
          const existing = await client.query<{ managed_by: string | null }>(
            "SELECT managed_by FROM party_aliases WHERE tenant_id=$1 AND alias_key=$2",
            [expectedTenantId, alias.key],
          );
          if (existing.rows.some((row) => row.managed_by !== manifest.clientKey)) {
            throw new Error(`Party alias ${alias.key} is owned by another source; refusing to mutate it`);
          }
        }
      }
    }
    const identityAccessTables = await client.query<{ present: boolean }>(
      `SELECT to_regclass('finnor_os.communication_identities') IS NOT NULL
         AND to_regclass('finnor_os.communication_identity_bindings') IS NOT NULL
         AND to_regclass('finnor_os.application_accounts') IS NOT NULL
         AND to_regclass('finnor_os.auth_profiles') IS NOT NULL AS present`,
    );
    if (!identityAccessTables.rows[0]?.present) throw new Error("Client provisioning requires the Phase 1 identity/access database migration");
    const identityManagedColumns = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.columns
       WHERE table_schema='finnor_os' AND column_name='managed_by'
         AND table_name=ANY($1::text[])`,
      [["communication_identities", "communication_identity_bindings", "application_accounts", "auth_profiles"]],
    );
    if (identityManagedColumns.rows[0]?.count !== 4) throw new Error("Identity/access migration is incomplete: manifest ownership columns are missing");
    if (expectedTenantId) {
      const identityKeys = (manifest.communicationIdentities ?? []).map((identity) => identity.key);
      if (identityKeys.length > 0) {
        await assertManifestOwned(client,
          "SELECT identity_key AS natural_key,managed_by FROM communication_identities WHERE tenant_id=$1 AND identity_key=ANY($2::text[])",
          [expectedTenantId, identityKeys], manifest.clientKey, "communication identity");
      }
      const accountKeys = (manifest.applicationAccounts ?? []).map((account) => account.key);
      if (accountKeys.length > 0) {
        await assertManifestOwned(client,
          "SELECT account_key AS natural_key,managed_by FROM application_accounts WHERE tenant_id=$1 AND account_key=ANY($2::text[])",
          [expectedTenantId, accountKeys], manifest.clientKey, "application account");
      }
      const profileRefs = (manifest.authProfiles ?? []).map((profile) => profile.ref);
      if (profileRefs.length > 0) {
        await assertManifestOwned(client,
          "SELECT auth_profile_ref AS natural_key,managed_by FROM auth_profiles WHERE tenant_id=$1 AND auth_profile_ref=ANY($2::text[])",
          [expectedTenantId, profileRefs], manifest.clientKey, "auth profile");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Converge only application/Auth identities after the stable tenant exists. */
export async function convergeClientUsers(
  manifest: ClientManifest,
  tenantId: string,
  dependencies: { auth: TenantAuthAdmin; pool?: pg.Pool; preflight?: boolean },
) {
  const pool = dependencies.pool ?? getPool();
  if (dependencies.preflight !== false) await preflightUserAssignments(manifest, pool);
  const users = [];
  for (const user of manifest.users) {
    users.push(await ensureTenantUser({ tenantId, ...user }, { auth: dependencies.auth, pool }));
  }
  return users;
}

export async function provisionClient(
  manifest: ClientManifest,
  dependencies: { auth: TenantAuthAdmin; pool?: pg.Pool },
) {
  const pool = dependencies.pool ?? getPool();
  // Check every user before mutating tenant/config rows, so a known cross-tenant
  // identity conflict cannot leave a half-configured client behind.
  await preflightUserAssignments(manifest, pool);
  const bootstrap = await bootstrapTenant(manifest, pool);
  const users = await convergeClientUsers(manifest, bootstrap.tenantId, { ...dependencies, pool, preflight: false });
  const companyWorld = await convergeCompanyWorld(manifest, bootstrap.tenantId, users, pool);
  const identityAccess = await convergeIdentityAccess(manifest, bootstrap.tenantId, pool);
  return { ...bootstrap, users, companyWorld, identityAccess };
}
