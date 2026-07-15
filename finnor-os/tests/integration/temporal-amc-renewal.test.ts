// Temporal proof slice (Part 2 of the engine-upgrade plan): a real ephemeral Temporal
// server (TestWorkflowEnvironment.createLocal — downloads/manages the official
// Temporal CLI binary itself, same pattern this repo already uses for embedded-postgres
// in dev), a real Worker, and the real, unchanged FinnorOrchestrator.draftKnownAction
// pipeline against real Postgres. Wait durations are shortened via workflow input
// (seconds, not days) so this proves the actual mechanism — durable timer racing a
// signal, and escalation when no signal arrives — without the test taking days to run.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, households, maintenanceAgreements, domainActions, domainPolicies, invoices, workflowRuns, tenants } from "@finnor/db";
import { eq, and } from "drizzle-orm";
import * as activities from "../../apps/temporal-worker/src/activities";
import { amcRenewalSequence, type AmcRenewalInput } from "../../apps/temporal-worker/src/workflows/amc-renewal-sequence";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TASK_QUEUE = "test-amc-renewal";

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

async function makeHouseholdAndAgreement(label: string, phone: string): Promise<{ householdId: string; agreementId: string }> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [hh] = await db
      .insert(households)
      .values({ tenantId: SEED_TENANT_ID, address: `1 ${label} Ln, Cedar Falls, IA`, contactInfo: { name: label, phone } })
      .returning();
    const [agreement] = await db
      .insert(maintenanceAgreements)
      .values({ householdId: hh!.id, cadence: "annual", status: "renewal_window", renewalDate: new Date() })
      .returning();
    return { householdId: hh!.id, agreementId: agreement!.id };
  });
}

describe.skipIf(!available)("AMC renewal Temporal workflow — real ephemeral server, real worker, real Postgres", () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRunPromise: Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.COMMS_MODE = "native";
    await migrate(DB_URL);
    await seed(DB_URL);
    await withTenant(SEED_TENANT_ID, (db) => db.update(tenants).set({ ownerPhone: "+13195559999" }).where(eq(tenants.id, SEED_TENANT_ID)));

    testEnv = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("../../apps/temporal-worker/src/workflows/amc-renewal-sequence.ts", import.meta.url)),
      activities,
    });
    workerRunPromise = worker.run();
  }, 60_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRunPromise?.catch(() => undefined);
    await testEnv?.teardown();
    await closePool();
  });

  it("drafts a real gated reminder immediately, then completes as 'renewed' when the signal arrives before the first (short) wait elapses", async () => {
    const { householdId, agreementId } = await makeHouseholdAndAgreement("Signal Responds Fast", "+19995552001");
    const input: AmcRenewalInput = {
      tenantId: SEED_TENANT_ID,
      agreementId,
      householdId,
      householdLabel: "Signal Responds Fast",
      contactPhone: "+19995552001",
      cadence: "annual",
      firstWaitMs: 5_000,
      secondWaitMs: 5_000,
    };
    const handle = await testEnv.client.workflow.start(amcRenewalSequence, {
      workflowId: `test-amc-renewal:${agreementId}`,
      taskQueue: TASK_QUEUE,
      args: [input],
    });

    // Give the workflow time to run the first activity (a real gate through the real
    // orchestrator against real Postgres) before asserting on it.
    await new Promise((r) => setTimeout(r, 2_000));
    const drafted = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, SEED_TENANT_ID), eq(domainActions.actionType, "renew_maintenance_agreement"))),
    );
    const mine = drafted.find((d) => (d.payload as Record<string, unknown>).agreementId === agreementId);
    expect(mine, "the first reminder should have drafted a real, gated domain_action").toBeTruthy();
    expect(mine!.status).toBe("pending"); // gated — never auto-sent

    await handle.signal("customerResponded");
    const result = await handle.result();
    expect(result.outcome).toBe("renewed");

    const [agreementRow] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).not.toBe("lapsed"); // signal arrived — never escalated
  }, 30_000);

  it("escalates to 'lapsed' + notifies the owner when no signal arrives within either (short) wait window", async () => {
    const { householdId, agreementId } = await makeHouseholdAndAgreement("Never Responds", "+19995552002");
    const input: AmcRenewalInput = {
      tenantId: SEED_TENANT_ID,
      agreementId,
      householdId,
      householdLabel: "Never Responds",
      contactPhone: "+19995552002",
      cadence: "annual",
      firstWaitMs: 2_000,
      secondWaitMs: 2_000,
    };
    const handle = await testEnv.client.workflow.start(amcRenewalSequence, {
      workflowId: `test-amc-renewal:${agreementId}`,
      taskQueue: TASK_QUEUE,
      args: [input],
    });

    const result = await handle.result();
    expect(result.outcome).toBe("lapsed");

    const [agreementRow] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).toBe("lapsed");

    const drafted = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(and(eq(domainActions.tenantId, SEED_TENANT_ID), eq(domainActions.actionType, "renew_maintenance_agreement"))),
    );
    const mine = drafted.filter((d) => (d.payload as Record<string, unknown>).agreementId === agreementId);
    expect(mine.length).toBe(2); // day-0 reminder AND the day-3 firmer follow-up, both real gated actions
  }, 30_000);

  it("a renewal with a real configured price actually bills the customer — a fresh invoice, handed to the real invoice-to-cash workflow", async () => {
    // Its own tenant, not SEED_TENANT_ID — the seed's domain_policies row for
    // renew_maintenance_agreement deliberately carries the honest PLACEHOLDER_NEEDS_REAL_VALUE
    // sentinel (never a fabricated price), so proving the real-price path needs a
    // tenant configured with one.
    const priceTenantId = "00000000-0000-4000-8000-0000000000f6";
    await withTenant(priceTenantId, (db) =>
      db.insert(tenants).values({ id: priceTenantId, name: "AMC Price Test Dealer" }).onConflictDoNothing(),
    );
    await withTenant(priceTenantId, (db) =>
      db.insert(domainPolicies).values({
        tenantId: priceTenantId,
        actionType: "renew_maintenance_agreement",
        policy: { renewal_window_days: 30, price_usd: 189, cadence_options: ["annual"] },
        requiresConfirmation: true,
      }),
    );
    const { householdId, agreementId } = await withTenant(priceTenantId, async (db) => {
      const [hh] = await db
        .insert(households)
        .values({ tenantId: priceTenantId, address: "1 Real Price Ln", contactInfo: { name: "Real Price", phone: "+19995552003" } })
        .returning();
      const [agreement] = await db
        .insert(maintenanceAgreements)
        .values({ householdId: hh!.id, cadence: "annual", status: "renewal_window", renewalDate: new Date() })
        .returning();
      return { householdId: hh!.id, agreementId: agreement!.id };
    });

    const input: AmcRenewalInput = {
      tenantId: priceTenantId,
      agreementId,
      householdId,
      householdLabel: "Real Price",
      contactPhone: "+19995552003",
      cadence: "annual",
      firstWaitMs: 5_000,
      secondWaitMs: 5_000,
    };
    const handle = await testEnv.client.workflow.start(amcRenewalSequence, {
      workflowId: `test-amc-renewal:${agreementId}`,
      taskQueue: TASK_QUEUE,
      args: [input],
    });
    await handle.signal("customerResponded");
    const result = await handle.result();
    expect(result.outcome).toBe("renewed");

    const [agreementRow] = await withTenant(priceTenantId, (db) => db.select().from(maintenanceAgreements).where(eq(maintenanceAgreements.id, agreementId)));
    expect(agreementRow!.status).toBe("renewed");
    expect(agreementRow!.renewalDate!.getTime()).toBeGreaterThan(Date.now()); // advanced to the next cadence window

    const [invoice] = await withTenant(priceTenantId, (db) => db.select().from(invoices).where(eq(invoices.householdId, householdId)));
    expect(invoice, "a real invoice should have been created for the configured price").toBeTruthy();
    expect(Number(invoice!.amountUsd)).toBe(189);

    const runs = await withTenant(priceTenantId, (db) => db.select().from(workflowRuns).where(eq(workflowRuns.workflowType, "invoice_to_cash")));
    expect(runs.length).toBeGreaterThan(0); // the same real invoice-to-cash command graph vertical workflow 4 built was actually submitted
  }, 30_000);
});
