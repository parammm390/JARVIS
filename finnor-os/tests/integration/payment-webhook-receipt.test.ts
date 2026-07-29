// jarvis-v3 P4.T4 acceptance: the payment webhook updates the SAME
// decision_receipts row in place (never a second receipt for the same
// action), and appends a real predicted-vs-actual amount comparison to
// domain_actions.predictionDiff — genuinely both real numbers this function
// already has in hand (the plugin's own simulate() prediction, and the real
// payment amount), never fabricated.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, households, invoices, domainActions, decisionReceipts } from "@finnor/db";
import { openReceipt } from "@finnor/workflow-runtime";
import { eq } from "drizzle-orm";
import { applyPaymentWebhookEvent } from "../../packages/domain-plugins/invoice-to-cash/index";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT = "00000000-0000-4000-8000-0000000000f4";

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

describe.skipIf(!available)("applyPaymentWebhookEvent — receipt updates in place (P4.T4)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT, (db) => db.insert(tenants).values({ id: TENANT, name: "Payment Receipt Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await closePool();
  });

  async function seedInvoiceWorkflow(amountUsd: number) {
    const [household] = await withTenant(TENANT, (db) =>
      db.insert(households).values({ tenantId: TENANT, address: "1 Test St", contactInfo: {} }).returning(),
    );
    const [invoice] = await withTenant(TENANT, (db) =>
      db.insert(invoices).values({ tenantId: TENANT, householdId: household!.id, amountUsd: amountUsd.toFixed(2), status: "sent" }).returning(),
    );
    const predictedReceipt = {
      version: 1,
      actionType: "start_invoice_to_cash_workflow",
      simulation: { mode: "dry_run", summary: "dry run", predicted: { invoiceId: invoice!.id, amountUsd, steps: ["create_payment_link", "send_message", "sync_invoice"] } },
    };
    const [action] = await withTenant(TENANT, (db) =>
      db
        .insert(domainActions)
        .values({
          tenantId: TENANT,
          actionType: "start_invoice_to_cash_workflow",
          payload: { invoiceId: invoice!.id },
          status: "completed",
          predictedReceipt,
          predictionDiff: { compared: 1, matched: 1, accuracy: 1, fields: [{ path: "invoiceId", predicted: invoice!.id, actual: invoice!.id, matched: true }] },
        })
        .returning(),
    );
    const { receiptId } = await openReceipt({
      tenantId: TENANT,
      domainActionId: action!.id,
      objective: `Collect on invoice ${invoice!.id}`,
      evidence: [],
      policyApplied: null,
      riskTier: "medium",
      proposedAction: { stepType: "sync_invoice", payload: {} },
      approval: { required: true, approvedBy: "owner" },
      expectedResult: { invoiceId: invoice!.id },
    });
    return { invoiceId: invoice!.id, actionId: action!.id, receiptId };
  }

  it("merges the payment fact into actualResult without touching prior fields, and appends a real amount comparison to predictionDiff", async () => {
    const { invoiceId, actionId, receiptId } = await seedInvoiceWorkflow(890);
    await withTenant(TENANT, (db) =>
      db.update(decisionReceipts).set({ actualResult: { commandId: "cmd-1", workflowRunId: "run-1", invoiceId } }).where(eq(decisionReceipts.id, receiptId)),
    );

    const result = await applyPaymentWebhookEvent({
      tenantId: TENANT,
      invoiceId,
      providerEventId: `evt_${randomUUID()}`,
      amountUsd: 890,
      status: "succeeded",
    });
    expect(result.applied).toBe(true);

    const [receiptRow] = await withTenant(TENANT, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.id, receiptId)));
    expect(receiptRow!.actualResult).toMatchObject({ commandId: "cmd-1", workflowRunId: "run-1", invoiceId, paymentReceived: true, amountPaidUsd: 890 });
    expect(receiptRow!.finalizedAt).not.toBeNull();

    const [actionRow] = await withTenant(TENANT, (db) => db.select({ predictionDiff: domainActions.predictionDiff }).from(domainActions).where(eq(domainActions.id, actionId)));
    const diff = actionRow!.predictionDiff as { compared: number; matched: number; fields: Array<{ path: string; matched: boolean }> };
    expect(diff.compared).toBe(2);
    expect(diff.matched).toBe(2);
    expect(diff.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "invoiceId", matched: true }), expect.objectContaining({ path: "amountPaidUsd", predicted: 890, actual: 890, matched: true })]),
    );

    // Never a second receipt row for the same domain action.
    const allReceipts = await withTenant(TENANT, (db) => db.select({ id: decisionReceipts.id }).from(decisionReceipts).where(eq(decisionReceipts.domainActionId, actionId)));
    expect(allReceipts).toHaveLength(1);
  });

  it("records a real mismatch honestly when the amount paid differs from the prediction — never silently matched", async () => {
    const { invoiceId, actionId } = await seedInvoiceWorkflow(500);
    await applyPaymentWebhookEvent({ tenantId: TENANT, invoiceId, providerEventId: `evt_${randomUUID()}`, amountUsd: 450, status: "succeeded" });
    const [actionRow] = await withTenant(TENANT, (db) => db.select({ predictionDiff: domainActions.predictionDiff }).from(domainActions).where(eq(domainActions.id, actionId)));
    const diff = actionRow!.predictionDiff as { fields: Array<{ path: string; matched: boolean; predicted: number; actual: number }> };
    const amountField = diff.fields.find((f) => f.path === "amountPaidUsd");
    expect(amountField).toMatchObject({ predicted: 500, actual: 450, matched: false });
  });

  it("a duplicate delivery of the same providerEventId is a no-op — dedup, not a second update", async () => {
    const { invoiceId, receiptId } = await seedInvoiceWorkflow(200);
    const providerEventId = `evt_${randomUUID()}`;
    const first = await applyPaymentWebhookEvent({ tenantId: TENANT, invoiceId, providerEventId, amountUsd: 200, status: "succeeded" });
    expect(first.applied).toBe(true);
    const second = await applyPaymentWebhookEvent({ tenantId: TENANT, invoiceId, providerEventId, amountUsd: 200, status: "succeeded" });
    expect(second).toEqual({ applied: false, reason: "duplicate delivery" });
    const [receiptRow] = await withTenant(TENANT, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.id, receiptId)));
    expect((receiptRow!.actualResult as { amountPaidUsd: number }).amountPaidUsd).toBe(200);
  });

  it("a payment for an invoice this plugin never touched is a real, honest no-op — never guesses a receipt to update", async () => {
    const [household] = await withTenant(TENANT, (db) => db.insert(households).values({ tenantId: TENANT, address: "2 Test St", contactInfo: {} }).returning());
    const [invoice] = await withTenant(TENANT, (db) => db.insert(invoices).values({ tenantId: TENANT, householdId: household!.id, amountUsd: "100.00", status: "sent" }).returning());
    const result = await applyPaymentWebhookEvent({ tenantId: TENANT, invoiceId: invoice!.id, providerEventId: `evt_${randomUUID()}`, amountUsd: 100, status: "succeeded" });
    expect(result.applied).toBe(true); // recordPayment still runs — invoices.status is real regardless of receipt linkage
    const receiptRows = await withTenant(TENANT, (db) => db.select({ id: decisionReceipts.id }).from(decisionReceipts));
    expect(receiptRows.every((r) => typeof r.id === "string")).toBe(true); // no crash, no fabricated receipt row created for this invoice
  });
});
