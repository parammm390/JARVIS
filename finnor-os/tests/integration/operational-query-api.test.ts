import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  closePool,
  households,
  receiveWork,
  tenants,
  withTenant,
  workPlannerAttempts,
  workQueryExecutions,
} from "@finnor/db";
import { POST as queriesPOST } from "../../apps/api/app/api/queries/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = randomUUID();
const HOUSEHOLD_ID = randomUUID();

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

function request(body?: unknown, tenantId = TENANT_ID): Request {
  return new Request("http://localhost/api/queries", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
      "x-user-role": "owner",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("POST /api/queries authentication boundary", () => {
  it("rejects an anonymous request before reading a query body", async () => {
    const response = await queriesPOST(new Request("http://localhost/api/queries", { method: "POST" }));
    expect(response.status).toBe(401);
  });
});

describe.skipIf(!available)("POST /api/queries typed contract", () => {
  const previousAuthBypass = process.env.AUTH_DEV_BYPASS;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, async (db) => {
      await db.insert(tenants).values({ id: TENANT_ID, name: "Operational Query API Tenant", timezone: "UTC" }).onConflictDoNothing();
      await db.insert(households).values({
        id: HOUSEHOLD_ID,
        tenantId: TENANT_ID,
        address: "1 Contract Lane",
        contactInfo: { name: "Contract Household" },
        marketingConsent: false,
      }).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await closePool();
    if (previousAuthBypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = previousAuthBypass;
  });

  it("authenticates, validates typed fields, attaches Work, and returns bounded timing metadata", async () => {
    const parentWork = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Contract parent Work",
      channel: "console",
    });
    const body = {
      intent: "customer_lookup",
      householdId: HOUSEHOLD_ID,
      page: { limit: 1 },
      workId: parentWork.workId,
      executionKey: `api-query-${randomUUID()}`,
      idempotencyKey: `api-query-${randomUUID()}`,
    } as const;

    const response = await queriesPOST(request(body));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/^query;dur=\d+(?:\.\d+)?$/);

    const payload = await response.json() as Record<string, any>;
    expect(payload.request).toMatchObject({ intent: "customer_lookup", householdId: HOUSEHOLD_ID });
    expect(payload.result).toMatchObject({ intent: "customer_lookup", version: 1 });
    expect(payload.result.page.returned).toBeLessThanOrEqual(payload.result.page.limit);
    expect(payload.workId).toBe(parentWork.workId);
    expect(payload.workInputId).toEqual(expect.any(String));
    expect(payload.workInputId).not.toBe(parentWork.workInputId);
    expect(JSON.stringify(payload).length).toBeLessThan(100_000);

    const executions = await withTenant(TENANT_ID, (db) => db.select().from(workQueryExecutions).where(eq(workQueryExecutions.workId, parentWork.workId)));
    const plannerAttempts = await withTenant(TENANT_ID, (db) => db.select().from(workPlannerAttempts).where(eq(workPlannerAttempts.workId, parentWork.workId)));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.workInputId).toBe(payload.workInputId);
    expect(plannerAttempts).toHaveLength(0);

    const duplicate = await queriesPOST(request(body));
    expect(duplicate.status).toBe(200);
    const duplicatePayload = await duplicate.json() as Record<string, any>;
    expect(duplicatePayload.duplicate).toBe(true);
    expect(duplicatePayload.workId).toBe(payload.workId);
    expect(duplicatePayload.workInputId).toBe(payload.workInputId);
    expect(duplicatePayload.execution?.id).toBe(payload.execution?.id);

    const afterReplay = await withTenant(TENANT_ID, (db) => db.select().from(workQueryExecutions).where(eq(workQueryExecutions.workId, parentWork.workId)));
    expect(afterReplay).toHaveLength(1);
  });

  it("keeps Work attachment workId separate from the work_list recordId filter", async () => {
    const attachmentWork = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Execution attachment Work",
      channel: "console",
    });
    const filteredRecord = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Record selected by the query",
      channel: "console",
    });
    const body = {
      intent: "work_list",
      section: "works",
      recordId: filteredRecord.workId,
      page: { limit: 10 },
      workId: attachmentWork.workId,
      executionKey: `record-filter-${randomUUID()}`,
      idempotencyKey: `record-filter-${randomUUID()}`,
    } as const;

    const response = await queriesPOST(request(body));
    expect(response.status).toBe(201);
    const payload = await response.json() as Record<string, any>;
    expect(payload.workId).toBe(attachmentWork.workId);
    expect(payload.request).toMatchObject({ intent: "work_list", recordId: filteredRecord.workId });
    expect(payload.request).not.toHaveProperty("workId");
    expect(payload.result.works.map((row: { id: string }) => row.id)).toEqual([filteredRecord.workId]);

    const executions = await withTenant(TENANT_ID, (db) => db.select().from(workQueryExecutions).where(eq(workQueryExecutions.workId, attachmentWork.workId)));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.request).toMatchObject({ intent: "work_list", recordId: filteredRecord.workId });
    expect(executions[0]?.workId).toBe(attachmentWork.workId);
  });

  it.each([
    ["tenantId", { intent: "business_state", tenantId: randomUUID() }],
    ["workInputId", { intent: "business_state", workInputId: randomUUID() }],
    ["unknown intent field", { intent: "business_state", surprise: true }],
    ["mismatched field", { intent: "schedule_range", range: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" }, lowStockOnly: false }],
  ])("rejects %s without creating Work or a planner attempt", async (_label, body) => {
    const response = await queriesPOST(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
