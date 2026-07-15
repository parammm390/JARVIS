// Stateful local inventory/procurement emulator — no external SaaS exists for this
// domain (confirmed: no Cin7/NetSuite/etc. anywhere in the repo), and unlike
// scheduling, there's no existing native reserve/receive code to base the emulator's
// shape on either — this models the warehouse_stock/procurement_orders semantics from
// scratch: reserve-then-commit, receive increments stock.

import { makeFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface ReserveStockInput {
  tenantId: string;
  sku: string;
  quantity: number;
  idempotencyKey: string;
}
export interface ReserveStockOutput {
  reserved: true;
  reservationId: string;
  remaining: number;
}

export interface ReceiveProcurementInput {
  tenantId: string;
  sku: string;
  quantityOrdered: number;
  idempotencyKey: string;
}
export interface ReceiveProcurementOutput {
  procurementOrderId: string;
  status: "received";
  newQuantity: number;
}

const stockBySku = new Map<string, number>();
const reservations = new Map<string, ReserveStockOutput>();
const receipts = new Map<string, ReceiveProcurementOutput>();

let injectFaults = makeFaultInjector();

export function configureInventoryEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function resetInventoryEmulator(): void {
  stockBySku.clear();
  reservations.clear();
  receipts.clear();
  injectFaults = makeFaultInjector();
}

export function seedEmulatorStock(sku: string, quantity: number): void {
  stockBySku.set(sku, quantity);
}

export function getEmulatorStock(sku: string): number {
  return stockBySku.get(sku) ?? 0;
}

export async function emulatorReserveStock(input: ReserveStockInput): Promise<ReserveStockOutput> {
  await injectFaults();
  const existing = reservations.get(input.idempotencyKey);
  if (existing) return existing;
  const current = stockBySku.get(input.sku) ?? 0;
  if (current < input.quantity) throw new Error(`insufficient stock for ${input.sku}: have ${current}, need ${input.quantity}`);
  const remaining = current - input.quantity;
  stockBySku.set(input.sku, remaining);
  const result: ReserveStockOutput = { reserved: true, reservationId: input.idempotencyKey, remaining };
  reservations.set(input.idempotencyKey, result);
  return result;
}

export async function emulatorReleaseReservation(input: ReserveStockInput, output: ReserveStockOutput): Promise<void> {
  const current = stockBySku.get(input.sku) ?? 0;
  stockBySku.set(input.sku, current + input.quantity);
  reservations.delete(output.reservationId);
}

export async function emulatorReceiveProcurement(input: ReceiveProcurementInput): Promise<ReceiveProcurementOutput> {
  await injectFaults();
  const existing = receipts.get(input.idempotencyKey);
  if (existing) return existing;
  const newQuantity = (stockBySku.get(input.sku) ?? 0) + input.quantityOrdered;
  stockBySku.set(input.sku, newQuantity);
  const result: ReceiveProcurementOutput = { procurementOrderId: input.idempotencyKey, status: "received", newQuantity };
  receipts.set(input.idempotencyKey, result);
  return result;
}
