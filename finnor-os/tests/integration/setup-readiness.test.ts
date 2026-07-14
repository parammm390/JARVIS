// Dealer Setup Readiness: scanActionTypeReadiness against the real seed DB should
// produce an accurate unconfigured/configured/gated_by_choice split — this is the
// underlying logic GET /api/setup/status serves.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainPolicies } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { scanActionTypeReadiness } from "../../packages/domain-plugins/shared/setup-readiness";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("dealer setup readiness — real DB scan", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("splits action types into unconfigured / configured / gated_by_choice", async () => {
    // "clean" gets a fully real, ungated policy row.
    await withTenant(SEED_TENANT_ID, (db) =>
      db.insert(domainPolicies).values({
        tenantId: SEED_TENANT_ID,
        actionType: "__test_clean_action__",
        policy: { some_real_field: 42 },
        requiresConfirmation: false,
      }),
    );
    // "gated" gets a fully real policy row but the dealer chose to keep confirmation on.
    await withTenant(SEED_TENANT_ID, (db) =>
      db.insert(domainPolicies).values({
        tenantId: SEED_TENANT_ID,
        actionType: "__test_gated_action__",
        policy: { some_real_field: 42 },
        requiresConfirmation: true,
      }),
    );
    // "placeholder" has a row but it still contains an unfilled placeholder.
    await withTenant(SEED_TENANT_ID, (db) =>
      db.insert(domainPolicies).values({
        tenantId: SEED_TENANT_ID,
        actionType: "__test_placeholder_action__",
        policy: { price: "PLACEHOLDER_NEEDS_REAL_VALUE" },
        requiresConfirmation: true,
      }),
    );
    // "missing" has no row at all.

    const results = await scanActionTypeReadiness(SEED_TENANT_ID, [
      { actionType: "__test_clean_action__", pluginName: "test" },
      { actionType: "__test_gated_action__", pluginName: "test" },
      { actionType: "__test_placeholder_action__", pluginName: "test" },
      { actionType: "__test_missing_action__", pluginName: "test" },
    ]);

    const byType = new Map(results.map((r) => [r.actionType, r]));
    expect(byType.get("__test_clean_action__")!.status).toBe("configured");
    expect(byType.get("__test_gated_action__")!.status).toBe("gated_by_choice");
    expect(byType.get("__test_placeholder_action__")!.status).toBe("unconfigured");
    expect(byType.get("__test_placeholder_action__")!.placeholderFields).toContain("price");
    expect(byType.get("__test_missing_action__")!.status).toBe("unconfigured");
    expect(byType.get("__test_missing_action__")!.hasPolicyRow).toBe(false);

    await withTenant(SEED_TENANT_ID, (db) =>
      db
        .delete(domainPolicies)
        .where(
          and(
            eq(domainPolicies.tenantId, SEED_TENANT_ID),
            eq(domainPolicies.actionType, "__test_clean_action__"),
          ),
        ),
    );
    await withTenant(SEED_TENANT_ID, (db) =>
      db
        .delete(domainPolicies)
        .where(
          and(
            eq(domainPolicies.tenantId, SEED_TENANT_ID),
            eq(domainPolicies.actionType, "__test_gated_action__"),
          ),
        ),
    );
    await withTenant(SEED_TENANT_ID, (db) =>
      db
        .delete(domainPolicies)
        .where(
          and(
            eq(domainPolicies.tenantId, SEED_TENANT_ID),
            eq(domainPolicies.actionType, "__test_placeholder_action__"),
          ),
        ),
    );
  });
});
