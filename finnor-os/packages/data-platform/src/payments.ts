import { payments, invoices, type Db } from "@finnor/db";
import { eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface RecordPaymentParams {
  tenantId: string;
  invoiceId: string;
  amountUsd: number;
  method?: "card" | "ach" | "check" | "cash" | "other";
  provenance?: { sourceSystem: string; externalId?: string; createdBy?: string };
}

// Additive alongside the existing invoices.status column — records the actual payment
// event/method, then marks the invoice paid the same way accounting/index.ts already did.
export async function recordPayment(db: Db, params: RecordPaymentParams): Promise<{ paymentId: string }> {
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

  await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, params.invoiceId));

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "payment",
    entityId: payment!.id,
    eventType: "payment_recorded",
    payload: { invoiceId: params.invoiceId, amountUsd: params.amountUsd },
  });

  return { paymentId: payment!.id };
}
