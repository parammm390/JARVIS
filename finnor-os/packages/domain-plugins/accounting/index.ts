// Accounting domain plugin — REAL, native ledger: invoices live in Finnor's database.
// No QuickBooks-class dependency; an external sync can be added later as an MCP tool
// without touching this plugin. Amounts always come from the caller or policy — never guessed.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, invoices, communicationsLog } from "@finnor/db";
import { findHousehold } from "../shared/db-helpers";
import { eq } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const CreateInvoiceSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  amountUsd: z.number().positive().max(1_000_000),
  memo: opt(z.string().max(500)),
  dueDate: opt(z.string()),
});
export const PaymentReminderSchema = z.object({ invoiceId: z.string().uuid() });
export const RecordPaymentSchema = z.object({ invoiceId: z.string().uuid() });

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_invoice: CreateInvoiceSchema,
  send_payment_reminder: PaymentReminderSchema,
  record_payment: RecordPaymentSchema,
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

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const summaries: Record<string, string> = {
      create_invoice: `Create a $${p.amountUsd} invoice for ${p.phone ?? p.householdId}${p.memo ? ` — ${p.memo}` : ""}.`,
      send_payment_reminder: `Send a payment reminder for invoice ${String(p.invoiceId).slice(0, 8)}.`,
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
      });
      if (!hh) return { status: "failure", output: {}, error: "No customer found for that invoice." };
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
      return {
        status: "success",
        output: { invoiceId: inv.id, amountUsd: inv.amountUsd, dueDate: inv.dueDate?.toISOString() ?? null },
        expected: { created: true },
      };
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

    // send_payment_reminder: email if the household has one, else SMS channel (outbox
    // until an SMS carrier is connected). Always mirrored to the communications log.
    const hh = await findHousehold(tenantId, { householdId: inv.householdId });
    const contact = (hh?.contactInfo ?? {}) as Record<string, unknown>;
    const message = `Friendly reminder from your water treatment dealer: invoice for $${inv.amountUsd}${inv.memo ? ` (${inv.memo})` : ""} is ${inv.status === "overdue" ? "overdue" : "due"}${inv.dueDate ? ` on ${inv.dueDate.toISOString().slice(0, 10)}` : ""}. Reply or call us with any questions.`;

    let sent = false;
    let channel = "sms";
    if (contact.email) {
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
