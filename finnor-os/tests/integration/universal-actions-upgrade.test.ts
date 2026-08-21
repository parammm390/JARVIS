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

describe.skipIf(!available)("Phase 2 universal-action upgrade", () => {
  const database = `finnor_p2_upgrade_${randomUUID().replaceAll("-", "_")}`;
  const target = databaseUrl(database);
  const tenantId = randomUUID();
  const actorId = randomUUID();
  const workId = randomUUID();
  const legacyTaskId = randomUUID();
  const identityId = randomUUID();
  const actionId = randomUUID();
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: SOURCE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.end();

    const prePhase2 = MIGRATIONS.filter(({ name }) => name < "0086_phase2_universal_action_delegation_fabric.sql");
    await migrate(target, prePhase2);
    client = new pg.Client({ connectionString: target });
    await client.connect();
    await client.query("SET search_path = finnor_os, public");
    await client.query("INSERT INTO tenants(id,client_key,name) VALUES ($1,$2,'P2 Legacy Upgrade')", [tenantId, `p2-upgrade-${tenantId.slice(0, 8)}`]);
    await client.query("INSERT INTO tenant_settings(tenant_id) VALUES ($1)", [tenantId]);
    await client.query(
      "INSERT INTO users(id,tenant_id,email,role,display_name,status) VALUES ($1,$2,$3,'owner','Upgrade Owner','active')",
      [actorId, tenantId, `upgrade-${actorId}@example.test`],
    );
    await client.query(
      "INSERT INTO works(id,tenant_id,initial_channel,initial_instruction,created_by) VALUES ($1,$2,'console','Preserve legacy Work',$3)",
      [workId, tenantId, actorId],
    );
    await client.query(
      "INSERT INTO tasks(id,tenant_id,subject_type,subject_id,title,status) VALUES ($1,$2,'work',$3,'Preserve legacy task','open')",
      [legacyTaskId, tenantId, workId],
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

  it("preserves legacy Work/task data and enables tenant-safe sender receipts", async () => {
    const preserved = await client.query(
      "SELECT id,title,work_id,assigned_party_id,source_domain_action_id FROM tasks WHERE id=$1",
      [legacyTaskId],
    );
    expect(preserved.rows[0]).toEqual({
      id: legacyTaskId,
      title: "Preserve legacy task",
      work_id: null,
      assigned_party_id: null,
      source_domain_action_id: null,
    });

    await client.query(
      `INSERT INTO communication_identities
        (id,tenant_id,identity_key,provider,channel,address,status,capabilities)
       VALUES ($1,$2,'upgrade-sms','ghl','sms','+15550001111','active','["send"]')`,
      [identityId, tenantId],
    );
    await client.query(
      `INSERT INTO domain_actions(id,tenant_id,action_type,payload,status,initiated_by,work_id)
       VALUES ($1,$2,'send_message','{}'::jsonb,'executing',$3,$4)`,
      [actionId, tenantId, actorId, workId],
    );
    await client.query(
      `INSERT INTO communication_deliveries
        (tenant_id,domain_action_id,work_id,recipient_type,recipient_id,channel,route,status,provider,communication_identity_id)
       VALUES ($1,$2,$3,'employee',$4,'sms','api','sent','ghl',$5)`,
      [tenantId, actionId, workId, actorId, identityId],
    );
    const receipt = await client.query(
      "SELECT communication_identity_id,status FROM communication_deliveries WHERE domain_action_id=$1",
      [actionId],
    );
    expect(receipt.rows[0]).toEqual({ communication_identity_id: identityId, status: "sent" });
    expect((await client.query(
      "SELECT count(*)::int count FROM _migrations WHERE name='0086_phase2_universal_action_delegation_fabric.sql'",
    )).rows[0].count).toBe(1);
  });

  it("backfills safe defaults and rejects secret-shaped universal configuration", async () => {
    const config = (await client.query("SELECT universal_action_config config FROM tenant_settings WHERE tenant_id=$1", [tenantId])).rows[0].config;
    expect(config).toMatchObject({
      communication: { allowedChannels: ["internal", "email", "sms", "voice"], allowChannelFallback: false },
      scheduling: { externalCalendarMode: "internal_only" },
      documentSharing: { allowExternal: false },
    });
    await expect(client.query(
      `UPDATE tenant_settings SET universal_action_config='{"apiKey":"must-not-persist"}'::jsonb WHERE tenant_id=$1`,
      [tenantId],
    )).rejects.toThrow(/tenant_settings_universal_action_config_no_secrets_check/);
  });
});
