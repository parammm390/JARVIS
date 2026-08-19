import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closePool, households, tenants, withTenant } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { findHousehold } from "../../packages/domain-plugins/shared/db-helpers";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-0000000004a1";
const TENANT_B = "00000000-0000-4000-8000-0000000004b1";
const HOUSEHOLD_A = "00000000-0000-4000-8000-0000000004a2";
const HOUSEHOLD_B = "00000000-0000-4000-8000-0000000004b2";
const SHARED_PHONE = "+13195550421";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

describe.skipIf(!available)("native plugin lookup tenant scope", () => {
  beforeAll(async () => {
    await migrate(DB_URL);
    await withTenant(TENANT_A, async (db) => {
      await db.insert(tenants).values([{ id: TENANT_A, name: "Lookup tenant A" }, { id: TENANT_B, name: "Lookup tenant B" }]).onConflictDoNothing();
      await db.insert(households).values([
        { id: HOUSEHOLD_A, tenantId: TENANT_A, address: "421 Tenant A Way", contactInfo: { name: "Shared Customer", phone: SHARED_PHONE } },
        { id: HOUSEHOLD_B, tenantId: TENANT_B, address: "421 Tenant B Way", contactInfo: { name: "Shared Customer", phone: SHARED_PHONE } },
      ]).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("never resolves another tenant's duplicate phone, name, address, or id on a privileged connection", async () => {
    await expect(findHousehold(TENANT_A, { phone: SHARED_PHONE })).resolves.toMatchObject({ id: HOUSEHOLD_A });
    await expect(findHousehold(TENANT_B, { name: "Shared Customer" })).resolves.toMatchObject({ id: HOUSEHOLD_B });
    await expect(findHousehold(TENANT_A, { address: "Tenant A Way" })).resolves.toMatchObject({ id: HOUSEHOLD_A });
    await expect(findHousehold(TENANT_A, { householdId: HOUSEHOLD_B })).resolves.toBeNull();
  });
});
