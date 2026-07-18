// Documents/e-signature capability contract (Phase 3 domain 5 of 5). Nothing exists
// anywhere in the repo for this domain today (confirmed by grep: zero PDF/DocuSign/
// e-sign hits that aren't false positives on the word "signature" meaning function
// signatures). `generate_document`'s native binding wraps the already-built-but-
// unused `createDocument()` (@finnor/data-platform, Phase 1); `request_signature` is
// emulator-only — no real e-signature provider is in scope this phase.

import { z } from "zod";
import { withTenant } from "@finnor/db";
import { createDocument } from "@finnor/data-platform";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { requestDocusignSignature, docusignProviderStatus } from "../docusign";
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
      return { documentId, storageRef: `native://documents/${documentId}` };
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
  call: requestDocusignSignature,
};
