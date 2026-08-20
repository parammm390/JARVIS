// Database half of convergent client provisioning. Every manifest-owned row has a
// stable natural key and updates only when its desired configuration differs.
// Supabase Auth creation remains a separate recoverable step in client-provisioning.
import type pg from "pg";
import { getPool } from "@finnor/db";
import { DEFAULT_WORKSPACE_CONFIG } from "../apps/api/lib/workspace-config";
import type { ClientManifest } from "./client-manifest";
import { seedTenantPolicies } from "./seed-tenant-policies";

export interface BootstrapTenantResult {
  tenantId: string;
  clientKey: string;
  policies: Awaited<ReturnType<typeof seedTenantPolicies>>;
  integrations: number;
  locations: number;
  humanOnlyField: string | null;
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
    await client.query(
      `INSERT INTO tenant_settings
         (tenant_id, is_dealer_zero, simulator_enabled, training_mode, workspace_config)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE
       SET is_dealer_zero = EXCLUDED.is_dealer_zero,
           simulator_enabled = EXCLUDED.simulator_enabled,
           training_mode = EXCLUDED.training_mode,
           workspace_config = COALESCE($6::jsonb, tenant_settings.workspace_config),
           updated_at = now()
       WHERE (tenant_settings.is_dealer_zero, tenant_settings.simulator_enabled, tenant_settings.training_mode,
              tenant_settings.workspace_config)
             IS DISTINCT FROM
             (EXCLUDED.is_dealer_zero, EXCLUDED.simulator_enabled, EXCLUDED.training_mode,
              COALESCE($6::jsonb, tenant_settings.workspace_config))`,
      [tenantId, settings.isDealerZero, settings.simulatorEnabled, settings.trainingMode,
        JSON.stringify(desiredWorkspace ?? DEFAULT_WORKSPACE_CONFIG), desiredWorkspace ? JSON.stringify(desiredWorkspace) : null],
    );

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
           (tenant_id, capability, binding, mode, config, credential_provider, credential_ref, credential_version, credential_metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
         ON CONFLICT (tenant_id, capability) DO UPDATE
         SET binding = EXCLUDED.binding, mode = EXCLUDED.mode, config = EXCLUDED.config,
             credential_provider = EXCLUDED.credential_provider,
             credential_ref = EXCLUDED.credential_ref,
             credential_version = EXCLUDED.credential_version,
             credential_metadata = EXCLUDED.credential_metadata,
             updated_at = now()
         WHERE (tenant_integrations.binding, tenant_integrations.mode, tenant_integrations.config,
                tenant_integrations.credential_provider, tenant_integrations.credential_ref,
                tenant_integrations.credential_version, tenant_integrations.credential_metadata)
               IS DISTINCT FROM
               (EXCLUDED.binding, EXCLUDED.mode, EXCLUDED.config, EXCLUDED.credential_provider,
                EXCLUDED.credential_ref, EXCLUDED.credential_version, EXCLUDED.credential_metadata)`,
        [tenantId, integration.capability, integration.binding, integration.mode, JSON.stringify(integration.config),
          integration.credential?.provider ?? null, integration.credential?.ref.replaceAll("{tenantId}", tenantId) ?? null,
          integration.credential?.version ?? null, JSON.stringify(integration.credential?.metadata ?? {})],
      );
    }
    await client.query(
      "DELETE FROM tenant_integrations WHERE tenant_id = $1 AND NOT (capability = ANY($2::text[]))",
      [tenantId, manifest.integrations.map((integration) => integration.capability)],
    );
  });
  return { integrations: manifest.integrations.length };
}

export async function bootstrapTenant(manifest: ClientManifest): Promise<BootstrapTenantResult> {
  const tenantId = await ensureTenantRecord(manifest);
  const workspace = await convergeWorkspaceAndPolicies(manifest, tenantId);
  const integrations = await convergeIntegrations(manifest, tenantId);
  return { tenantId, clientKey: manifest.clientKey, ...workspace, ...integrations };
}
