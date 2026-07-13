// Accounting domain plugin — REAL, native ledger: invoices live in Finnor's database,
// always the system of record. If QuickBooks is connected (packages/tools/src/quickbooks.ts),
// a fire-and-forget async sync job is queued after every native write — never inline,
// never a dependency this plugin's own success waits on. Amounts always come from the
// caller or policy — never guessed.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { VOICE_PERSONAS } from "@finnor/tools";
import { withTenant, invoices, communicationsLog, enqueueJob } from "@finnor/db";
import { findHousehold } from "../shared/db-helpers";
import { eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const CreateInvoiceSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  customerName: opt(z.string()), // "the Petersons", "Marcus Webb" — no phone in hand is the common case
  amountUsd: z.number().positive().max(1_000_000),
  memo: opt(z.string().max(500)),
  dueDate: opt(z.string()),
});
export const PaymentReminderSchema = z.object({
  invoiceId: z.string().uuid(),
  channel: opt(z.enum(["auto", "call"])), // "auto" = email/SMS as today; "call" = real voice call
});
export const RecordPaymentSchema = z.object({ invoiceId: z.string().uuid() });
export const CallOverdueInvoicesSchema = z.object({});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_invoice: CreateInvoiceSchema,
  send_payment_reminder: PaymentReminderSchema,
  record_payment: RecordPaymentSchema,
  call_overdue_invoices: CallOverdueInvoicesSchema,
};

export const accountingPlugin: DomainEnginePlugin = {
  name: "accounting",
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

  async draft(actionType, payload, policy: DomainPolicy): Promise<DraftAction> {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;

    if (actionType === "call_overdue_invoices") {
      const overdue = await withTenant(policy.tenantId, (db) =>
        db.select().from(invoices).where(or(eq(invoices.status, "overdue"), eq(invoices.status, "sent"))),
      );
      return {
        actionType,
        summary:
          overdue.length === 0
            ? "No overdue or unpaid invoices right now — nothing to call about."
            : `Place a real payment-reminder call to ${overdue.length} customer${overdue.length === 1 ? "" : "s"} with an unpaid invoice, totaling $${overdue.reduce((s, i) => s + Number(i.amountUsd), 0).toFixed(2)}. Approve to call all?`,
        payload: { tenantId: policy.tenantId, invoiceIds: overdue.map((i) => i.id) },
        requiresConfirmation: true, // real outbound calls, always gated
      };
    }

    const summaries: Record<string, string> = {
      create_invoice: `Create a $${p.amountUsd} invoice for ${p.customerName ?? p.phone ?? p.householdId ?? "the customer named"}${p.memo ? ` — ${p.memo}` : ""}.`,
      send_payment_reminder: `Send a payment reminder for invoice ${String(p.invoiceId).slice(0, 8)}${p.channel === "call" ? " by real phone call" : ""}.`,
      record_payment: `Mark invoice ${String(p.invoiceId).slice(0, 8)} as paid.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const p = draft.payload;

    if (draft.actionType === "create_invoice") {
      const hh = await findHousehold(tenantId, {
        householdId: p.householdId ? String(p.householdId) : undefined,
        phone: p.phone ? String(p.phone) : undefined,
        name: p.customerName ? String(p.customerName) : undefined,
      });
      if (!hh) return { status: "failure", output: {}, error: `No customer found matching "${p.customerName ?? p.phone ?? p.householdId}".` };
      const due = p.dueDate ? new Date(String(p.dueDate)) : new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const inv = await withTenant(tenantId, async (db) => {
        const [row] = await db
          .insert(invoices)
          .values({
            tenantId,
            householdId: hh.id,
            amountUsd: String(p.amountUsd),
            memo: p.memo ? String(p.memo) : null,
            dueDate: Number.isNaN(due.getTime()) ? null : due,
            status: "sent",
          })
          .returning();
        return row!;
      });
      // Fire-and-forget — a QuickBooks outage or missing connection never affects the
      // native invoice's own success; quickbooksSync itself no-ops if unconfigured.
      await enqueueJob("quickbooks_sync", { tenantId, invoiceId: inv.id }, `qbo-sync:${inv.id}`).catch(() => undefined);
      return {
        status: "success",
        output: { invoiceId: inv.id, amountUsd: inv.amountUsd, dueDate: inv.dueDate?.toISOString() ?? null },
        expected: { created: true },
      };
    }

    if (draft.actionType === "call_overdue_invoices") {
      const ids = (p.invoiceIds as string[] | undefined) ?? [];
      if (ids.length === 0) return { status: "success", output: { called: 0 }, expected: { called: 0 } };
      const rows = await withTenant(tenantId, (db) => db.select().from(invoices).where(inArray(invoices.id, ids)));
      let called = 0;
      const failures: string[] = [];
      for (const inv of rows) {
        const hh = await findHousehold(tenantId, { householdId: inv.householdId });
        const contact = (hh?.contactInfo ?? {}) as Record<string, unknown>;
        if (!contact.phone) {
          failures.push(`${inv.id}: no phone on file`);
          continue;
        }
        const firstMessage = `Hi, this is Finnor calling on behalf of your water treatment dealer — you have an invoice for $${inv.amountUsd}${inv.dueDate ? ` that was due ${inv.dueDate.toISOString().slice(0, 10)}` : ""}. Just wanted to give you a quick heads-up.`;
        const call = await tools.call("vapi_place_call", {
          phoneNumber: String(contact.phone),
          instructions: firstMessage,
          tenantId,
          assistantId: VOICE_PERSONAS.payment_collector,
          purpose: "payment_reminder",
        });
        if (call.ok) {
          called++;
          await withTenant(tenantId, (db) =>
            db.insert(communicationsLog).values({ householdId: inv.householdId, channel: "call", direction: "outbound", content: firstMessage }),
          ).catch(() => undefined);
        } else {
          failures.push(`${inv.id}: ${call.error}`);
        }
      }
      if (called === 0 && failures.length > 0) return { status: "integration_unavailable", output: { failures }, error: failures[0] };
      return { status: "success", output: { called, failures }, expected: { called: rows.length } };
    }

    // Remaining actions operate on an existing invoice.
    const inv = await withTenant(tenantId, async (db) => {
      const [row] = await db.select().from(invoices).where(eq(invoices.id, String(p.invoiceId)));
      return row ?? null;
    });
    if (!inv) return { status: "failure", output: {}, error: "That invoice doesn't exist." };

    if (draft.actionType === "record_payment") {
      await withTenant(tenantId, (db) => db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, inv.id)));
      return { status: "success", output: { invoiceId: inv.id, status: "paid" }, expected: { paid: true } };
    }

    // send_payment_reminder: real voice call if requested, else email if the household
    // has one, else SMS (outbox until an SMS carrier is connected). Always logged.
    const hh = await findHousehold(tenantId, { householdId: inv.householdId });
    const contact = (hh?.contactInfo ?? {}) as Record<string, unknown>;
    const message = `Friendly reminder from your water treatment dealer: invoice for $${inv.amountUsd}${inv.memo ? ` (${inv.memo})` : ""} is ${inv.status === "overdue" ? "overdue" : "due"}${inv.dueDate ? ` on ${inv.dueDate.toISOString().slice(0, 10)}` : ""}. Reply or call us with any questions.`;

    let sent = false;
    let channel = "sms";
    if (p.channel === "call") {
      if (!contact.phone) return { status: "failure", output: {}, error: "This customer has no phone on file to call." };
      const r = await tools.call("vapi_place_call", {
        phoneNumber: String(contact.phone),
        instructions: message,
        tenantId,
        assistantId: VOICE_PERSONAS.payment_collector,
        purpose: "payment_reminder",
      });
      sent = r.ok;
      channel = "call";
      if (!r.ok) return { status: "integration_unavailable", output: {}, error: r.error };
    } else if (contact.email) {
      const r = await tools.call("send_email", { to: String(contact.email), subject: "Payment reminder", body: message });
      sent = r.ok;
      channel = "email";
      if (!r.ok) return { status: "integration_unavailable", output: {}, error: r.error };
    } else if (contact.phone) {
      const r = await tools.call("ghl_send_sms", { contactId: hh!.id, message, tenantId });
      sent = r.ok;
      if (!r.ok) return { status: "integration_unavailable", output: {}, error: r.error };
    } else {
      return { status: "failure", output: {}, error: "This customer has no email or phone on file for a reminder." };
    }
    await withTenant(tenantId, (db) =>
      db.insert(communicationsLog).values({ householdId: inv.householdId, channel, direction: "outbound", content: message }),
    ).catch(() => undefined);
    return { status: "success", output: { sent, channel, invoiceId: inv.id }, expected: { sent: true } };
  },
};

export default accountingPlugin;
