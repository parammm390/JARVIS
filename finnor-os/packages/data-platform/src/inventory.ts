import { inventoryItems, procurementOrders, warehouses, warehouseStock, type Db } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export async function ensureDefaultWarehouse(db: Db, tenantId: string): Promise<string> {
  const [existing] = await db.select({ id: warehouses.id }).from(warehouses).where(and(
    eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true),
  )).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(warehouses).values({ tenantId, name: "Default Warehouse", isDefault: true }).returning();
  await recordBusinessEvent(db, { tenantId, entityType: "warehouse", entityId: created!.id, eventType: "warehouse_created" });
  return created!.id;
}

async function ensureWarehouseStockRow(db: Db, params: { tenantId: string; warehouseId: string; sku: string }): Promise<string> {
  const [warehouse] = await db.select({ id: warehouses.id }).from(warehouses).where(and(
    eq(warehouses.tenantId, params.tenantId), eq(warehouses.id, params.warehouseId),
  )).limit(1);
  if (!warehouse) throw new Error("Warehouse does not belong to this tenant");
  await db.insert(warehouseStock).values({
    tenantId: params.tenantId, warehouseId: params.warehouseId, sku: params.sku, quantity: 0,
  }).onConflictDoNothing();
  const [row] = await db.select({ id: warehouseStock.id }).from(warehouseStock).where(and(
    eq(warehouseStock.tenantId, params.tenantId), eq(warehouseStock.warehouseId, params.warehouseId), eq(warehouseStock.sku, params.sku),
  )).limit(1);
  if (!row) throw new Error("Warehouse stock row could not be created");
  return row.id;
}

export async function adjustWarehouseStock(
  db: Db,
  params: {
    tenantId: string;
    warehouseId: string;
    sku: string;
    delta: number;
    eventType: string;
    eventPayload?: Record<string, unknown>;
  },
): Promise<typeof warehouseStock.$inferSelect> {
  if (!Number.isInteger(params.delta) || params.delta === 0) throw new Error("Warehouse stock delta must be a non-zero integer");
  const stockId = await ensureWarehouseStockRow(db, params);
  const [updated] = await db.update(warehouseStock).set({ quantity: sql`${warehouseStock.quantity} + ${params.delta}` }).where(and(
    eq(warehouseStock.tenantId, params.tenantId),
    eq(warehouseStock.id, stockId),
    sql`${warehouseStock.quantity} + ${params.delta} >= 0`,
  )).returning();
  if (!updated) throw new Error(`insufficient stock for ${params.sku}`);
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "warehouse_stock",
    entityId: updated.id,
    eventType: params.eventType,
    payload: { sku: params.sku, delta: params.delta, remaining: updated.quantity, ...(params.eventPayload ?? {}) },
  });
  return updated;
}

export async function receiveProcurement(
  db: Db,
  params: { tenantId: string; sku: string; quantityOrdered: number },
): Promise<{ order: typeof procurementOrders.$inferSelect; stock: typeof warehouseStock.$inferSelect }> {
  if (!Number.isInteger(params.quantityOrdered) || params.quantityOrdered <= 0) throw new Error("Procurement quantity must be a positive integer");
  const warehouseId = await ensureDefaultWarehouse(db, params.tenantId);
  const stock = await adjustWarehouseStock(db, {
    tenantId: params.tenantId,
    warehouseId,
    sku: params.sku,
    delta: params.quantityOrdered,
    eventType: "warehouse_stock_received",
  });
  const [order] = await db.insert(procurementOrders).values({
    tenantId: params.tenantId,
    warehouseId,
    sku: params.sku,
    quantityOrdered: params.quantityOrdered,
    status: "received",
    receivedAt: new Date(),
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "procurement_order",
    entityId: order!.id,
    eventType: "procurement_received",
    payload: { sku: params.sku, quantityOrdered: params.quantityOrdered, newQuantity: stock.quantity },
  });
  return { order: order!, stock };
}

export async function adjustInventoryItem(
  db: Db,
  params: { tenantId: string; inventoryItemId: string; delta: number; eventType: string; eventPayload?: Record<string, unknown> },
): Promise<typeof inventoryItems.$inferSelect> {
  if (!Number.isInteger(params.delta) || params.delta === 0) throw new Error("Inventory delta must be a non-zero integer");
  const [updated] = await db.update(inventoryItems).set({ quantity: sql`${inventoryItems.quantity} + ${params.delta}` }).where(and(
    eq(inventoryItems.tenantId, params.tenantId),
    eq(inventoryItems.id, params.inventoryItemId),
    sql`${inventoryItems.quantity} + ${params.delta} >= 0`,
  )).returning();
  if (!updated) throw new Error("Inventory item is missing or has insufficient stock");
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "inventory_item",
    entityId: updated.id,
    eventType: params.eventType,
    payload: { delta: params.delta, remaining: updated.quantity, ...(params.eventPayload ?? {}) },
  });
  return updated;
}

export async function createInventoryItem(
  db: Db,
  params: { tenantId: string; sku: string; name: string; quantity: number; reorderThreshold: number; unitCostUsd?: number | null; source?: string },
): Promise<typeof inventoryItems.$inferSelect> {
  if (![params.quantity, params.reorderThreshold].every(Number.isInteger) || params.quantity < 0 || params.reorderThreshold < 0) {
    throw new Error("Inventory quantities must be non-negative integers");
  }
  const [existing] = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.tenantId, params.tenantId), eq(inventoryItems.sku, params.sku),
  )).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(inventoryItems).values({
    tenantId: params.tenantId,
    sku: params.sku,
    name: params.name,
    quantity: params.quantity,
    reorderThreshold: params.reorderThreshold,
    unitCostUsd: params.unitCostUsd == null ? null : params.unitCostUsd.toFixed(2),
  }).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "inventory_item",
    entityId: created!.id,
    eventType: "inventory_item_created",
    source: params.source ?? "inventory",
  });
  return created!;
}

/** Reconcile descriptive fields while deliberately preserving on-hand quantity. */
export async function reconcileInventoryItemMetadata(
  db: Db,
  params: { tenantId: string; sku: string; name: string; reorderThreshold: number; unitCostUsd?: number | null; source?: string },
): Promise<typeof inventoryItems.$inferSelect | null> {
  if (!Number.isInteger(params.reorderThreshold) || params.reorderThreshold < 0) {
    throw new Error("Inventory reorder threshold must be a non-negative integer");
  }
  const [current] = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.tenantId, params.tenantId), eq(inventoryItems.sku, params.sku),
  )).limit(1);
  if (!current) return null;
  const unitCostUsd = params.unitCostUsd == null ? null : params.unitCostUsd.toFixed(2);
  if (current.name === params.name && current.reorderThreshold === params.reorderThreshold && current.unitCostUsd === unitCostUsd) return current;
  const [updated] = await db.update(inventoryItems).set({
    name: params.name,
    reorderThreshold: params.reorderThreshold,
    unitCostUsd,
  }).where(and(eq(inventoryItems.tenantId, params.tenantId), eq(inventoryItems.id, current.id))).returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "inventory_item",
    entityId: current.id,
    eventType: "inventory_item_metadata_reconciled",
    payload: { sku: params.sku },
    source: params.source ?? "inventory",
  });
  return updated ?? null;
}
