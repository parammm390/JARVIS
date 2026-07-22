// A3.T1 acceptance: tenant_integrations rows override the env/default binding
// resolution for that ONE tenant only, and a tenant with no row falls through
// unchanged. Real Postgres (RLS included), not mocked.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, tenantIntegrations } from "@finnor/db";
import { resolveCapabilityBindings, resolveCapabilityBindingsForTenant } from "@finnor/tools";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-0000000000ea";
const TENANT_B = "00000000-0000-4000-8000-0000000000eb";

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

const noCrmEnv: NodeJS.ProcessEnv = { ...process.env, CRM_BINDING: undefined };
const noCrmNoSchedulingEnv: NodeJS.ProcessEnv = { ...process.env, CRM_BINDING: undefined, SCHEDULING_BINDING: undefined };

describe.skipIf(!available)("tenant_integrations resolution (A3.T1)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_A, (db) => db.insert(tenants).values({ id: TENANT_A, name: "Tenant Integrations Test A" }).onConflictDoNothing());
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Tenant Integrations Test B" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await withTenant(TENANT_A, (db) => db.delete(tenantIntegrations).where(eq(tenantIntegrations.tenantId, TENANT_A)));
    await closePool();
  });

  it("falls through to env/default when the tenant has no override row", async () => {
    const envReport = resolveCapabilityBindings(noCrmEnv);
    const tenantReport = await resolveCapabilityBindingsForTenant(TENANT_A, noCrmEnv);
    expect(tenantReport.crm).toEqual(envReport.crm);
    expect(tenantReport.crm.source).toBe("default");
  });

  it("a tenant_integrations row overrides the resolution for that tenant only, source: tenant", async () => {
    await withTenant(TENANT_A, (db) =>
      db
        .insert(tenantIntegrations)
        .values({ tenantId: TENANT_A, capability: "crm", binding: "ghl", mode: "real" })
        .onConflictDoUpdate({ target: [tenantIntegrations.tenantId, tenantIntegrations.capability], set: { binding: "ghl", mode: "real" } }),
    );

    const reportA = await resolveCapabilityBindingsForTenant(TENANT_A, noCrmEnv);
    expect(reportA.crm).toEqual({ mode: "ghl", source: "tenant" });

    // Tenant B has no row for crm — must be completely unaffected by A's override.
    const reportB = await resolveCapabilityBindingsForTenant(TENANT_B, noCrmEnv);
    expect(reportB.crm.source).toBe("default");
    expect(reportB.crm.mode).toBe("native");
  });

  it("a tenant row only overrides its own capability — the rest still resolve from env/default", async () => {
    const report = await resolveCapabilityBindingsForTenant(TENANT_A, noCrmNoSchedulingEnv);
    expect(report.crm.source).toBe("tenant");
    expect(report.scheduling).toEqual({ mode: "native", source: "default" });
  });
});
