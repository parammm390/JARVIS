// Phase 1.6: action_log (the audit trail) and business_events (the events timeline)
// must be append-only at the database level — see migrations/0014_audit_immutability.sql.
// Uses the non-superuser finnor_app role (migration 0001, local/CI only) so the
// REVOKE is genuinely exercised, same pattern as tenant-isolation.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { closePool } from "@finnor/db";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: SUPER_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("audit tables are append-only at the DB level (Phase 1.6)", () => {
  beforeAll(async () => {
    await migrate(SUPER_URL);
    await seed(SUPER_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("finnor_app cannot UPDATE or DELETE action_log rows", async () => {
    const superClient = new pg.Client({ connectionString: SUPER_URL });
    await superClient.connect();
    await superClient.query("SET search_path = finnor_os, public");
    await superClient.query("BEGIN");
    await superClient.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);
    const {
      rows: [action],
    } = await superClient.query(
      `INSERT INTO domain_actions (tenant_id, action_type, payload, status)
       VALUES ($1, 'test_audit_immutability', '{}', 'draft') RETURNING id`,
      [SEED_TENANT_ID],
    );
    const {
      rows: [log],
    } = await superClient.query(
      `INSERT INTO action_log (domain_action_id, tenant_id, step, input, output)
       VALUES ($1, $2, 'test-step', '{}', '{}') RETURNING id`,
      [action.id, SEED_TENANT_ID],
    );
    await superClient.query("COMMIT");
    await superClient.end();

    const appClient = new pg.Client({ connectionString: APP_URL });
    await appClient.connect();
    await appClient.query("SET search_path = finnor_os, public");
    await appClient.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);
    await expect(appClient.query(`UPDATE action_log SET step = 'tampered' WHERE id = $1`, [log.id])).rejects.toThrow(/permission denied/i);
    await expect(appClient.query(`DELETE FROM action_log WHERE id = $1`, [log.id])).rejects.toThrow(/permission denied/i);
    await appClient.end();
  });

  it("finnor_app cannot UPDATE or DELETE business_events rows", async () => {
    const superClient = new pg.Client({ connectionString: SUPER_URL });
    await superClient.connect();
    await superClient.query("SET search_path = finnor_os, public");
    await superClient.query("BEGIN");
    await superClient.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);
    const {
      rows: [event],
    } = await superClient.query(
      `INSERT INTO business_events (tenant_id, entity_type, entity_id, event_type, payload, source)
       VALUES ($1, 'test_entity', gen_random_uuid(), 'test_event', '{}', 'test') RETURNING id`,
      [SEED_TENANT_ID],
    );
    await superClient.query("COMMIT");
    await superClient.end();

    const appClient = new pg.Client({ connectionString: APP_URL });
    await appClient.connect();
    await appClient.query("SET search_path = finnor_os, public");
    await appClient.query("SELECT set_config('app.tenant_id', $1, true)", [SEED_TENANT_ID]);
    await expect(appClient.query(`UPDATE business_events SET event_type = 'tampered' WHERE id = $1`, [event.id])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(appClient.query(`DELETE FROM business_events WHERE id = $1`, [event.id])).rejects.toThrow(/permission denied/i);
    await appClient.end();
  });
});
