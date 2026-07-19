// Stateful local documents/e-signature emulator. No real e-signature provider
// (DocuSign/HelloSign/etc.) is integrated anywhere in this repo (confirmed by grep) —
// request_signature is emulator-only this phase; real-provider activation is later,
// gated work.

import { makeFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface GenerateDocumentInput {
  tenantId: string;
  kind: string;
  title: string;
  idempotencyKey: string;
  sourceEntityType?: "proposal";
  sourceEntityId?: string;
}
export interface GenerateDocumentOutput {
  documentId: string;
  storageRef: string;
}

export interface RequestSignatureInput {
  tenantId: string;
  documentId: string;
  signerName: string;
  signerEmail: string;
  idempotencyKey: string;
  /** Threaded through when the calling step has it (proposal-signature plugin's
   *  request_signature step) so a real e-signature webhook can round-trip back to the
   *  right proposal without a separate lookup table. Ignored by the emulator. */
  proposalId?: string;
  /** Phase 4 (§4.2): the document's real bytes, fetched by the binding layer (which
   *  has DB access) before calling a real provider adapter (which deliberately
   *  doesn't). Ignored by the emulator. */
  documentBytes?: Buffer;
}
export interface RequestSignatureOutput {
  signatureRequestId: string;
  status: "sent";
}

export type SignatureEventStatus = "sent" | "signed" | "declined" | "expired";

const generatedDocuments = new Map<string, GenerateDocumentOutput>();
const signatureRequests = new Map<string, { output: RequestSignatureOutput; status: SignatureEventStatus }>();

let injectFaults = makeFaultInjector();

export function configureDocumentsEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function resetDocumentsEmulator(): void {
  generatedDocuments.clear();
  signatureRequests.clear();
  injectFaults = makeFaultInjector();
}

export async function emulatorGenerateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentOutput> {
  await injectFaults();
  const existing = generatedDocuments.get(input.idempotencyKey);
  if (existing) return existing;
  const result: GenerateDocumentOutput = { documentId: input.idempotencyKey, storageRef: `sandbox://documents/${input.idempotencyKey}` };
  generatedDocuments.set(input.idempotencyKey, result);
  return result;
}

export async function emulatorRequestSignature(input: RequestSignatureInput): Promise<RequestSignatureOutput> {
  await injectFaults();
  const existing = signatureRequests.get(input.idempotencyKey);
  if (existing) return existing.output;
  const output: RequestSignatureOutput = { signatureRequestId: input.idempotencyKey, status: "sent" };
  signatureRequests.set(input.idempotencyKey, { output, status: "sent" });
  return output;
}

/** Test-only: simulate the signer acting on the request (signing/declining/expiring),
 *  so callers can prove the inbox_events/reconciliation path against a real state change. */
export function simulateSignatureEvent(signatureRequestId: string, status: SignatureEventStatus): void {
  const existing = signatureRequests.get(signatureRequestId);
  if (existing) existing.status = status;
}

export function getSignatureStatus(signatureRequestId: string): SignatureEventStatus | "not_found" {
  return signatureRequests.get(signatureRequestId)?.status ?? "not_found";
}
