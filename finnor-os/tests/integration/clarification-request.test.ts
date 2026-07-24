// B2.T4 acceptance: ambiguity is persisted as a real pending clarification card, not
// silently converted into a guessed operational action.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, domainActions, tenants, withTenant } from "@finnor/db";
import { eq } from "drizzle-orm";
import { createDefaultPluginRegistry, GatedExecutor, LLMPlanner } from "@finnor/orchestration";
import { createDefaultRegistry } from "@finnor/tools";
import type { LLMProvider } from "@finnor/orchestration";
import type { DomainPolicy, MemorySnapshot, TenantContext } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000c4";
async function dbUp(): Promise<boolean> { const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 }); try { await client.connect(); await client.end(); return true; } catch { return false; } }
const available = await dbUp();
const memory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId: TENANT_ID, userId: "clarification-test", role: "owner" });

describe.skipIf(!available)("clarification request", () => {
  beforeAll(async () => { process.env.DATABASE_URL = DB_URL; await migrate(DB_URL); await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Clarification Test Dealer" }).onConflictDoNothing()); });
  beforeEach(() => { delete process.env.AWS_BEDROCK_API_KEY; });
  afterAll(async () => { await closePool(); });

  it("registers, validates, and gates an ambiguous plan as a durable question card", async () => {
    const provider: LLMProvider = { name: "clarification-stub", async complete() { return JSON.stringify({ actions: [{ action_type: "clarification_request", payload: { question: "Which Henderson household should receive the quote?", missingFields: ["householdId"] } }] }); } };
    const plugins = createDefaultPluginRegistry();
    expect(plugins.actionTypes()).toContain("clarification_request");
    const [action] = await new LLMPlanner(plugins, provider).plan("Send the Hendersons a quote.", context(), memory());
    expect(action!.actionType).toBe("clarification_request");
    const policy: DomainPolicy = { id: "", tenantId: TENANT_ID, actionType: "clarification_request", policy: {}, requiresConfirmation: true, confirmationTemplate: null, version: 0 };
    const result = await new GatedExecutor(plugins, createDefaultRegistry()).execute(action!, policy);
    expect(result.output).toMatchObject({ gated: true, pendingConfirmation: true, summary: "Which Henderson household should receive the quote?" });
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, action!.id)));
    expect(row).toMatchObject({ actionType: "clarification_request", status: "pending", summary: "Which Henderson household should receive the quote?", payload: { missingFields: ["householdId"] } });
  });
});
