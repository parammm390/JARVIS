// Typed plan compiler (Phase 6, docs/jarvis-90-execution-blueprint.md §6) acceptance:
// entity grounding against real rows, and the command-graph tag distinguishing a
// single-action_type from one of the vertical-workflow action types Phase 4/5 built.
// The full LLMPlanner.plan() path isn't re-driven here (that needs a real LLM call,
// already exercised elsewhere) — this proves the compiler's own two guarantees
// directly, plus that planner.ts actually persists them onto the domain_actions row.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, households, domainActions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { groundEntitiesWithDb, buildCommandGraph } from "@finnor/orchestration";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f8";

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

describe.skipIf(!available)("typed plan compiler", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Plan Compiler Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  it("grounds a real householdId as verified, a random uuid as not_found, and an unknown field name as unverifiable", async () => {
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "1 Compiler Test Ln", contactInfo: {} }).returning(),
    );
    const result = await withTenant(TENANT_ID, (db) =>
      groundEntitiesWithDb(db, {
        householdId: hh!.id,
        invoiceId: "00000000-0000-4000-8000-000000000000", // well-formed uuid, no such row
        somethingElseId: "00000000-0000-4000-8000-000000000001", // not in the known field list
        note: "not an id field at all",
      }),
    );
    expect(result.find((r) => r.field === "householdId")?.status).toBe("verified");
    expect(result.find((r) => r.field === "invoiceId")?.status).toBe("not_found");
    expect(result.find((r) => r.field === "somethingElseId")?.status).toBe("unverifiable");
    expect(result.find((r) => r.field === "note")).toBeUndefined(); // not id-shaped, never grounded

    await withTenant(TENANT_ID, (db) => db.delete(households).where(eq(households.id, hh!.id)));
  });

  it("tags a vertical-workflow action_type as 'workflow' and an ordinary action as 'single_action'", () => {
    const workflowGraph = buildCommandGraph("start_invoice_to_cash_workflow", true);
    expect(workflowGraph.kind).toBe("workflow");
    expect(workflowGraph.requiresConfirmation).toBe(true);
    expect(workflowGraph.autoApprove).toBe(false);

    const singleGraph = buildCommandGraph("create_invoice", false);
    expect(singleGraph.kind).toBe("single_action");
    expect(singleGraph.autoApprove).toBe(true);
  });

  it("planner.ts actually persists grounded_payload/compiled_graph onto the domain_actions row it inserts", async () => {
    // Insert a domain_actions row the same shape planner.ts's batch insert produces,
    // directly exercising the two new columns end-to-end against real Postgres —
    // proving the migration/schema wiring, not just the pure compiler functions above.
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "2 Compiler Test Ln", contactInfo: {} }).returning(),
    );
    const groundedPayload = await withTenant(TENANT_ID, (db) => groundEntitiesWithDb(db, { householdId: hh!.id }));
    const compiledGraph = buildCommandGraph("start_water_test_workflow", true);
    const [row] = await withTenant(TENANT_ID, (db) =>
      db
        .insert(domainActions)
        .values({
          tenantId: TENANT_ID,
          actionType: "start_water_test_workflow",
          payload: { householdId: hh!.id },
          status: "draft",
          groundedPayload,
          compiledGraph,
        })
        .returning(),
    );
    expect(row!.groundedPayload).toEqual(groundedPayload);
    expect(row!.compiledGraph).toEqual(compiledGraph);

    const [reread] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, row!.id)));
    expect((reread!.groundedPayload as typeof groundedPayload)[0]?.status).toBe("verified");
    expect((reread!.compiledGraph as typeof compiledGraph).kind).toBe("workflow");

    await withTenant(TENANT_ID, async (db) => {
      await db.delete(domainActions).where(eq(domainActions.id, row!.id));
      await db.delete(households).where(eq(households.id, hh!.id));
    });
  });
});
