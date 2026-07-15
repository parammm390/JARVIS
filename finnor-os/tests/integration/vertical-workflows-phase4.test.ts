// Phase 4 vertical workflows 1-4 acceptance (docs/jarvis-90-execution-blueprint.md
// §4.1-4.4) — each proven end-to-end against real Postgres, driving the durable
// execution runtime's job-queue-backed steps directly (same mechanism a real worker
// process uses), with the default (emulator) capability bindings.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import {
  withTenant,
  closePool,
  tenants,
  households,
  proposals,
  quotes,
  invoices,
  workOrders,
  payments,
  workflowRuns,
  workflowSteps,
  commands,
  integrationOperations,
  reconciliationCases,
  inboxEvents,
} from "@finnor/db";
import { eq, and } from "drizzle-orm";
import leadToWaterTestPlugin from "../../packages/domain-plugins/lead-to-water-test/index";
import proposalSignaturePlugin, { applySignatureOutcome } from "../../packages/domain-plugins/proposal-signature/index";
import proposalToInstallationPlugin from "../../packages/domain-plugins/proposal-to-installation/index";
import invoiceToCashPlugin, { applyPaymentWebhookEvent } from "../../packages/domain-plugins/invoice-to-cash/index";
import { runWorkflowStep } from "../../apps/worker/src/handlers/run-workflow-step";
import { resetSchedulingEmulator, resetCommunicationsEmulator, resetInventoryEmulator, resetAccountingEmulator, resetDocumentsEmulator, getEmulatorHoldStatus, wasEmulatorCallSent } from "@finnor/tools";
import type { DomainPolicy } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000f4";

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

function policy(): DomainPolicy {
  return { id: "p1", tenantId: TENANT_ID, actionType: "test", policy: {}, requiresConfirmation: false } as DomainPolicy;
}

async function driveToCompletion(workflowRunId: string, maxIter = 10) {
  for (let i = 0; i < maxIter; i++) {
    const steps = await withTenant(TENANT_ID, (db) =>
      db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId)).orderBy(workflowSteps.sequence),
    );
    const pending = steps.find((s) => s.status === "pending");
    if (!pending) return steps;
    await runWorkflowStep({ tenantId: TENANT_ID, workflowStepId: pending.id });
  }
  return withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId)));
}

async function cleanWorkflowRun(workflowRunId: string, commandId: string) {
  await withTenant(TENANT_ID, async (db) => {
    const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId));
    for (const s of steps) {
      await db.delete(integrationOperations).where(eq(integrationOperations.workflowStepId, s.id));
      // inbox_events.matched_step_id FKs into workflow_steps — must clear before the
      // steps themselves are deleted, or the delete below violates that FK.
      await db.delete(inboxEvents).where(eq(inboxEvents.matchedStepId, s.id));
    }
    await db.delete(workflowSteps).where(eq(workflowSteps.workflowRunId, workflowRunId));
    await db.delete(workflowRuns).where(eq(workflowRuns.id, workflowRunId));
    await db.delete(commands).where(eq(commands.id, commandId));
  });
}

describe.skipIf(!available)("Phase 4 vertical workflows", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Phase 4 Workflow Test Dealer" }).onConflictDoNothing());
    // Clean slate: reconciliation_cases/inbox_events opened by a prior run must not
    // collide with this run's fresh rows or leave FK-blocking debris behind.
    await withTenant(TENANT_ID, (db) => db.delete(reconciliationCases).where(eq(reconciliationCases.tenantId, TENANT_ID)));
  });
  afterAll(async () => {
    await closePool();
  });

  it("workflow 1 (lead to booked water test): hold → confirmation call → confirm, all completed", async () => {
    resetSchedulingEmulator();
    resetCommunicationsEmulator();
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "1 Phase4 W1 Ln", contactInfo: {} }).returning(),
    );
    const scheduledAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const draft = await leadToWaterTestPlugin.draft(
      "start_water_test_workflow",
      { householdId: hh!.id, scheduledAt, phoneNumber: "+15555550100" },
      policy(),
    );
    const result = await leadToWaterTestPlugin.execute(draft, undefined as never);
    expect(result.status).toBe("success");
    const { workflowRunId, commandId } = result.output as { workflowRunId: string; commandId: string };

    const steps = await driveToCompletion(workflowRunId);
    expect(steps.map((s) => s.status)).toEqual(["completed", "completed", "completed"]);

    const holdStep = steps.find((s) => s.stepType === "hold_appointment")!;
    const holdId = (holdStep.evidence as { output: { holdId: string } }).output.holdId;
    expect(getEmulatorHoldStatus(holdId)).toBe("confirmed");
    expect(wasEmulatorCallSent(`lead-to-water-test:${hh!.id}:${scheduledAt}:confirm-call`)).toBe(true);

    await cleanWorkflowRun(workflowRunId, commandId);
    await withTenant(TENANT_ID, (db) => db.delete(households).where(eq(households.id, hh!.id)));
  });

  it("workflow 2 (water test to signed proposal): document generated, signature requested, and a real applySignatureOutcome transitions the quote — idempotently", async () => {
    resetDocumentsEmulator();
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "2 Phase4 W2 Ln", contactInfo: {} }).returning(),
    );
    const [quote] = await withTenant(TENANT_ID, (db) => db.insert(quotes).values({ tenantId: TENANT_ID, householdId: hh!.id, totalUsd: "500.00", status: "sent" }).returning());
    const [prop] = await withTenant(TENANT_ID, (db) =>
      db.insert(proposals).values({ householdId: hh!.id, content: {}, status: "sent", quoteId: quote!.id }).returning(),
    );

    const draft = await proposalSignaturePlugin.draft(
      "request_proposal_signature",
      { proposalId: prop!.id, signerName: "Test Signer", signerEmail: "signer@example.com" },
      policy(),
    );
    const result = await proposalSignaturePlugin.execute(draft, undefined as never);
    expect(result.status).toBe("success");
    const { workflowRunId, commandId } = result.output as { workflowRunId: string; commandId: string };

    const steps = await driveToCompletion(workflowRunId);
    expect(steps.map((s) => s.status)).toEqual(["completed", "completed"]);

    const signatureRequestId = `proposal-signature:${prop!.id}:sig`;
    // Correlates the event to the request_signature step, so it registers as
    // "matched" — never a spurious reconciliation_case for a legitimate response.
    const signatureStepId = steps.find((s) => s.stepType === "request_signature")!.id;
    const first = await applySignatureOutcome({ tenantId: TENANT_ID, quoteId: quote!.id, proposalId: prop!.id, signatureRequestId, outcome: "signed", matchStepId: signatureStepId });
    expect(first.applied).toBe(true);
    const second = await applySignatureOutcome({ tenantId: TENANT_ID, quoteId: quote!.id, proposalId: prop!.id, signatureRequestId, outcome: "signed", matchStepId: signatureStepId });
    expect(second.applied).toBe(false);

    const [quoteAfter] = await withTenant(TENANT_ID, (db) => db.select().from(quotes).where(eq(quotes.id, quote!.id)));
    expect(quoteAfter!.status).toBe("accepted");
    const [propAfter] = await withTenant(TENANT_ID, (db) => db.select().from(proposals).where(eq(proposals.id, prop!.id)));
    expect(propAfter!.status).toBe("accepted");

    await cleanWorkflowRun(workflowRunId, commandId);
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(proposals).where(eq(proposals.id, prop!.id));
      await db.delete(quotes).where(eq(quotes.id, quote!.id));
      await db.delete(households).where(eq(households.id, hh!.id));
    });
  });

  it("workflow 3 (signed proposal to installation): insufficient stock triggers a real procurement-exception step, then reserve/deposit/dispatch all complete", async () => {
    resetInventoryEmulator();
    resetAccountingEmulator();
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "3 Phase4 W3 Ln", contactInfo: {} }).returning(),
    );
    const [quote] = await withTenant(TENANT_ID, (db) => db.insert(quotes).values({ tenantId: TENANT_ID, householdId: hh!.id, totalUsd: "1000.00", status: "accepted" }).returning());

    const draft = await proposalToInstallationPlugin.draft(
      "start_installation_workflow",
      { quoteId: quote!.id, householdId: hh!.id, sku: "PHASE4-W3-SKU", quantity: 3, depositAmountUsd: 150 },
      policy(),
    );
    const result = await proposalToInstallationPlugin.execute(draft, undefined as never);
    expect(result.status).toBe("success");
    expect((result.output as { procurementNeeded: boolean }).procurementNeeded).toBe(true); // stock starts at 0
    const { workflowRunId, commandId, invoiceId } = result.output as { workflowRunId: string; commandId: string; invoiceId: string };

    const steps = await driveToCompletion(workflowRunId);
    expect(steps.map((s) => s.stepType)).toEqual(["receive_procurement", "reserve_stock", "record_deposit_payment", "create_work_order"]);
    expect(steps.every((s) => s.status === "completed")).toBe(true);

    const [wo] = await withTenant(TENANT_ID, (db) => db.select().from(workOrders).where(eq(workOrders.householdId, hh!.id)));
    expect(wo).toBeTruthy();
    expect(wo!.type).toBe("install");
    const [depositPayment] = await withTenant(TENANT_ID, (db) => db.select().from(payments).where(eq(payments.invoiceId, invoiceId)));
    expect(depositPayment).toBeTruthy();
    expect(depositPayment!.amountUsd).toBe("150.00");

    await cleanWorkflowRun(workflowRunId, commandId);
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(payments).where(eq(payments.invoiceId, invoiceId));
      await db.delete(workOrders).where(eq(workOrders.id, wo!.id));
      await db.delete(invoices).where(eq(invoices.id, invoiceId));
      await db.delete(quotes).where(eq(quotes.id, quote!.id));
      await db.delete(households).where(eq(households.id, hh!.id));
    });
  });

  it("workflow 4 (invoice to cash): payment link + delivery + QBO sync complete, and a real payment webhook marks the invoice paid — idempotently", async () => {
    resetAccountingEmulator();
    const [hh] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "4 Phase4 W4 Ln", contactInfo: { name: "W4 Test", phone: "+15555550122" } }).returning(),
    );
    const [inv] = await withTenant(TENANT_ID, (db) => db.insert(invoices).values({ tenantId: TENANT_ID, householdId: hh!.id, amountUsd: "300.00", status: "sent" }).returning());

    const draft = await invoiceToCashPlugin.draft("start_invoice_to_cash_workflow", { invoiceId: inv!.id }, policy());
    const result = await invoiceToCashPlugin.execute(draft, undefined as never);
    expect(result.status).toBe("success");
    const { workflowRunId, commandId } = result.output as { workflowRunId: string; commandId: string };

    const steps = await driveToCompletion(workflowRunId);
    expect(steps.map((s) => s.stepType)).toEqual(["create_payment_link", "send_message", "sync_invoice"]);
    expect(steps.every((s) => s.status === "completed")).toBe(true);

    // Derived from the freshly-created invoice id (not a hardcoded literal) — a second
    // run of this test must not collide with a prior run's inbox_events row, which has
    // a UNIQUE(provider, event_id) constraint.
    const providerEventId = `evt-phase4-payment-${inv!.id}`;
    // Correlates to the create_payment_link step, so a legitimate payment registers as
    // "matched" rather than opening a spurious reconciliation_case.
    const paymentLinkStepId = steps.find((s) => s.stepType === "create_payment_link")!.id;
    const first = await applyPaymentWebhookEvent({ tenantId: TENANT_ID, invoiceId: inv!.id, providerEventId, amountUsd: 300, status: "succeeded", matchStepId: paymentLinkStepId });
    expect(first.applied).toBe(true);
    const second = await applyPaymentWebhookEvent({ tenantId: TENANT_ID, invoiceId: inv!.id, providerEventId, amountUsd: 300, status: "succeeded", matchStepId: paymentLinkStepId });
    expect(second.applied).toBe(false);

    const [invAfter] = await withTenant(TENANT_ID, (db) => db.select().from(invoices).where(eq(invoices.id, inv!.id)));
    expect(invAfter!.status).toBe("paid");
    const paymentRows = await withTenant(TENANT_ID, (db) => db.select().from(payments).where(eq(payments.invoiceId, inv!.id)));
    expect(paymentRows).toHaveLength(1); // never duplicated by the replayed webhook

    await cleanWorkflowRun(workflowRunId, commandId);
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(payments).where(eq(payments.invoiceId, inv!.id));
      await db.delete(invoices).where(eq(invoices.id, inv!.id));
      await db.delete(households).where(eq(households.id, hh!.id));
    });
  });
});
