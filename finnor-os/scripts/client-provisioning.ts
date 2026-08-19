import type pg from "pg";
import { getPool } from "@finnor/db";
import type { ClientManifest } from "./client-manifest";
import { bootstrapTenant } from "./tenant-bootstrap";
import { CrossTenantUserError, ensureTenantUser, normalizeEmail, type TenantAuthAdmin } from "./tenant-user";

async function preflightUserAssignments(manifest: ClientManifest, pool: pg.Pool): Promise<void> {
  if (manifest.users.length === 0) return;
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function provisionClient(
  manifest: ClientManifest,
  dependencies: { auth: TenantAuthAdmin; pool?: pg.Pool },
) {
  const pool = dependencies.pool ?? getPool();
  // Check every user before mutating tenant/config rows, so a known cross-tenant
  // identity conflict cannot leave a half-configured client behind.
  await preflightUserAssignments(manifest, pool);
  const bootstrap = await bootstrapTenant(manifest);
  const users = [];
  for (const user of manifest.users) {
    users.push(await ensureTenantUser({ tenantId: bootstrap.tenantId, ...user }, { auth: dependencies.auth, pool }));
  }
  return { ...bootstrap, users };
}
