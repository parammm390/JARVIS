import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, households, receiveWork, tenants, withTenant, workQueryExecutions } from "@finnor/db";
import { OperatingInteractionContextError, resolveOperatingInteractionContext } from "@finnor/orchestration";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "00000000-0000-4000-8000-00000000a101";
const TENANT_B = "00000000-0000-4000-8000-00000000b101";
const HOUSEHOLD_A = "00000000-0000-4000-8000-00000000a201";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

describe.skipIf(!available)("operating interaction tenant re-resolution", () => {
  let cohortExecutionId = "";
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.SECRETS_PROVIDER = "env";
    await migrate(DB_URL);
    await withTenant(TENANT_A, async (db) => {
      await db.insert(tenants).values({ id: TENANT_A, name: "Interaction Tenant A" }).onConflictDoNothing();
      await db.insert(households).values({ id: HOUSEHOLD_A, tenantId: TENANT_A, address: "101 Context Lane" }).onConflictDoNothing();
    });
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "Interaction Tenant B" }).onConflictDoNothing());
    const work = await receiveWork({ tenantId: TENANT_A, instruction: "Find inactive customers", channel: "text" });
    const [execution] = await withTenant(TENANT_A, (db) => db.insert(workQueryExecutions).values({
      tenantId: TENANT_A,
      workId: work.workId,
      workInputId: work.workInputId,
      intent: "customer_cohort",
      request: { intent: "customer_cohort", cohort: "inactive", minDaysInactive: 90 },
      executionKey: `interaction-cohort:${work.workId}`,
      status: "succeeded",
      resultSummary: { intent: "customer_cohort", returned: 5, totalCount: 12_500, totalCountExact: true, truncated: true },
      rowCount: 5,
      completedAt: new Date(),
    }).returning());
    cohortExecutionId = execution!.id;
  });

  afterAll(async () => { await closePool(); });

  it("rejects a forged cross-tenant entity before Work or planning can use it", async () => {
    await expect(resolveOperatingInteractionContext({
      tenantId: TENANT_B,
      channel: "text",
      context: {
        version: 1,
        capturedAt: new Date().toISOString(),
        source: "text",
        focusedEntity: { entityType: "household", entityId: HOUSEHOLD_A },
        selectedEntities: [], excludedEntities: [], filters: [],
        surface: { id: "customers", route: "/jarvis/customers" },
      },
    })).rejects.toMatchObject({ status: 403, code: "operating_context_scope_denied" } satisfies Partial<OperatingInteractionContextError>);
  });

  it("replaces client cohort count and bounds with the tenant-scoped durable receipt", async () => {
    const resolved = await resolveOperatingInteractionContext({
      tenantId: TENANT_A,
      channel: "voice",
      context: {
        version: 1,
        capturedAt: new Date().toISOString(),
        source: "text",
        selectedEntities: [], excludedEntities: [], filters: [{ field: "minDaysInactive", operator: "gte", value: 1 }],
        surface: { id: "customers", route: "/jarvis/customers" },
        cohort: { kind: "work_query_execution", executionId: cohortExecutionId, entityType: "household", queryIntent: "customer_cohort", count: 999_999 },
      },
    });
    expect(resolved?.source).toBe("voice");
    expect(resolved?.cohort?.count).toBe(12_500);
    expect(resolved?.filters).toContainEqual({ field: "minDaysInactive", operator: "gte", value: 90 });
  });
});
