// Accounting/payments capability contract (Phase 3 domain 2 of 5). `sync_invoice`'s
// real binding rebinds the genuinely-real existing QuickBooks adapter
// (packages/tools/src/quickbooks.ts) — same shape as Phase 2's Vapi treatment.
// `create_payment_link` gets an emulator-only binding: no Stripe/payment-link provider
// is integrated or being requested this phase (real-provider activation is a later,
// gated phase per the blueprint's own rule).

import { z } from "zod";
import { withTenant, externalRefs } from "@finnor/db";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { syncInvoiceToQuickBooks, quickbooksProviderStatus } from "../quickbooks";
import { createStripePaymentLink, stripeProviderStatus } from "../stripe";
import { withCircuitBreaker } from "../provider-circuit-breaker";
import {
  emulatorSyncInvoice,
  emulatorCreatePaymentLink,
  type SyncInvoiceInput,
  type SyncInvoiceOutput,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkOutput,
} from "../emulators/accounting-emulator";

export type { SyncInvoiceInput, SyncInvoiceOutput, CreatePaymentLinkInput, CreatePaymentLinkOutput };

export const SyncInvoiceInputSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  amountUsd: z.number().positive(),
  memo: z.string().optional(),
  idempotencyKey: z.string().min(1),
});
export const SyncInvoiceOutputSchema = z.object({ externalInvoiceId: z.string(), externalCustomerId: z.string() });

export const CreatePaymentLinkInputSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amountUsd: z.number().positive(),
  idempotencyKey: z.string().min(1),
});
export const CreatePaymentLinkOutputSchema = z.object({ paymentLinkUrl: z.string(), linkId: z.string() });

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 250, timeoutMs: 10_000 };

export function isQuickBooksConfigured(): boolean {
  return quickbooksProviderStatus().configured;
}

export function isStripeConfigured(): boolean {
  return stripeProviderStatus().configured;
}

// --- sync_invoice --------------------------------------------------------------

export const syncInvoiceContract: CapabilityContract<SyncInvoiceInput, SyncInvoiceOutput> = {
  domain: "accounting",
  capability: "sync_invoice",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "accounting:sync_invoice",
  piiAllowlist: ["customerName", "customerPhone", "amountUsd", "memo"],
  // Sync is a best-effort mirror of Finnor's own invoice (the real system of record) —
  // safe to retry on unknown delivery, since QuickBooks' own DisplayName lookup makes a
  // re-sync converge rather than duplicate (findOrCreateCustomer in quickbooks.ts).
  retryOnUnknown: true,
};

export const syncInvoiceEmulatorBinding: CapabilityBinding<SyncInvoiceInput, SyncInvoiceOutput> = {
  name: "emulator",
  call: emulatorSyncInvoice,
};

export const syncInvoiceQuickbooksBinding: CapabilityBinding<SyncInvoiceInput, SyncInvoiceOutput> = {
  name: "quickbooks",
  async call(input) {
    const result = await withCircuitBreaker("quickbooks", () =>
      syncInvoiceToQuickBooks({
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        amountUsd: input.amountUsd,
        memo: input.memo,
      }),
    );
    // Phase 4 (§4.5): the single join between Finnor's invoice and QuickBooks' real
    // objects. invoiceId is optional upstream (older callers may not pass it) — only
    // write a real ref when there's a real internal id to join against.
    if (input.invoiceId) {
      await withTenant(input.tenantId, (db) =>
        db
          .insert(externalRefs)
          .values({ tenantId: input.tenantId, entity: "invoice", internalId: input.invoiceId!, provider: "quickbooks", externalId: result.quickbooksInvoiceId })
          .onConflictDoUpdate({
            target: [externalRefs.tenantId, externalRefs.entity, externalRefs.internalId, externalRefs.provider],
            set: { externalId: result.quickbooksInvoiceId, syncedAt: new Date() },
          }),
      );
    }
    return { externalInvoiceId: result.quickbooksInvoiceId, externalCustomerId: result.quickbooksCustomerId };
  },
};

// --- create_payment_link --------------------------------------------------------

export const createPaymentLinkContract: CapabilityContract<CreatePaymentLinkInput, CreatePaymentLinkOutput> = {
  domain: "accounting",
  capability: "create_payment_link",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "accounting:create_payment_link",
  piiAllowlist: ["invoiceId", "amountUsd"],
  retryOnUnknown: true, // creating the same link twice is safe — idempotency key IS the link id
};

export const createPaymentLinkEmulatorBinding: CapabilityBinding<CreatePaymentLinkInput, CreatePaymentLinkOutput> = {
  name: "emulator",
  call: emulatorCreatePaymentLink,
};

export const stripeCreatePaymentLinkBinding: CapabilityBinding<CreatePaymentLinkInput, CreatePaymentLinkOutput> = {
  name: "stripe",
  async call(input) {
    const result = await withCircuitBreaker("stripe", () => createStripePaymentLink(input));
    await withTenant(input.tenantId, (db) =>
      db
        .insert(externalRefs)
        .values({ tenantId: input.tenantId, entity: "invoice", internalId: input.invoiceId, provider: "stripe", externalId: result.linkId })
        .onConflictDoUpdate({
          target: [externalRefs.tenantId, externalRefs.entity, externalRefs.internalId, externalRefs.provider],
          set: { externalId: result.linkId, syncedAt: new Date() },
        }),
    );
    return result;
  },
};
