// B2 exit-gate: a real quotation total is visible before approval and compared after
// normal execution; no total is invented by the test.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, domainActions, priceBookItems, tenants, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createDefaultPluginRegistry, GatedExecutor, LLMPlanner, recordPredictionDiff } from "@finnor/orchestration";
import { createDefaultRegistry } from "@finnor/tools";
import type { LLMProvider } from "@finnor/orchestration";
import type { DomainAction, DomainPolicy, MemorySnapshot, TenantContext } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000c7";
const memory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId: TENANT_ID, userId: "quote-prediction-test", role: "owner" });
async function dbUp(): Promise<boolean> { const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await c.connect(); await c.end(); return true; } catch { return false; } }
const available = await dbUp();

describe.skipIf(!available)("quotation predicted receipt", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, async (db) => {
      await db.insert(tenants).values({ id: TENANT_ID, name: "Quotation Prediction Test Dealer" }).onConflictDoNothing();
      await db.insert(priceBookItems).values({ tenantId: TENANT_ID, sku: "B2-GATE-FILTER", label: "B2 Gate Filter", priceUsd: "125.00" }).onConflictDoNothing();
    });
  });
  afterAll(async () => { await closePool(); });

  it("stores the $125 predicted quote total before approval and matches it after execution", async () => {
    const provider: LLMProvider = { name: "quote-prediction-stub", async complete() { return JSON.stringify({ actions: [{ action_type: "generate_quote", payload: { householdLabel: "Gate Customer", items: ["B2-GATE-FILTER"] } }] }); } };
    const plugins = createDefaultPluginRegistry();
    const [action] = await new LLMPlanner(plugins, provider).plan("Quote the B2 gate filter.", context(), memory());
    const [before] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.id, action!.id))));
    expect(before!.predictedReceipt).toMatchObject({ simulation: { predicted: { totalUsd: 125, expectedResult: { quote: { totalUsd: 125 } } } } });
    const policy: DomainPolicy = { id: "", tenantId: TENANT_ID, actionType: "generate_quote", policy: {}, requiresConfirmation: false, confirmationTemplate: null, version: 0 };
    const result = await new GatedExecutor(plugins, createDefaultRegistry()).execute(action as DomainAction, policy);
    await recordPredictionDiff(action as DomainAction, result);
    const [after] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, action!.id)));
    expect(result.output).toMatchObject({ quote: { totalUsd: 125 } });
    expect(after!.predictionDiff).toMatchObject({ accuracy: 1 });
  });
});
