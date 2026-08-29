import { households, invoices, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export async function createInvoice(
  db: Db,
  params: {
    tenantId: string;
    householdId: string;
    amountUsd: number;
    status?: "draft" | "sent" | "paid" | "overdue" | "void";
    memo?: string | null;
    dueDate?: Date | null;
    eventPayload?: Record<string, unknown>;
  },
): Promise<typeof invoices.$inferSelect> {
  if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0 || Math.abs(params.amountUsd * 100 - Math.round(params.amountUsd * 100)) > 1e-6) {
    throw new Error("Invoice amount must be positive USD with at most two decimal places");
  }
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Invoice household does not belong to this tenant");
  const [invoice] = await db.insert(invoices).values({
    tenantId: params.tenantId,
    householdId: params.householdId,
    amountUsd: params.amountUsd.toFixed(2),
    status: params.status ?? "draft",
    memo: params.memo ?? null,
    dueDate: params.dueDate ?? null,
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "invoice",
    entityId: invoice!.id,
    eventType: "invoice_created",
    payload: { amountUsd: params.amountUsd, status: params.status ?? "draft", ...(params.eventPayload ?? {}) },
  });
  return invoice!;
}

export async function updateInvoiceStatus(
  db: Db,
  params: { tenantId: string; invoiceId: string; status: "draft" | "sent" | "paid" | "overdue" | "void"; eventPayload?: Record<string, unknown> },
): Promise<typeof invoices.$inferSelect | null> {
  const [invoice] = await db.update(invoices).set({ status: params.status }).where(and(
    eq(invoices.tenantId, params.tenantId), eq(invoices.id, params.invoiceId),
  )).returning();
  if (!invoice) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "invoice",
    entityId: params.invoiceId,
    eventType: "invoice_status_changed",
    payload: { status: params.status, ...(params.eventPayload ?? {}) },
  });
  return invoice;
}
