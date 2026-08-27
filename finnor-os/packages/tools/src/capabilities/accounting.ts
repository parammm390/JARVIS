// Accounting/payments capability contract (Phase 3 domain 2 of 5). `sync_invoice`'s
// real binding rebinds the genuinely-real existing QuickBooks adapter
// (packages/tools/src/quickbooks.ts) — same shape as Phase 2's Vapi treatment.
// `create_payment_link` gets an emulator-only binding: no Stripe/payment-link provider
// is integrated or being requested this phase (real-provider activation is a later,
// gated phase per the blueprint's own rule).

import { z } from "zod";
import { invoices, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordExternalReferenceAcknowledgement } from "@finnor/data-platform";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { syncInvoiceToQuickBooks, quickbooksProviderStatus } from "../quickbooks";
import { createStripePaymentLink, stripeProviderStatus } from "../stripe";
import { withCircuitBreaker } from "../provider-circuit-breaker";
import { resolveCredentialContext, type TenantCredentialContext } from "@finnor/security";
import { governedCapabilityRuntime } from "./governed-runtime";
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

export function isQuickBooksConfigured(context: TenantCredentialContext<"quickbooks"> | null): boolean {
  return quickbooksProviderStatus(context).configured;
}

export function isStripeConfigured(context: TenantCredentialContext<"stripe"> | null): boolean {
  return stripeProviderStatus(context).configured;
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
  // Sync is a best-effort mirror of Finnor's own invoice (the real system of record).
  // The same key is sent as deterministic QuickBooks request IDs for both provider
  // creates, so an unknown-outcome replay converges instead of duplicating either row.
  retryOnUnknown: true,
};

export const syncInvoiceEmulatorBinding: CapabilityBinding<SyncInvoiceInput, SyncInvoiceOutput> = {
  name: "emulator",
  call: emulatorSyncInvoice,
};

export const syncInvoiceQuickbooksBinding: CapabilityBinding<SyncInvoiceInput, SyncInvoiceOutput> = {
  name: "quickbooks",
  async call(input) {
    const runtime = governedCapabilityRuntime(input, "sync_invoice");
    const credentialContext = await resolveCredentialContext(input.tenantId, runtime.__identityActorId, "quickbooks", runtime.__identityPurpose, {
      application: "quickbooks",
      ...(runtime.__authProfileRef ? { authProfileRef: runtime.__authProfileRef } : {}),
    });
    const result = await withCircuitBreaker(
      "quickbooks",
      () =>
        syncInvoiceToQuickBooks({
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          amountUsd: input.amountUsd,
          memo: input.memo,
          idempotencyKey: input.idempotencyKey,
        }, credentialContext),
      { tenantId: input.tenantId },
    );
    // Phase 4 (§4.5): the single join between Finnor's invoice and QuickBooks' real
    // objects. invoiceId is optional upstream (older callers may not pass it) — only
    // write a real ref when there's a real internal id to join against.
    if (input.invoiceId) {
      if (!credentialContext.integration.id) throw new Error("QuickBooks mutation has no exact tenant integration/account binding");
      await withTenant(input.tenantId, (db) => recordExternalReferenceAcknowledgement(db, {
        tenantId: input.tenantId,
        integrationId: credentialContext.integration.id!,
        provider: "quickbooks",
        canonicalEntity: "invoice",
        canonicalEntityId: input.invoiceId!,
        externalObjectType: "invoice",
        externalId: result.quickbooksInvoiceId,
        businessEffectId: runtime.__businessEffectId,
      }));
      const [invoice] = await withTenant(input.tenantId, (db) => db.select({ householdId: invoices.householdId }).from(invoices).where(and(
        eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId!),
      )).limit(1));
      if (invoice?.householdId) await withTenant(input.tenantId, (db) => recordExternalReferenceAcknowledgement(db, {
        tenantId: input.tenantId,
        integrationId: credentialContext.integration.id!,
        provider: "quickbooks",
        canonicalEntity: "household",
        canonicalEntityId: invoice.householdId,
        externalObjectType: "customer",
        externalId: result.quickbooksCustomerId,
        businessEffectId: runtime.__businessEffectId,
      }));
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
    const runtime = governedCapabilityRuntime(input, "create_payment_link");
    const credentialContext = await resolveCredentialContext(input.tenantId, runtime.__identityActorId, "stripe", runtime.__identityPurpose, {
      application: "stripe",
      ...(runtime.__authProfileRef ? { authProfileRef: runtime.__authProfileRef } : {}),
    });
    const result = await withCircuitBreaker("stripe", () => createStripePaymentLink(input, credentialContext), { tenantId: input.tenantId });
    if (!credentialContext.integration.id) throw new Error("Stripe mutation has no exact tenant integration/account binding");
    await withTenant(input.tenantId, (db) => recordExternalReferenceAcknowledgement(db, {
      tenantId: input.tenantId,
      integrationId: credentialContext.integration.id!,
      provider: "stripe",
      canonicalEntity: "invoice",
      canonicalEntityId: input.invoiceId,
      externalObjectType: "checkout_session",
      externalId: result.linkId,
      businessEffectId: runtime.__businessEffectId,
    }));
    return result;
  },
};
