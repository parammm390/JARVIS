import { quotes, quoteLineItems, type Db } from "@finnor/db";
import { eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface QuoteLineItemInput {
  sku?: string;
  label: string;
  quantity?: number;
  unitPriceUsd: number;
}

export interface CreateQuoteParams {
  tenantId: string;
  householdId?: string;
  leadId?: string;
  opportunityId?: string;
  lineItems: QuoteLineItemInput[];
  validUntil?: Date;
}

export async function createQuote(db: Db, params: CreateQuoteParams): Promise<{ quoteId: string; totalUsd: number }> {
  const total = params.lineItems.reduce((sum, li) => sum + (li.quantity ?? 1) * li.unitPriceUsd, 0);

  const [quote] = await db
    .insert(quotes)
    .values({
      tenantId: params.tenantId,
      householdId: params.householdId ?? null,
      leadId: params.leadId ?? null,
      opportunityId: params.opportunityId ?? null,
      totalUsd: total.toFixed(2),
      validUntil: params.validUntil ?? null,
    })
    .returning();

  for (const li of params.lineItems) {
    await db.insert(quoteLineItems).values({
      tenantId: params.tenantId,
      quoteId: quote!.id,
      sku: li.sku ?? null,
      label: li.label,
      quantity: li.quantity ?? 1,
      unitPriceUsd: li.unitPriceUsd.toFixed(2),
    });
  }

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "quote",
    entityId: quote!.id,
    eventType: "quote_created",
    payload: { totalUsd: total, lineItemCount: params.lineItems.length },
  });

  return { quoteId: quote!.id, totalUsd: total };
}

export async function markQuoteSent(db: Db, params: { tenantId: string; quoteId: string }): Promise<void> {
  await db.update(quotes).set({ status: "sent" }).where(eq(quotes.id, params.quoteId));
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "quote",
    entityId: params.quoteId,
    eventType: "quote_sent",
  });
}
