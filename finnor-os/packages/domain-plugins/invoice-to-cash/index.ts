// Vertical workflow 4 (Phase 4, docs/jarvis-90-execution-blueprint.md §4.4): invoice
// to cash. Invoicing/reminders/QBO sync were already real (accounting plugin, Phase
// 1/3). The entire payment-collection loop (link, webhook, reconciliation) was
// missing — this plugin is its first real caller, built directly on
// @finnor/workflow-runtime's inbox_events/reconciliation_cases machinery (Phase 2),
// which existed but had no real payment-domain caller until now.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, invoices, households, domainActions, decisionReceipts, ingestIntegrationEventTx } from "@finnor/db";
import { submitCommand, receiveInboxEventTx, finalizeReceipt } from "@finnor/workflow-runtime";
import { recordPayment } from "@finnor/data-platform";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const StartInvoiceToCashSchema = z.object({
  invoiceId: z.string().uuid(),
  contactId: opt(z.string()), // household id, or an external CRM contact id
  channel: z.enum(["sms", "email"]).default("sms"),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  start_invoice_to_cash_workflow: StartInvoiceToCashSchema,
};

export const invoiceToCashPlugin: DomainEnginePlugin = {
  name: "invoice-to-cash",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = StartInvoiceToCashSchema.parse(payload);
    return {
      actionType,
      summary: `Create a payment link for invoice ${p.invoiceId.slice(0, 8)}, text/email it to the customer, and sync to QuickBooks.`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async simulate(actionType, payload, policy) {
    const p = StartInvoiceToCashSchema.parse(payload);
    const [invoice] = await withTenant(policy.tenantId, (db) => db.select().from(invoices).where(eq(invoices.id, p.invoiceId)));
    return {
      mode: "dry_run" as const,
      summary: invoice
        ? `Dry run: payment-link, delivery, and accounting-sync steps would be queued for $${invoice.amountUsd}; no command or payment link was created.`
        : "Dry run: the invoice was not found, so no payment-collection workflow is predicted.",
      predicted: {
        invoiceId: p.invoiceId,
        invoiceFound: Boolean(invoice),
        amountUsd: invoice ? Number(invoice.amountUsd) : null,
        fieldChanges: invoice ? [{ field: "workflow", from: null, to: "invoice_to_cash" }] : [],
        steps: invoice ? ["create_payment_link", "send_message", "sync_invoice"] : [],
        expectedResult: invoice ? { invoiceId: p.invoiceId } : undefined,
      },
    };
  },

  async execute(draft: DraftAction, _tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;
    const invoiceId = String(p.invoiceId);
    const result = await startInvoiceToCash(tenantId, {
      invoiceId,
      contactId: p.contactId ? String(p.contactId) : undefined,
      channel: (p.channel as "sms" | "email" | undefined) ?? "sms",
      correlationId: draft.correlationId,
      domainActionId: draft.domainActionId,
      businessEffectId: draft.businessEffect?.id,
      authorizedEffectHash: draft.businessEffect?.semanticHash,
      authorityDecisionId: draft.authorityDecisionId,
      authorityRevision: draft.authorityRevision,
      policyId: draft.businessEffect?.authority.policyId ?? undefined,
      policyVersion: draft.businessEffect?.authority.policyVersion ?? undefined,
      executionClass: draft.businessEffect?.operation.class,
    });
    if (!result.ok) return { status: "failure", output: {}, error: result.error, errorKind: "validation" };
    return {
      status: "success",
      output: { commandId: result.commandId, workflowRunId: result.workflowRunId, invoiceId },
      expected: { started: true },
    };
  },
};

/**
 * Submits the invoice-to-cash command graph for an already-existing invoice — the
 * reusable core of this plugin's execute(), extracted so other callers (workflow 5's
 * recurring-revenue scan) can start the same real workflow without duplicating its
 * step list. Idempotent by invoiceId, same as the plugin's own idempotencyKey.
 */
export async function startInvoiceToCash(
  tenantId: string,
  params: {
    invoiceId: string;
    contactId?: string;
    channel?: "sms" | "email";
    correlationId?: string;
    domainActionId?: string;
    businessEffectId?: string;
    authorizedEffectHash?: string;
    authorityDecisionId?: string;
    authorityRevision?: number;
    policyId?: string;
    policyVersion?: number;
    executionClass?: string;
  },
): Promise<{ ok: true; commandId: string; workflowRunId: string } | { ok: false; error: string }> {
  const invoiceId = params.invoiceId;
  const invoice = await withTenant(tenantId, async (db) => {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    return row ?? null;
  });
  if (!invoice) return { ok: false, error: "That invoice doesn't exist." };

  const household = await withTenant(tenantId, async (db) => {
    const [row] = await db.select().from(households).where(eq(households.id, invoice.householdId));
    return row ?? null;
  });
  const contact = (household?.contactInfo ?? {}) as Record<string, unknown>;
  const contactId = params.contactId ?? invoice.householdId;
  const channel = params.channel ?? "sms";

  const idempotencyKey = `invoice-to-cash:${invoiceId}`;
  const submitted = await withTenant(tenantId, (db) =>
    submitCommand(db, {
      businessEffectId: params.businessEffectId,
      authorizedEffectHash: params.authorizedEffectHash,
      authorityDecisionId: params.authorityDecisionId,
      authorityRevision: params.authorityRevision,
      policyId: params.policyId,
      policyVersion: params.policyVersion,
      executionClass: params.executionClass,
      tenantId,
      commandType: "start_invoice_to_cash_workflow",
      payload: { invoiceId },
      workflowType: "invoice_to_cash",
      idempotencyKey,
      correlationId: params.correlationId,
      domainActionId: params.domainActionId,
      steps: [
        {
          stepType: "create_payment_link",
          payload: { tenantId, invoiceId, amountUsd: Number(invoice.amountUsd), idempotencyKey: `${idempotencyKey}:link` },
        },
        {
          stepType: "send_message",
          payload: {
            tenantId,
            contactId,
            channel,
            messageTemplate: `Your invoice for $${invoice.amountUsd} is ready. Pay securely here: {{paymentLinkUrl}}`,
            idempotencyKey: `${idempotencyKey}:deliver`,
          },
        },
        {
          stepType: "sync_invoice",
          payload: {
            tenantId,
            invoiceId,
            customerName: String(contact.name ?? household?.address ?? "Customer"),
            customerPhone: contact.phone ? String(contact.phone) : undefined,
            amountUsd: Number(invoice.amountUsd),
            memo: invoice.memo ?? undefined,
            idempotencyKey: `${idempotencyKey}:qbo`,
          },
        },
      ],
    }),
  );

  return { ok: true, commandId: submitted.commandId, workflowRunId: submitted.workflowRunId };
}

export default invoiceToCashPlugin;

export type PaymentWebhookStatus = "succeeded" | "failed";

/** Same extraction rule as apps/api/lib/predicted-outcome.ts's extractPredicted
 *  — duplicated rather than imported (that file lives in apps/api, which
 *  depends on this package, never the reverse). */
function extractPredictedAmount(predictedReceipt: unknown): number | null {
  if (!predictedReceipt || typeof predictedReceipt !== "object") return null;
  const simulation = (predictedReceipt as { simulation?: unknown }).simulation;
  if (!simulation || typeof simulation !== "object") return null;
  const predicted = (simulation as { predicted?: unknown }).predicted;
  if (!predicted || typeof predicted !== "object") return null;
  const amountUsd = (predicted as { amountUsd?: unknown }).amountUsd;
  return typeof amountUsd === "number" ? amountUsd : null;
}

interface InvoiceWorkflowRow {
  actionId: string;
  predictedAmountUsd: number | null;
  predictionDiff: unknown;
  receiptId: string | null;
  receiptActualResult: unknown;
}

/**
 * jarvis-v3 P4.T4: the domain_action + receipt this invoice's own
 * invoice-to-cash workflow left behind — the SAME row the Thread's ⑦ block
 * already shows (§6⑦: "the payment webhook lands minutes or hours later. The
 * receipt updates in place"). A domain_action can only ever have one *current*
 * start_invoice_to_cash_workflow run per invoice (submitCommand's own
 * idempotencyKey is `invoice-to-cash:{invoiceId}` — startInvoiceToCash above),
 * so the most recent one really is "the" run; its most recent receipt (same
 * "order desc, keep first seen" pattern GET /api/actions/pending already uses
 * for the identical ambiguity) is the one the webhook updates. Returns null
 * rather than guessing when no matching action exists yet — a payment for an
 * invoice this plugin never touched is real, honest, and out of scope here.
 */
async function findInvoiceWorkflowRow(tenantId: string, invoiceId: string): Promise<InvoiceWorkflowRow | null> {
  return withTenant(tenantId, async (db) => {
    const [action] = await db
      .select({ id: domainActions.id, predictedReceipt: domainActions.predictedReceipt, predictionDiff: domainActions.predictionDiff })
      .from(domainActions)
      .where(
        and(
          eq(domainActions.tenantId, tenantId),
          eq(domainActions.actionType, "start_invoice_to_cash_workflow"),
          sql`${domainActions.payload} ->> 'invoiceId' = ${invoiceId}`,
        ),
      )
      .orderBy(desc(domainActions.createdAt))
      .limit(1);
    if (!action) return null;
    const [receipt] = await db
      .select({ id: decisionReceipts.id, actualResult: decisionReceipts.actualResult })
      .from(decisionReceipts)
      .where(and(eq(decisionReceipts.tenantId, tenantId), eq(decisionReceipts.domainActionId, action.id)))
      .orderBy(desc(decisionReceipts.createdAt))
      .limit(1);
    return {
      actionId: action.id,
      predictedAmountUsd: extractPredictedAmount(action.predictedReceipt),
      predictionDiff: action.predictionDiff,
      receiptId: receipt?.id ?? null,
      receiptActualResult: receipt?.actualResult ?? null,
    };
  });
}

/**
 * The "payment webhook" + "reconciliation" steps: called from
 * apps/api/app/api/webhooks/payment/route.ts when the payment provider notifies us.
 * Dedups via receiveInboxEvent exactly like the real Vapi/GHL webhook routes, then
 * records the payment and marks the invoice paid on success. No real Stripe-equivalent
 * provider is configured (Phase 3 finding — create_payment_link is emulator-only this
 * phase), so this is invoked with synthetic provider event ids in tests/dev rather
 * than a live signed webhook — the dedup/reconciliation mechanism is identical either
 * way and is what's actually being proven.
 *
 * jarvis-v3 P4.T4: on success, ALSO updates (never duplicates) that invoice's
 * own workflow record in place, two ways:
 *  1. `decision_receipts.actualResult` gets the payment fact merged in via
 *     `finalizeReceipt` — the same function every workflow step's receipt is
 *     closed with, called a second time on the SAME id (its own doc comment
 *     already documents this as safe/idempotent), never a second receipt row.
 *  2. `domain_actions.predictionDiff` gains one more real field comparison —
 *     `amountPaidUsd`: predicted (from the plugin's own `simulate()`, computed
 *     at plan time) vs. actual (this real payment) — genuinely the "predicted
 *     $890, actually paid $890" moat moment, not fabricated: both sides are
 *     real numbers this function already has in hand. Appended to the
 *     existing diff's fields (never replacing the execution-time invoiceId
 *     comparison) and the aggregate compared/matched/accuracy recomputed to
 *     match. Skipped, honestly, when this action never had a real prediction.
 */
export async function applyPaymentWebhookEvent(params: {
  tenantId: string;
  invoiceId: string;
  providerEventId: string;
  amountUsd: number;
  status: PaymentWebhookStatus;
  matchStepId?: string;
}): Promise<{ applied: boolean; reason?: string }> {
  const intake = await withTenant(params.tenantId, async (db) => {
    const received = await receiveInboxEventTx(db, {
      tenantId: params.tenantId,
      provider: "payment_provider",
      eventId: params.providerEventId,
      payload: { invoiceId: params.invoiceId, amountUsd: params.amountUsd, status: params.status },
      matchStepId: params.matchStepId,
    });
    if (received.status === "duplicate") return { duplicate: true } as const;
    if (params.status === "succeeded") {
      await recordPayment(db, {
        tenantId: params.tenantId,
        invoiceId: params.invoiceId,
        amountUsd: params.amountUsd,
        method: "card",
        provenance: { sourceSystem: "payment_provider", externalId: params.providerEventId },
      });
      await ingestIntegrationEventTx(db, {
        tenantId: params.tenantId,
        source: "payment_provider",
        provider: "payment_provider",
        sourceEventId: params.providerEventId,
        eventType: "payment.succeeded",
        resource: { type: "invoice", id: params.invoiceId },
        payload: { status: params.status, amountUsd: params.amountUsd },
        evidenceRefs: [{ type: "inbox_event", id: received.inboxEventId }],
        trustClass: "untrusted_external",
      });
    } else {
      await ingestIntegrationEventTx(db, {
        tenantId: params.tenantId,
        source: "payment_provider",
        provider: "payment_provider",
        sourceEventId: params.providerEventId,
        eventType: "payment.failed",
        resource: { type: "invoice", id: params.invoiceId },
        payload: { status: params.status, amountUsd: params.amountUsd },
        evidenceRefs: [{ type: "inbox_event", id: received.inboxEventId }],
        trustClass: "untrusted_external",
      });
    }
    return { duplicate: false } as const;
  });
  if (intake.duplicate) return { applied: false, reason: "duplicate delivery" };

  if (params.status === "succeeded") {
    const workflow = await findInvoiceWorkflowRow(params.tenantId, params.invoiceId);
    if (workflow?.receiptId) {
      const priorActual =
        workflow.receiptActualResult && typeof workflow.receiptActualResult === "object" ? (workflow.receiptActualResult as Record<string, unknown>) : {};
      await finalizeReceipt(params.tenantId, workflow.receiptId, {
        actualResult: { ...priorActual, paymentReceived: true, amountPaidUsd: params.amountUsd, paidAt: new Date().toISOString() },
      });
    }
    if (workflow && workflow.predictedAmountUsd !== null) {
      const priorDiff =
        workflow.predictionDiff && typeof workflow.predictionDiff === "object"
          ? (workflow.predictionDiff as { compared?: number; matched?: number; fields?: unknown[] })
          : { compared: 0, matched: 0, fields: [] };
      const priorFields = Array.isArray(priorDiff.fields) ? priorDiff.fields : [];
      const paymentMatched = workflow.predictedAmountUsd === params.amountUsd;
      const fields = [...priorFields, { path: "amountPaidUsd", predicted: workflow.predictedAmountUsd, actual: params.amountUsd, matched: paymentMatched }];
      const matched = (priorDiff.matched ?? 0) + (paymentMatched ? 1 : 0);
      const compared = (priorDiff.compared ?? 0) + 1;
      await withTenant(params.tenantId, (db) =>
        db
          .update(domainActions)
          .set({ predictionDiff: { compared, matched, accuracy: compared > 0 ? matched / compared : null, fields } })
          .where(and(eq(domainActions.tenantId, params.tenantId), eq(domainActions.id, workflow.actionId))),
      );
    }
  }

  return { applied: true };
}
