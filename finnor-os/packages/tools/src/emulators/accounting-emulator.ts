// Stateful local accounting emulator — models QuickBooks (sync_invoice) and a generic
// payment-link provider (create_payment_link, no real binding exists yet — Stripe
// integration is real-provider-activation, a later gated phase).

import { makeFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface SyncInvoiceInput {
  tenantId: string;
  invoiceId?: string;
  customerName: string;
  customerPhone?: string;
  amountUsd: number;
  memo?: string;
  idempotencyKey: string;
}
export interface SyncInvoiceOutput {
  externalInvoiceId: string;
  externalCustomerId: string;
}

export interface CreatePaymentLinkInput {
  tenantId: string;
  invoiceId: string;
  amountUsd: number;
  idempotencyKey: string;
}
export interface CreatePaymentLinkOutput {
  paymentLinkUrl: string;
  linkId: string;
}

const syncedInvoices = new Map<string, SyncInvoiceOutput>();
const customersByName = new Map<string, string>();
const paymentLinks = new Map<string, CreatePaymentLinkOutput>();

let injectFaults = makeFaultInjector();

export function configureAccountingEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function resetAccountingEmulator(): void {
  syncedInvoices.clear();
  customersByName.clear();
  paymentLinks.clear();
  injectFaults = makeFaultInjector();
}

export async function emulatorSyncInvoice(input: SyncInvoiceInput): Promise<SyncInvoiceOutput> {
  await injectFaults();
  const existing = syncedInvoices.get(input.idempotencyKey);
  if (existing) return existing;
  const customerId = customersByName.get(input.customerName) ?? `cust_${customersByName.size + 1}`;
  customersByName.set(input.customerName, customerId);
  const result: SyncInvoiceOutput = { externalInvoiceId: input.idempotencyKey, externalCustomerId: customerId };
  syncedInvoices.set(input.idempotencyKey, result);
  return result;
}

export async function emulatorCreatePaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput> {
  await injectFaults();
  const existing = paymentLinks.get(input.idempotencyKey);
  if (existing) return existing;
  const result: CreatePaymentLinkOutput = {
    linkId: input.idempotencyKey,
    paymentLinkUrl: `https://pay.sandbox.finnor.local/${input.idempotencyKey}`,
  };
  paymentLinks.set(input.idempotencyKey, result);
  return result;
}
