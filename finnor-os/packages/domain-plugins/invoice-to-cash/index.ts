// Vertical workflow 4 (Phase 4, docs/jarvis-90-execution-blueprint.md §4.4): invoice
// to cash. Invoicing/reminders/QBO sync were already real (accounting plugin, Phase
// 1/3). The entire payment-collection loop (link, webhook, reconciliation) was
// missing — this plugin is its first real caller, built directly on
// @finnor/workflow-runtime's inbox_events/reconciliation_cases machinery (Phase 2),
// which existed but had no real payment-domain caller until now.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, invoices, households } from "@finnor/db";
import { submitCommand, enqueueStep, receiveInboxEvent } from "@finnor/workflow-runtime";
import { recordPayment } from "@finnor/data-platform";
import { eq } from "drizzle-orm";
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

  async execute(draft: DraftAction, _tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;
    const invoiceId = String(p.invoiceId);
    const result = await startInvoiceToCash(tenantId, {
      invoiceId,
      contactId: p.contactId ? String(p.contactId) : undefined,
      channel: (p.channel as "sms" | "email" | undefined) ?? "sms",
      correlationId: draft.correlationId,
    });
    if (!result.ok) return { status: "failure", output: {}, error: result.error };
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
  params: { invoiceId: string; contactId?: string; channel?: "sms" | "email"; correlationId?: string },
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
      tenantId,
      commandType: "start_invoice_to_cash_workflow",
      payload: { invoiceId },
      workflowType: "invoice_to_cash",
      idempotencyKey,
      correlationId: params.correlationId,
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

  if (!submitted.alreadyExisted) {
    await enqueueStep(tenantId, submitted.stepIds[0]!, `${idempotencyKey}:link`);
  }

  return { ok: true, commandId: submitted.commandId, workflowRunId: submitted.workflowRunId };
}

export default invoiceToCashPlugin;

export type PaymentWebhookStatus = "succeeded" | "failed";

/**
 * The "payment webhook" + "reconciliation" steps: called from
 * apps/api/app/api/webhooks/payment/route.ts when the payment provider notifies us.
 * Dedups via receiveInboxEvent exactly like the real Vapi/GHL webhook routes, then
 * records the payment and marks the invoice paid on success. No real Stripe-equivalent
 * provider is configured (Phase 3 finding — create_payment_link is emulator-only this
 * phase), so this is invoked with synthetic provider event ids in tests/dev rather
 * than a live signed webhook — the dedup/reconciliation mechanism is identical either
 * way and is what's actually being proven.
 */
export async function applyPaymentWebhookEvent(params: {
  tenantId: string;
  invoiceId: string;
  providerEventId: string;
  amountUsd: number;
  status: PaymentWebhookStatus;
  matchStepId?: string;
}): Promise<{ applied: boolean; reason?: string }> {
  const received = await receiveInboxEvent({
    tenantId: params.tenantId,
    provider: "payment_provider",
    eventId: params.providerEventId,
    payload: { invoiceId: params.invoiceId, amountUsd: params.amountUsd, status: params.status },
    matchStepId: params.matchStepId,
  });
  if (received.status === "duplicate") return { applied: false, reason: "duplicate delivery" };

  if (params.status === "succeeded") {
    await withTenant(params.tenantId, (db) =>
      recordPayment(db, {
        tenantId: params.tenantId,
        invoiceId: params.invoiceId,
        amountUsd: params.amountUsd,
        method: "card",
        provenance: { sourceSystem: "payment_provider", externalId: params.providerEventId },
      }),
    );
  }

  return { applied: true };
}
