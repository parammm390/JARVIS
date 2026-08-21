import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { MIGRATIONS } from "../../packages/db/migrations-bundle";

const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: SOURCE_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

function databaseUrl(name: string): string {
  const url = new URL(SOURCE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

describe.skipIf(!available)("Phase 1 legacy integration upgrade", () => {
  const database = `finnor_p1_upgrade_${randomUUID().replaceAll("-", "_")}`;
  const target = databaseUrl(database);
  const tenantId = randomUUID();
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: SOURCE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.end();

    const prePhase1 = MIGRATIONS.filter(({ name }) => name < "0085_phase1_identity_access_fabric.sql");
    await migrate(target, prePhase1);
    client = new pg.Client({ connectionString: target });
    await client.connect();
    await client.query(
      "INSERT INTO finnor_os.tenants(id,client_key,name) VALUES ($1,$2,'Legacy Upgrade')",
      [tenantId, `legacy-${tenantId.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO finnor_os.tenant_integrations
         (tenant_id,capability,binding,mode,config)
       VALUES
         ($1,'communications','vapi','real','{"phoneNumberId":"config-phone"}'::jsonb),
         ($1,'accounting','quickbooks','real','{"realmId":"config-realm"}'::jsonb),
         ($1,'marketing','ads','real','{"adapter":"meta_ads","accountId":"config-ad-account"}'::jsonb)`,
      [tenantId],
    );
    await migrate(target, MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    const admin = new pg.Client({ connectionString: SOURCE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it("backfills canonical sender and account references from safe legacy config", async () => {
    const result = await client.query(
      `SELECT
         (SELECT provider_identity_ref FROM finnor_os.communication_identities
          WHERE tenant_id=$1 AND identity_key='legacy-communications-vapi') phone_ref,
         (SELECT provider_account_ref FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-accounting-quickbooks') realm_ref,
         (SELECT provider FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-marketing-ads') ads_provider,
         (SELECT provider_account_ref FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-marketing-ads') ads_account_ref`,
      [tenantId],
    );
    expect(result.rows[0]).toEqual({
      phone_ref: "config-phone",
      realm_ref: "config-realm",
      ads_provider: "meta_ads",
      ads_account_ref: "config-ad-account",
    });
    expect((await client.query(
      "SELECT count(*)::int count FROM finnor_os._migrations WHERE name='0085_phase1_identity_access_fabric.sql'",
    )).rows[0].count).toBe(1);
  });
});
