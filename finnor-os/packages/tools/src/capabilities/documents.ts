// Documents/e-signature capability contract (Phase 3 domain 5 of 5; Phase 4 §4.2
// closed the "no real PDF bytes anywhere" gap). `generate_document`'s native binding
// wraps `createDocument()` (@finnor/data-platform) for the metadata row AND now
// renders real PDF bytes via pdf-lib (../pdf/render-pdf), persisted in
// document_contents (migration 0025) -- a proposal's line items/pricing come from
// the real quotes/quote_line_items rows, not a placeholder title. `request_signature`
// is emulator-only unless ESIGN_BINDING=docusign (real account required, Phase 4).

import { z } from "zod";
import { withTenant, quotes, quoteLineItems, proposals, households } from "@finnor/db";
import { eq } from "drizzle-orm";
import { createDocument, recordDocumentContent, getDocumentContent } from "@finnor/data-platform";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { requestDocusignSignature, docusignProviderStatus } from "../docusign";
import { withCircuitBreaker } from "../provider-circuit-breaker";
import { renderDocumentPdf } from "../pdf/render-pdf";
import {
  emulatorGenerateDocument,
  emulatorRequestSignature,
  type GenerateDocumentInput,
  type GenerateDocumentOutput,
  type RequestSignatureInput,
  type RequestSignatureOutput,
} from "../emulators/documents-emulator";

export type { GenerateDocumentInput, GenerateDocumentOutput, RequestSignatureInput, RequestSignatureOutput };

export const GenerateDocumentInputSchema = z.object({
  tenantId: z.string().uuid(),
  kind: z.string().min(1),
  title: z.string().min(1),
  idempotencyKey: z.string().min(1),
  // Optional: which real domain entity this document renders from. Only "proposal"
  // (keyed by proposals.id) is wired to real content today -- anything else still
  // gets a real, honestly-generic PDF rather than a fabricated line-item render.
  sourceEntityType: z.enum(["proposal"]).optional(),
  sourceEntityId: z.string().uuid().optional(),
});
export const GenerateDocumentOutputSchema = z.object({ documentId: z.string(), storageRef: z.string() });

export const RequestSignatureInputSchema = z.object({
  tenantId: z.string().uuid(),
  documentId: z.string(),
  signerName: z.string().min(1),
  signerEmail: z.string().email(),
  idempotencyKey: z.string().min(1),
  proposalId: z.string().uuid().optional(),
});
export const RequestSignatureOutputSchema = z.object({ signatureRequestId: z.string(), status: z.literal("sent") });

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200, timeoutMs: 8_000 };

// --- generate_document -------------------------------------------------------------

export const generateDocumentContract: CapabilityContract<GenerateDocumentInput, GenerateDocumentOutput> = {
  domain: "documents",
  capability: "generate_document",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "documents:generate_document",
  piiAllowlist: ["kind", "title"],
  retryOnUnknown: true, // generating the same document twice is safe — idempotency key IS the document id
};

export const generateDocumentEmulatorBinding: CapabilityBinding<GenerateDocumentInput, GenerateDocumentOutput> = {
  name: "emulator",
  call: emulatorGenerateDocument,
};

export const generateDocumentNativeBinding: CapabilityBinding<GenerateDocumentInput, GenerateDocumentOutput> = {
  name: "native",
  async call(input) {
    return withTenant(input.tenantId, async (db) => {
      const { documentId } = await createDocument(db, {
        tenantId: input.tenantId,
        kind: input.kind,
        title: input.title,
        provenance: { sourceSystem: "capability:generate_document", externalId: input.idempotencyKey },
      });

      let pdfBytes: Buffer;
      if (input.sourceEntityType === "proposal" && input.sourceEntityId) {
        const [proposal] = await db.select().from(proposals).where(eq(proposals.id, input.sourceEntityId));
        const [household] = proposal ? await db.select().from(households).where(eq(households.id, proposal.householdId)) : [];
        const [quote] = proposal?.quoteId ? await db.select().from(quotes).where(eq(quotes.id, proposal.quoteId)) : [];
        const lineItemRows = quote ? await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quote.id)) : [];
        pdfBytes = await renderDocumentPdf({
          kind: "proposal",
          title: input.title,
          householdAddress: household?.address ?? "On file",
          lineItems: lineItemRows.map((li) => ({ label: li.label, quantity: li.quantity, unitPriceUsd: Number(li.unitPriceUsd) })),
          totalUsd: quote?.totalUsd ? Number(quote.totalUsd) : lineItemRows.reduce((sum, li) => sum + li.quantity * Number(li.unitPriceUsd), 0),
          validUntil: quote?.validUntil ? quote.validUntil.toISOString() : null,
        });
      } else {
        pdfBytes = await renderDocumentPdf({ kind: "generic", title: input.title });
      }
      await recordDocumentContent(db, { tenantId: input.tenantId, documentId, bytes: pdfBytes });

      return { documentId, storageRef: `internal://documents/${documentId}` };
    });
  },
};

// --- request_signature ---------------------------------------------------------

export const requestSignatureContract: CapabilityContract<RequestSignatureInput, RequestSignatureOutput> = {
  domain: "documents",
  capability: "request_signature",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "documents:request_signature",
  piiAllowlist: ["documentId", "signerName", "signerEmail"],
  retryOnUnknown: false,
};

export const requestSignatureEmulatorBinding: CapabilityBinding<RequestSignatureInput, RequestSignatureOutput> = {
  name: "emulator",
  call: emulatorRequestSignature,
};

export function isDocusignConfigured(): boolean {
  return docusignProviderStatus().configured;
}

export const requestSignatureDocusignBinding: CapabilityBinding<RequestSignatureInput, RequestSignatureOutput> = {
  name: "docusign",
  async call(input) {
    const content = await withTenant(input.tenantId, (db) => getDocumentContent(db, input.documentId));
    return withCircuitBreaker("docusign", () => requestDocusignSignature({ ...input, documentBytes: content?.bytes }), { tenantId: input.tenantId });
  },
};
