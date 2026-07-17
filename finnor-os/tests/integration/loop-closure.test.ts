// Autonomous loop closure acceptance (Phase 12, docs/jarvis-99-phase-10-16-execution-plan.md
// "PHASE 12"): scan findings stop dead-ending in the daily digest. Real DB, real
// proof that (a) open findings reach the planner's outgoing prompt via patterns.scanSignals,
// (b) a critical/stock-conflict signal genuinely upgrades reasoning tier, (c) the two
// newly config-gated scans draft real actions and link them back to their finding, and
// (d) the findings→digest staleness metric computes correctly — never a type-level
// change asserted without a real end-to-end proof (same discipline as
// tests/integration/pattern-context.test.ts's own header note).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  getPool,
  closePool,
  withTenant,
  scanFindings,
  domainActions,
  domainPolicies,
  inventoryItems,
} from "@finnor/db";
import { buildPatternContext, buildMemorySnapshot } from "@finnor/memory";
import {
  LLMPlanner,
  createDefaultPluginRegistry,
  classifyReasoningTier,
  STOCK_CONSUMING_ACTION_TYPES,
  buildCommandGraph,
  computeLearningDigest,
} from "@finnor/orchestration";
import type { LLMProvider } from "@finnor/orchestration";
import type { TenantContext } from "@finnor/shared-types";
import { scanLowInventory } from "../../apps/worker/src/handlers/scan-low-inventory";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000fd"; // dedicated, isolated from other fixtures

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

describe.skipIf(!available)("Loop closure (Phase 12)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await getPool().query(`INSERT INTO tenants (id, name) VALUES ($1, 'Loop Closure Test Tenant') ON CONFLICT (id) DO NOTHING`, [TENANT_ID]);
    // Fresh start every run — scanFindings has no FK dependents pointing at it (only
    // scanFindings.draftedActionId pointing OUT at domainActions, so this delete is
    // always safe), and scanSignalsPattern's newest-10 cap means unbounded
    // accumulation across many dev runs would otherwise push test fixtures out of
    // the window this suite depends on.
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    await withTenant(TENANT_ID, (db) => db.delete(inventoryItems).where(eq(inventoryItems.tenantId, TENANT_ID)));
  });

  afterAll(async () => {
    await closePool();
  });

  it("1. an undigested critical finding reaches buildPatternContext as a scanSignal", async () => {
    await withTenant(TENANT_ID, (db) =>
      db.insert(scanFindings).values({
        tenantId: TENANT_ID,
        scanType: "cold_leads",
        severity: "critical",
        summary: "LOOP-CLOSURE-CRITICAL-FINDING: 12 customers inactive 3-6 months.",
        details: {},
      }),
    );
    const pattern = await buildPatternContext(TENANT_ID);
    const signal = pattern.scanSignals.find((s) => s.summary.includes("LOOP-CLOSURE-CRITICAL-FINDING"));
    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("critical");
    expect(signal!.scanType).toBe("cold_leads");
    expect(signal!.ageHours).toBeGreaterThanOrEqual(0);
  });

  it("2. scanSignals genuinely reaches the planner's outgoing prompt — not just the type", async () => {
    const snapshot = await buildMemorySnapshot({ tenantId: TENANT_ID });
    expect(snapshot.patterns!.scanSignals.some((s) => s.summary.includes("LOOP-CLOSURE-CRITICAL-FINDING"))).toBe(true);

    const captured: string[] = [];
    const capturingProvider: LLMProvider = {
      name: "capturing",
      async complete(opts) {
        captured.push(opts.user);
        return JSON.stringify({ actions: [] });
      },
    };
    const planner = new LLMPlanner(createDefaultPluginRegistry(), capturingProvider);
    const ctx: TenantContext = { tenantId: TENANT_ID, userId: "test-user", role: "owner" };
    await planner.plan("What's going on with cold leads?", ctx, snapshot);

    expect(captured).toHaveLength(1);
    const sentUser = captured[0]!;
    expect(sentUser).toContain("scanSignals");
    expect(sentUser).toContain("LOOP-CLOSURE-CRITICAL-FINDING");
  });

  it("3. classifyReasoningTier: scan signals upgrade medium to high, never touch low, respect stock-consuming set", () => {
    const nonWorkflowGraph = buildCommandGraph("send_customer_message", true);
    const stockGraph = buildCommandGraph("log_stock_used_on_visit", true);
    expect(STOCK_CONSUMING_ACTION_TYPES.has("log_stock_used_on_visit")).toBe(true);

    // warning + unrelated action → medium stays medium
    expect(
      classifyReasoningTier({
        requiresConfirmation: true,
        compiledGraph: nonWorkflowGraph,
        payload: {},
        actionType: "send_customer_message",
        openScanSignals: [{ scanType: "low_inventory", severity: "warning" }],
      }),
    ).toBe("medium");

    // critical → high, regardless of action type
    expect(
      classifyReasoningTier({
        requiresConfirmation: true,
        compiledGraph: nonWorkflowGraph,
        payload: {},
        actionType: "send_customer_message",
        openScanSignals: [{ scanType: "cold_leads", severity: "critical" }],
      }),
    ).toBe("high");

    // low_inventory + a stock-consuming action type → high, even at warning severity
    expect(
      classifyReasoningTier({
        requiresConfirmation: true,
        compiledGraph: stockGraph,
        payload: {},
        actionType: "log_stock_used_on_visit",
        openScanSignals: [{ scanType: "low_inventory", severity: "warning" }],
      }),
    ).toBe("high");

    // requiresConfirmation:false + critical → still low — tier never upgrades an un-gated action
    expect(
      classifyReasoningTier({
        requiresConfirmation: false,
        compiledGraph: nonWorkflowGraph,
        payload: {},
        actionType: "send_customer_message",
        openScanSignals: [{ scanType: "cold_leads", severity: "critical" }],
      }),
    ).toBe("low");
  });

  it("4. scan_low_inventory: config present drafts a real gated action linked to its finding; absent config, finding only", async () => {
    // Repeatable across consecutive suite runs against the same persistent Postgres:
    // upsert the policy to an explicit OFF state first, rather than relying on "no
    // policy row exists yet" (which is only true the very first time this test runs).
    async function setAutoDraft(enabled: boolean) {
      const [existing] = await withTenant(TENANT_ID, (db) =>
        db.select().from(domainPolicies).where(and(eq(domainPolicies.tenantId, TENANT_ID), eq(domainPolicies.actionType, "flag_reorder_needed"))),
      );
      const policyValues = { policy: { autoDraftReorderFlags: enabled }, requiresConfirmation: true };
      if (existing) {
        await withTenant(TENANT_ID, (db) => db.update(domainPolicies).set(policyValues).where(eq(domainPolicies.id, existing.id)));
      } else {
        await withTenant(TENANT_ID, (db) => db.insert(domainPolicies).values({ tenantId: TENANT_ID, actionType: "flag_reorder_needed", ...policyValues }));
      }
    }

    // domain_actions rows this suite drafts on one run can never be cleaned up on
    // the next (action_log is append-only and FK'd to domain_actions — see
    // scan-handlers.test.ts's own comment on the same constraint), so item names are
    // run-unique rather than fixed strings — a fixed name would let a stale row from
    // an earlier run silently satisfy (or break) this run's assertions.
    const runId = Date.now().toString(36);
    const regressionName = `Loop Closure Regression Item ${runId}`;
    const gatedName = `Loop Closure Gated Item ${runId}`;

    // --- Regression half: autoDraftReorderFlags explicitly off.
    await setAutoDraft(false);
    await withTenant(TENANT_ID, (db) =>
      db.insert(inventoryItems).values({ tenantId: TENANT_ID, sku: `LOOP-REG-${runId}`, name: regressionName, quantity: 1, reorderThreshold: 10 }),
    );
    await scanLowInventory({ tenantId: TENANT_ID });
    const regressionFindings = await withTenant(TENANT_ID, (db) =>
      db.select().from(scanFindings).where(and(eq(scanFindings.tenantId, TENANT_ID), eq(scanFindings.scanType, "low_inventory"), isNull(scanFindings.draftedActionId))),
    );
    expect(regressionFindings.some((f) => f.summary.includes(regressionName))).toBe(true);
    const regressionDrafted = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.actionType, "flag_reorder_needed"))),
    );
    expect(regressionDrafted.some((a) => (a.payload as Record<string, unknown>).name === regressionName)).toBe(false);

    // --- Gated half: policy flipped on → real gated action drafted, finding linked to it.
    await setAutoDraft(true);
    await withTenant(TENANT_ID, (db) =>
      db.insert(inventoryItems).values({ tenantId: TENANT_ID, sku: `LOOP-GATED-${runId}`, name: gatedName, quantity: 2, reorderThreshold: 10 }),
    );
    await scanLowInventory({ tenantId: TENANT_ID });

    const draftedActions = await withTenant(TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.actionType, "flag_reorder_needed"))),
    );
    const gatedAction = draftedActions.find((a) => (a.payload as Record<string, unknown>).name === gatedName);
    expect(gatedAction).toBeDefined();
    expect(gatedAction!.status).toBe("pending"); // gated — never auto-executed

    const gatedFindings = await withTenant(TENANT_ID, (db) =>
      db
        .select()
        .from(scanFindings)
        .where(and(eq(scanFindings.tenantId, TENANT_ID), eq(scanFindings.scanType, "low_inventory"), eq(scanFindings.draftedActionId, gatedAction!.id))),
    );
    expect(gatedFindings).toHaveLength(1);
    expect(gatedFindings[0]!.summary).toContain(gatedName);
  });

  it("5. scanFindingLagHours computes avg/max/sampleSize correctly over digested findings", async () => {
    await withTenant(TENANT_ID, (db) => db.delete(scanFindings).where(eq(scanFindings.tenantId, TENANT_ID)));
    const now = new Date();
    await withTenant(TENANT_ID, (db) =>
      db.insert(scanFindings).values([
        {
          tenantId: TENANT_ID,
          scanType: "service_due",
          summary: "lag fixture A",
          details: {},
          createdAt: new Date(now.getTime() - 10 * 3600 * 1000),
          digestedAt: now,
        },
        {
          tenantId: TENANT_ID,
          scanType: "service_due",
          summary: "lag fixture B",
          details: {},
          createdAt: new Date(now.getTime() - 30 * 3600 * 1000),
          digestedAt: now,
        },
      ]),
    );
    const digest = await computeLearningDigest(TENANT_ID);
    expect(digest.scanFindingLagHours.sampleSize).toBe(2);
    expect(digest.scanFindingLagHours.avg).toBeCloseTo(20, 1);
    expect(digest.scanFindingLagHours.max).toBeCloseTo(30, 1);
  });
});
