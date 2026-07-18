// DocuSign e-signature adapter (Phase 15 domain 2 of 2) — plain fetch, no DocuSign SDK
// dependency, JWT grant auth (RS256 assertion), same no-new-npm-deps discipline as
// stripe.ts and quickbooks.ts.
//
// This repo's documents are `storageRef: native://…` with NO real PDF bytes
// (documents-emulator/createDocument never generate one — a pre-existing gap in the
// documents domain, not something e-signature work should silently paper over). The
// adapter below generates a minimal, honestly-labeled placeholder PDF from the
// document id so DocuSign has real bytes to attach a signature to. Real PDF rendering
// (populating it with the actual proposal/quote content) is a documents-capability
// gap, tracked separately — this comment is that tracking.

import { createSign } from "node:crypto";
import { IntegrationError } from "./errors";
import type { RequestSignatureInput, RequestSignatureOutput } from "./emulators/documents-emulator";

export type { RequestSignatureInput, RequestSignatureOutput };

function docusignConfigured(): boolean {
  return Boolean(
    process.env.DOCUSIGN_INTEGRATION_KEY &&
      process.env.DOCUSIGN_USER_ID &&
      process.env.DOCUSIGN_ACCOUNT_ID &&
      process.env.DOCUSIGN_PRIVATE_KEY,
  );
}

export function docusignProviderStatus(): { configured: boolean } {
  return { configured: docusignConfigured() };
}

function baseUrl(): string {
  return process.env.DOCUSIGN_BASE_URL ?? "https://demo.docusign.net";
}

/** JWT-grant auth host is the account-server counterpart of the API base — demo's is
 *  account-d.docusign.com, production's is account.docusign.com. Derived from
 *  DOCUSIGN_BASE_URL rather than a separate env var — one fewer knob to misconfigure. */
function authHost(): string {
  return baseUrl().includes("demo.docusign.net") ? "account-d.docusign.com" : "account.docusign.com";
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** RS256 JWT-bearer assertion — DocuSign's impersonation grant. Signed locally with
 *  node:crypto (no jsonwebtoken dependency); DOCUSIGN_PRIVATE_KEY is the PEM the
 *  integration key's RSA keypair was created with. */
function buildAssertion(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: process.env.DOCUSIGN_INTEGRATION_KEY,
      sub: process.env.DOCUSIGN_USER_ID,
      aud: authHost(),
      iat: now,
      exp: now + 3600,
      scope: "signature impersonation",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(process.env.DOCUSIGN_PRIVATE_KEY!).toString("base64url");
  return `${signingInput}.${signature}`;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/** JWT tokens are valid ~1h; a per-module cache avoids a token round trip on every
 *  envelope call within that window (quickbooks.ts skips this — its refresh_token
 *  grant is cheap enough not to bother — but DocuSign's JWT assertion path is worth
 *  the extra ~15 lines since signing + the token exchange both cost real latency). */
async function docusignAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.accessToken;

  const res = await fetch(`https://${authHost()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationError("docusign", `JWT token exchange failed (${res.status}): ${body.slice(0, 300)}`, res.status >= 500);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new IntegrationError("docusign", "JWT token exchange returned no access_token", false);
  cachedToken = { accessToken: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

function escapePdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Hand-built minimal single-page PDF (no rendering library — see module header for
 *  why this is honest, not a shortcut). Byte offsets in the xref table are computed
 *  from the actual bytes written, not guessed, so real PDF readers (DocuSign
 *  included) accept it. */
function buildPlaceholderPdf(title: string): Buffer {
  const text = escapePdfText(title).slice(0, 200);
  const objectBodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 16 Tf 72 720 Td (${text}) Tj ET`;
  objectBodies.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objectBodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objectBodies.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** Real DocuSign envelope creation — one signer, one placeholder document, sent
 *  immediately (status: "sent"). customFields carry tenantId/proposalId so the
 *  DocuSign Connect webhook (apps/api/app/api/webhooks/esign/route.ts) can resolve
 *  which tenant/proposal an envelope-status callback belongs to. */
export async function requestDocusignSignature(input: RequestSignatureInput): Promise<RequestSignatureOutput> {
  if (!docusignConfigured()) {
    throw new IntegrationError(
      "docusign",
      "DocuSign is not connected — DOCUSIGN_INTEGRATION_KEY/USER_ID/ACCOUNT_ID/PRIVATE_KEY are not all set",
      false,
    );
  }
  const accessToken = await docusignAccessToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID!;
  const documentBytes = buildPlaceholderPdf(`Document ${input.documentId}`);

  const customFields = [
    { name: "tenantId", value: input.tenantId },
    ...(input.proposalId ? [{ name: "proposalId", value: input.proposalId }] : []),
  ];

  const res = await fetch(`${baseUrl()}/restapi/v2.1/accounts/${accountId}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-DocuSign-Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      emailSubject: "Please sign your Finnor proposal",
      status: "sent",
      customFields: { textCustomFields: customFields },
      documents: [
        {
          documentBase64: documentBytes.toString("base64"),
          name: `document-${input.documentId}.pdf`,
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: input.signerEmail,
            name: input.signerName,
            recipientId: "1",
            routingOrder: "1",
            tabs: { signHereTabs: [{ anchorString: "/sig/", anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "0" }] },
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status !== 401 && res.status !== 403;
    throw new IntegrationError("docusign", `envelope create failed (${res.status}): ${body.slice(0, 300)}`, retryable);
  }
  const data = (await res.json()) as { envelopeId?: string };
  if (!data.envelopeId) throw new IntegrationError("docusign", "envelope create returned no envelopeId", false);
  return { signatureRequestId: data.envelopeId, status: "sent" };
}

/** Test-only cleanup helper — voids a demo-env envelope so conformance runs don't
 *  accumulate live clutter in the shared DocuSign developer account. Not part of the
 *  capability contract; used only from tests/integration/real-provider-conformance.test.ts. */
export async function voidDocusignEnvelope(envelopeId: string, reason = "conformance test cleanup"): Promise<void> {
  const accessToken = await docusignAccessToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID!;
  await fetch(`${baseUrl()}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "voided", voidedReason: reason }),
  });
}
