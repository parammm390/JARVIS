// B2.T5 acceptance: an open durable provider circuit is visible to planning and
// deterministically becomes a manual-step receipt, never a pending provider call.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { closePool, domainActions, tenants, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createDefaultPluginRegistry, GatedExecutor, LLMPlanner } from "@finnor/orchestration";
import { createDefaultRegistry, recordProviderFailure, recordProviderSuccess } from "@finnor/tools";
import type { LLMProvider } from "@finnor/orchestration";
import type { MemorySnapshot, TenantContext } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000c5";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();
const memory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId: TENANT_ID, userId: "planner-health-test", role: "owner" });

describe.skipIf(!available)("health-aware planner", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Planner Health Test Dealer" }).onConflictDoNothing());
  });

  afterAll(async () => {
    await recordProviderSuccess("vapi", TENANT_ID);
    await closePool();
  });

  it("does not persist a Vapi call action while its circuit is open", async () => {
    const originalBinding = process.env.COMMUNICATIONS_BINDING;
    process.env.COMMUNICATIONS_BINDING = "vapi";
    try {
      await recordProviderSuccess("vapi", TENANT_ID);
      await recordProviderFailure("vapi", TENANT_ID);
      await recordProviderFailure("vapi", TENANT_ID);
      await recordProviderFailure("vapi", TENANT_ID);

      const provider: LLMProvider = {
        name: "health-aware-stub",
        async complete() {
          return JSON.stringify({
            actions: [{ action_type: "bulk_notify_existing_customers", payload: { channel: "call", discountPercent: 10 } }],
          });
        },
      };
      const [action] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan("Call inactive customers with a ten percent offer.", context(), memory());

      expect(action).toMatchObject({ actionType: "manual_step_suggestion" });
      expect(action!.payload).toMatchObject({
        originalActionType: "bulk_notify_existing_customers",
        unavailableCapabilities: ["communications"],
      });
      const [row] = await withTenant(TENANT_ID, (db) =>
        db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.id, action!.id))),
      );
      expect(row).toMatchObject({ actionType: "manual_step_suggestion", status: "draft" });
      expect((row!.payload as { reason: string }).reason).toContain("circuit breaker is open");
      const result = await new GatedExecutor(createDefaultPluginRegistry(), createDefaultRegistry()).execute(action!, {
        id: "",
        tenantId: TENANT_ID,
        actionType: "manual_step_suggestion",
        policy: {},
        // Prove the advisory plugin itself has no provider side effect. In ordinary
        // use the absent-policy default remains confirmation-gated as usual.
        requiresConfirmation: false,
        confirmationTemplate: null,
        version: 0,
      });
      expect(result).toMatchObject({ status: "success", output: { manualStepSuggested: true } });
      const [completed] = await withTenant(TENANT_ID, (db) =>
        db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.id, action!.id))),
      );
      expect(completed!.status).toBe("completed");
    } finally {
      if (originalBinding === undefined) delete process.env.COMMUNICATIONS_BINDING;
      else process.env.COMMUNICATIONS_BINDING = originalBinding;
      await recordProviderSuccess("vapi", TENANT_ID);
    }
  });
});
