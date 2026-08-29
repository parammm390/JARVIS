// Inventory/procurement capability contract (Phase 3 domain 4 of 5) — genuinely
// greenfield: no external SaaS exists, and unlike scheduling there's no existing
// native reserve/receive code to rebind either (warehouses/warehouse_stock/
// procurement_orders, added in Phase 1, are 100% unused until this file). Both the
// emulator AND this native binding are new. The single-location `inventory_items`
// table used by packages/domain-plugins/inventory/index.ts is untouched — Phase 1's
// own schema comment already defers that consolidation as future work.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant, warehouses, warehouseStock } from "@finnor/db";
import { adjustWarehouseStock, ensureDefaultWarehouse, receiveProcurement } from "@finnor/data-platform";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import {
  emulatorReserveStock,
  emulatorReleaseReservation,
  emulatorReceiveProcurement,
  type ReserveStockInput,
  type ReserveStockOutput,
  type ReceiveProcurementInput,
  type ReceiveProcurementOutput,
} from "../emulators/inventory-emulator";

export type { ReserveStockInput, ReserveStockOutput, ReceiveProcurementInput, ReceiveProcurementOutput };

export const ReserveStockInputSchema = z.object({
  tenantId: z.string().uuid(),
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});
export const ReserveStockOutputSchema = z.object({ reserved: z.literal(true), reservationId: z.string(), remaining: z.number() });

export const ReceiveProcurementInputSchema = z.object({
  tenantId: z.string().uuid(),
  sku: z.string().min(1),
  quantityOrdered: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});
export const ReceiveProcurementOutputSchema = z.object({
  procurementOrderId: z.string(),
  status: z.literal("received"),
  newQuantity: z.number(),
});

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200, timeoutMs: 8_000 };

// --- reserve_stock ---------------------------------------------------------------

export const reserveStockContract: CapabilityContract<ReserveStockInput, ReserveStockOutput> = {
  domain: "inventory",
  capability: "reserve_stock",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "inventory:reserve_stock",
  piiAllowlist: ["sku", "quantity"],
  // A crash after the decrement commits but before we recorded it must never be
  // auto-retried — a blind retry could double-decrement (reserve the same stock twice).
  retryOnUnknown: false,
};

export const reserveStockEmulatorBinding: CapabilityBinding<ReserveStockInput, ReserveStockOutput> = {
  name: "emulator",
  call: emulatorReserveStock,
  compensate: emulatorReleaseReservation,
};

export const reserveStockNativeBinding: CapabilityBinding<ReserveStockInput, ReserveStockOutput> = {
  name: "native",
  async call(input) {
    return withTenant(input.tenantId, async (db) => {
      const warehouseId = await ensureDefaultWarehouse(db, input.tenantId);
      const updated = await adjustWarehouseStock(db, {
        tenantId: input.tenantId,
        warehouseId,
        sku: input.sku,
        delta: -input.quantity,
        eventType: "stock_reserved",
        eventPayload: { quantity: input.quantity },
      });
      return { reserved: true as const, reservationId: updated.id, remaining: updated.quantity };
    });
  },
  async compensate(input, output) {
    await withTenant(input.tenantId, async (db) => {
      const warehouseId = await ensureDefaultWarehouse(db, input.tenantId);
      await adjustWarehouseStock(db, {
        tenantId: input.tenantId,
        warehouseId,
        sku: input.sku,
        delta: input.quantity,
        eventType: "stock_reservation_released",
        eventPayload: { quantity: input.quantity, reservationId: output.reservationId },
      });
    });
  },
};

// --- receive_procurement -----------------------------------------------------------

export const receiveProcurementContract: CapabilityContract<ReceiveProcurementInput, ReceiveProcurementOutput> = {
  domain: "inventory",
  capability: "receive_procurement",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "inventory:receive_procurement",
  piiAllowlist: ["sku", "quantityOrdered"],
  retryOnUnknown: false,
};

export const receiveProcurementEmulatorBinding: CapabilityBinding<ReceiveProcurementInput, ReceiveProcurementOutput> = {
  name: "emulator",
  call: emulatorReceiveProcurement,
};

export const receiveProcurementNativeBinding: CapabilityBinding<ReceiveProcurementInput, ReceiveProcurementOutput> = {
  name: "native",
  async call(input) {
    return withTenant(input.tenantId, async (db) => {
      const { order, stock } = await receiveProcurement(db, input);
      return { procurementOrderId: order.id, status: "received" as const, newQuantity: stock.quantity };
    });
  },
};
