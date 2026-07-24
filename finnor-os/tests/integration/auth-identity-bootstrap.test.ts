import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closePool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_OWNER_EMAIL, SEED_TENANT_ID } from "../../packages/db/seed";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function databaseAvailable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: SUPER_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await databaseAvailable();

describe.skipIf(!available)("A5 authenticated identity bootstrap", () => {
  beforeAll(async () => {
    await migrate(SUPER_URL);
    await seed(SUPER_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("lets the restricted role resolve only the verified identity before a tenant GUC exists", async () => {
    const client = new pg.Client({ connectionString: APP_URL });
    await client.connect();
    await client.query("SET search_path = finnor_os, public");
    const direct = await client.query("SELECT id FROM users WHERE email = $1", [SEED_OWNER_EMAIL]);
    expect(direct.rows).toHaveLength(0);
    const bootstrap = await client.query(
      "SELECT user_id, tenant_id, user_role FROM resolve_authenticated_identity($1)",
      [SEED_OWNER_EMAIL],
    );
    expect(bootstrap.rows).toEqual([{ user_id: expect.any(String), tenant_id: SEED_TENANT_ID, user_role: "owner" }]);
    await client.end();
  });
});
