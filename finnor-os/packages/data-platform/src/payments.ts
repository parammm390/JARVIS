import { payments, invoices, type Db } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface RecordPaymentParams {
  tenantId: string;
  invoiceId: string;
  amountUsd: number;
  method?: "card" | "ach" | "check" | "cash" | "other";
  provenance?: { sourceSystem: string; externalId?: string; createdBy?: string };
}

export interface InvoicePaymentBalance {
  invoiceAmountUsd: number;
  amountPaidUsd: number;
  balanceUsd: number;
  settled: boolean;
}

async function paymentBalanceTx(db: Db, tenantId: string, invoiceId: string): Promise<InvoicePaymentBalance> {
  const [invoice] = await db.select({ id: invoices.id, amountUsd: invoices.amountUsd }).from(invoices).where(and(
    eq(invoices.tenantId, tenantId),
    eq(invoices.id, invoiceId),
  )).limit(1);
  if (!invoice) throw new Error("Payment invoice does not belong to this tenant");
  const [totals] = await db.select({
    netPaidUsd: sql<string>`coalesce(sum(CASE WHEN ${payments.status} = 'succeeded' THEN ${payments.amountUsd} WHEN ${payments.status} = 'refunded' THEN -${payments.amountUsd} ELSE 0 END), 0)::text`,
  }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId)));
  const invoiceCents = Math.round(Number(invoice.amountUsd) * 100);
  const paidCents = Math.round(Number(totals?.netPaidUsd ?? 0) * 100);
  return {
    invoiceAmountUsd: invoiceCents / 100,
    amountPaidUsd: paidCents / 100,
    balanceUsd: Math.max(0, invoiceCents - paidCents) / 100,
    settled: paidCents >= invoiceCents,
  };
}

export async function invoicePaymentBalance(db: Db, params: { tenantId: string; invoiceId: string }): Promise<InvoicePaymentBalance> {
  return paymentBalanceTx(db, params.tenantId, params.invoiceId);
}

// Additive alongside invoices.status: records the payment fact, then closes the
// invoice only when cumulative net succeeded payments cover its canonical amount.
export async function recordPayment(db: Db, params: RecordPaymentParams): Promise<{ paymentId: string } & InvoicePaymentBalance> {
  if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0 || Math.abs(params.amountUsd * 100 - Math.round(params.amountUsd * 100)) > 1e-6) {
    throw new Error("Payment amount must be a positive USD value with at most two decimal places");
  }
  await db.execute(sql`SELECT id FROM ${invoices} WHERE ${invoices.tenantId}=${params.tenantId} AND ${invoices.id}=${params.invoiceId} FOR UPDATE`);
  const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(
    eq(invoices.tenantId, params.tenantId),
    eq(invoices.id, params.invoiceId),
  )).limit(1);
  if (!invoice) throw new Error("Payment invoice does not belong to this tenant");
  const [payment] = await db
    .insert(payments)
    .values({
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      amountUsd: params.amountUsd.toFixed(2),
      method: params.method ?? "other",
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
      createdBy: params.provenance?.createdBy ?? null,
    })
    .returning();

  const balance = await paymentBalanceTx(db, params.tenantId, params.invoiceId);
  if (balance.settled) {
    await db.update(invoices).set({ status: "paid" }).where(and(eq(invoices.tenantId, params.tenantId), eq(invoices.id, params.invoiceId)));
  }

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "payment",
    entityId: payment!.id,
    eventType: "payment_recorded",
    payload: { invoiceId: params.invoiceId, amountUsd: params.amountUsd, amountPaidUsd: balance.amountPaidUsd, balanceUsd: balance.balanceUsd, settled: balance.settled },
  });

  return { paymentId: payment!.id, ...balance };
}
