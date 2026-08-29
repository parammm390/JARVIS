import { households, proposals, quotes, quoteLineItems, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
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
  provenance?: { sourceSystem: string; externalId: string; createdBy?: string };
}

export async function createQuote(db: Db, params: CreateQuoteParams): Promise<{ quoteId: string; totalUsd: number; alreadyExisted: boolean }> {
  if (params.provenance) {
    const [existing] = await db.select().from(quotes).where(and(
      eq(quotes.tenantId, params.tenantId),
      eq(quotes.sourceSystem, params.provenance.sourceSystem),
      eq(quotes.externalId, params.provenance.externalId),
    )).limit(1);
    if (existing) return { quoteId: existing.id, totalUsd: Number(existing.totalUsd ?? 0), alreadyExisted: true };
  }
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
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
      createdBy: params.provenance?.createdBy ?? null,
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

  return { quoteId: quote!.id, totalUsd: total, alreadyExisted: false };
}

export async function markQuoteSent(db: Db, params: { tenantId: string; quoteId: string }): Promise<void> {
  await db.update(quotes).set({ status: "sent" }).where(and(eq(quotes.tenantId, params.tenantId), eq(quotes.id, params.quoteId)));
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "quote",
    entityId: params.quoteId,
    eventType: "quote_sent",
  });
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";

export async function setQuoteStatus(
  db: Db,
  params: { tenantId: string; quoteId: string; status: QuoteStatus; eventPayload?: Record<string, unknown> },
): Promise<typeof quotes.$inferSelect | null> {
  const [quote] = await db.update(quotes).set({ status: params.status }).where(and(
    eq(quotes.tenantId, params.tenantId), eq(quotes.id, params.quoteId),
  )).returning();
  if (!quote) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "quote",
    entityId: params.quoteId,
    eventType: `quote_${params.status}`,
    payload: params.eventPayload ?? {},
  });
  return quote;
}

export async function createProposal(
  db: Db,
  params: {
    tenantId: string;
    householdId: string;
    content: Record<string, unknown>;
    status?: string;
    sentAt?: Date | null;
    quoteId?: string | null;
    eventType?: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<typeof proposals.$inferSelect> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId), eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Proposal household does not belong to this tenant");
  if (params.quoteId) {
    const [quote] = await db.select({ id: quotes.id }).from(quotes).where(and(
      eq(quotes.tenantId, params.tenantId), eq(quotes.id, params.quoteId),
    )).limit(1);
    if (!quote) throw new Error("Proposal quote does not belong to this tenant");
  }
  const [proposal] = await db.insert(proposals).values({
    tenantId: params.tenantId,
    householdId: params.householdId,
    content: params.content,
    status: params.status ?? "draft",
    sentAt: params.sentAt ?? null,
    quoteId: params.quoteId ?? null,
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "proposal",
    entityId: proposal!.id,
    eventType: params.eventType ?? "proposal_created",
    payload: params.eventPayload ?? {},
  });
  return proposal!;
}

export async function setProposalStatus(
  db: Db,
  params: { tenantId: string; proposalId: string; status: string; sentAt?: Date | null; eventType?: string; eventPayload?: Record<string, unknown> },
): Promise<typeof proposals.$inferSelect | null> {
  const [proposal] = await db.update(proposals).set({
    status: params.status,
    ...(params.sentAt !== undefined ? { sentAt: params.sentAt } : {}),
  }).where(and(eq(proposals.tenantId, params.tenantId), eq(proposals.id, params.proposalId))).returning();
  if (!proposal) return null;
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "proposal",
    entityId: params.proposalId,
    eventType: params.eventType ?? "proposal_status_changed",
    payload: { status: params.status, ...(params.eventPayload ?? {}) },
  });
  return proposal;
}
