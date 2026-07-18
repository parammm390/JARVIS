// Phase 15 conformance (docs/jarvis-99-phase-10-16-execution-plan.md, "PHASE 15" §3):
// proves the Stripe and DocuSign adapters actually work against real (test-mode/
// demo) provider APIs when credentials are present, and skips cleanly — never
// silently "passing" as if it proved something — when they're absent. Sandbox
// signup for both is free and needs no business (Stripe test mode, DocuSign
// developer demo account) but is a human step; this suite only runs the real-API
// halves when that step has already happened. Tenant
// 00000000-0000-4000-8000-0000000000e4 per the execution plan's tenant assignment.
// Unit-level coverage (stub-fetch: happy path, error mapping, retry semantics) lives
// in tests/unit/stripe.test.ts and tests/unit/docusign.test.ts and runs unconditionally.

import { describe, it, expect, afterAll } from "vitest";
import { createStripePaymentLink, docusignProviderStatus, requestDocusignSignature, voidDocusignEnvelope } from "@finnor/tools";

const TENANT_E4 = "00000000-0000-4000-8000-0000000000e4";
const FAKE_INVOICE_ID = "00000000-0000-4000-8000-0000000000bb";

// Refuses to run against a live key by construction — sk_live_ (or anything else) skips.
describe.skipIf(!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))("Stripe conformance (real test-mode API)", () => {
  it("creates a real Checkout Session with the expected shape", async () => {
    const result = await createStripePaymentLink({
      tenantId: TENANT_E4,
      invoiceId: FAKE_INVOICE_ID,
      amountUsd: 42.5,
      idempotencyKey: `conformance-shape-${Date.now()}`,
    });
    expect(result.linkId).toMatch(/^cs_/);
    expect(result.paymentLinkUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it("is idempotent — a retried call with the same idempotencyKey returns the same session id", async () => {
    const idempotencyKey = `conformance-idem-${Date.now()}`;
    const first = await createStripePaymentLink({ tenantId: TENANT_E4, invoiceId: FAKE_INVOICE_ID, amountUsd: 10, idempotencyKey });
    const second = await createStripePaymentLink({ tenantId: TENANT_E4, invoiceId: FAKE_INVOICE_ID, amountUsd: 10, idempotencyKey });
    expect(second.linkId).toBe(first.linkId);
  });
});

describe.skipIf(!docusignProviderStatus().configured)("DocuSign conformance (real demo-env API)", () => {
  let createdEnvelopeId: string | undefined;

  afterAll(async () => {
    if (!createdEnvelopeId) return;
    await voidDocusignEnvelope(createdEnvelopeId).catch(() => {
      // Best-effort cleanup — a void failure shouldn't fail the suite that already
      // proved the real thing it set out to prove (envelope creation).
    });
  });

  it("creates a real envelope with the expected shape", async () => {
    const result = await requestDocusignSignature({
      tenantId: TENANT_E4,
      documentId: "conformance-doc",
      signerName: "Conformance Tester",
      signerEmail: "conformance@example.com",
      idempotencyKey: `conformance-${Date.now()}`,
    });
    expect(result.status).toBe("sent");
    expect(result.signatureRequestId).toBeTruthy();
    createdEnvelopeId = result.signatureRequestId;
  });
});
