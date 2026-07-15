import { priceBookItems, type Db } from "@finnor/db";
import { and, eq, isNull } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface UpsertPriceBookItemParams {
  tenantId: string;
  sku: string;
  label: string;
  priceUsd: number;
  unitOfMeasure?: string;
}

// Idempotent by (tenant_id, sku) — matches the table's own UNIQUE constraint, so a
// dealer re-entering the same SKU updates the price rather than duplicating the row.
export async function upsertPriceBookItem(
  db: Db,
  params: UpsertPriceBookItemParams,
): Promise<{ itemId: string }> {
  const [row] = await db
    .insert(priceBookItems)
    .values({
      tenantId: params.tenantId,
      sku: params.sku,
      label: params.label,
      priceUsd: params.priceUsd.toFixed(2),
      unitOfMeasure: params.unitOfMeasure ?? "each",
    })
    .onConflictDoUpdate({
      target: [priceBookItems.tenantId, priceBookItems.sku],
      set: {
        label: params.label,
        priceUsd: params.priceUsd.toFixed(2),
        unitOfMeasure: params.unitOfMeasure ?? "each",
        updatedAt: new Date(),
      },
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "price_book_item",
    entityId: row!.id,
    eventType: "price_book_item_upserted",
    payload: { sku: params.sku, priceUsd: params.priceUsd },
  });
  return { itemId: row!.id };
}

export interface PriceBookItem {
  id: string;
  sku: string;
  label: string;
  priceUsd: string;
  unitOfMeasure: string;
}

export async function listPriceBookItems(db: Db, tenantId: string): Promise<PriceBookItem[]> {
  const rows = await db
    .select()
    .from(priceBookItems)
    .where(and(eq(priceBookItems.tenantId, tenantId), isNull(priceBookItems.archivedAt)));
  return rows.map((r) => ({ id: r.id, sku: r.sku, label: r.label, priceUsd: r.priceUsd, unitOfMeasure: r.unitOfMeasure }));
}

export async function findPriceBookItem(db: Db, tenantId: string, sku: string): Promise<PriceBookItem | null> {
  const [row] = await db
    .select()
    .from(priceBookItems)
    .where(and(eq(priceBookItems.tenantId, tenantId), eq(priceBookItems.sku, sku)));
  return row ? { id: row.id, sku: row.sku, label: row.label, priceUsd: row.priceUsd, unitOfMeasure: row.unitOfMeasure } : null;
}
