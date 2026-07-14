// external_operations ledger — ScopedToolRegistry must claim before calling out.
// A fresh ScopedToolRegistry is constructed per execute() call (see executor.ts /
// graph/nodes.ts), so "a retry" here means a second instance sharing the same
// domainActionId, exactly matching how a reflection retry or a resumed LangGraph
// thread actually invokes plugin.execute() again. The rule under test: a call that
// already SUCCEEDED is never re-run (true idempotency); a call that previously FAILED
// is always allowed to actually retry (that's reflection's whole job — a failed
// attempt never delivered anything, so re-running it isn't a duplicate). The
// composite PK (domain_action_id, operation_key) is what makes every claim atomic
// under real concurrency, not just app-level sequencing — tested against real
// Postgres, not mocked.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { z } from "zod";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainActions } from "@finnor/db";
import { ToolRegistry, ScopedToolRegistry } from "@finnor/tools";

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

async function makeAction(): Promise<string> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [row] = await db.insert(domainActions).values({ tenantId: SEED_TENANT_ID, actionType: "test_idempotency", payload: {}, status: "executing" }).returning();
    return row!.id;
  });
}

describe.skipIf(!available)("ScopedToolRegistry — external_operations idempotency ledger", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("a fresh instance replaying an already-SUCCEEDED call (simulating a retry) returns the cached result — run() never fires twice", async () => {
    let calls = 0;
    const base = new ToolRegistry();
    base.register({
      name: "spy_tool",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      async run(input) {
        calls++;
        return { echoed: input };
      },
    });
    const actionId = await makeAction();
    const attempt1 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const first = await attempt1.call("spy_tool", { x: 1 });
    expect(first.ok).toBe(true);

    // A fresh instance for the SAME action, same first call — exactly what a
    // reflection retry or resumed graph thread constructs.
    const attempt2 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const second = await attempt2.call("spy_tool", { x: 1 });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("a fresh instance replaying an already-FAILED call actually re-runs it — reflection retries are never blocked", async () => {
    let calls = 0;
    const base = new ToolRegistry();
    base.register({
      name: "flaky_tool",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      retryPolicy: { attempts: 1, baseDelayMs: 1, timeoutMs: 500 },
      async run() {
        calls++;
        if (calls === 1) throw new Error("first attempt fails");
        return { ok: true };
      },
    });
    const actionId = await makeAction();
    const attempt1 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const first = await attempt1.call("flaky_tool", { x: 1 });
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);

    const attempt2 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const second = await attempt2.call("flaky_tool", { x: 1 });
    expect(calls).toBe(2); // actually re-ran, not blocked by the failed row
    expect(second.ok).toBe(true);
  });

  it("a fresh instance replaying a SUCCEEDED call with DIFFERENT input errors instead of silently accepting drift", async () => {
    const base = new ToolRegistry();
    base.register({
      name: "spy_tool2",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      async run() {
        return {};
      },
    });
    const actionId = await makeAction();
    const attempt1 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    await attempt1.call("spy_tool2", { x: 1 });

    const attempt2 = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const conflict = await attempt2.call("spy_tool2", { x: 2 });
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toMatch(/Idempotency conflict/);
  });

  it("multiple calls to the SAME tool within ONE instance (a bulk-send loop) are each treated as distinct operations — never collapsed", async () => {
    let calls = 0;
    const base = new ToolRegistry();
    base.register({
      name: "bulk_send",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      async run(input) {
        calls++;
        return { sentTo: input.target };
      },
    });
    const actionId = await makeAction();
    const scoped = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });

    const r1 = await scoped.call("bulk_send", { target: "a@example.com" });
    const r2 = await scoped.call("bulk_send", { target: "b@example.com" });
    const r3 = await scoped.call("bulk_send", { target: "c@example.com" });
    expect(calls).toBe(3); // every target actually sent — none silently skipped as a "duplicate"
    expect([r1, r2, r3].every((r) => r.ok)).toBe(true);
  });

  it("concurrent calls for the same key: only one real invocation, proving the composite PK enforces atomicity", async () => {
    let calls = 0;
    const base = new ToolRegistry();
    base.register({
      name: "spy_tool3",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      async run() {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
        return { done: true };
      },
    });
    const actionId = await makeAction();
    const scopedA = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });
    const scopedB = new ScopedToolRegistry(base, { tenantId: SEED_TENANT_ID, domainActionId: actionId });

    // Both instances' FIRST call lands on the same operationKey ("spy_tool3:0") —
    // simulates two concurrent execute() calls for the same action.
    const results = await Promise.all([scopedA.call("spy_tool3", { x: 1 }), scopedB.call("spy_tool3", { x: 1 })]);
    expect(calls).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("a tool registry without idempotency scoping (base ToolRegistry) is unaffected — opt-in via ScopedToolRegistry only", async () => {
    let calls = 0;
    const base = new ToolRegistry();
    base.register({
      name: "spy_tool4",
      description: "",
      integration: "test",
      inputSchema: z.object({}).passthrough(),
      async run() {
        calls++;
        return {};
      },
    });
    await base.call("spy_tool4", {});
    await base.call("spy_tool4", {});
    expect(calls).toBe(2); // no ledger involved at all — today's behavior, unchanged
  });
});
