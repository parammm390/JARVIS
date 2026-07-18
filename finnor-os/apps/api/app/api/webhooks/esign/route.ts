// POST /api/webhooks/esign — DocuSign Connect inbound notifications. The signing
// half (packages/tools/src/docusign.ts's requestDocusignSignature) already exists;
// this route is the other half — the signer's completed/declined/voided response
// arriving as a webhook, mapped onto the pre-existing applySignatureOutcome (which
// previously had no real webhook in front of it — tests invoked it directly).
//
// DocuSign Connect's own signature scheme is a PLAIN base64 HMAC-SHA256 over the raw
// body (header `x-docusign-signature-1`) — no timestamp component, unlike Vapi/
// Stripe's `t=,v1=` shape, so it is verified locally here rather than through the
// shared verifyTimestampedHmacSignature helper. Same fail-open-only-in-dev posture
// as every other webhook route in this repo.
//
// tenantId/proposalId round-trip via the envelope's customFields, set at creation
// time in requestDocusignSignature. quoteId is NOT one of those custom fields (the
// request_signature step never has it) — it's looked up here from the proposal row
// (proposals.quoteId), per the execution plan's explicit call.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withTenant, proposals } from "@finnor/db";
import { eq } from "drizzle-orm";
import { applySignatureOutcome } from "../../../../../../packages/domain-plugins/proposal-signature/index";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { errorResponse } from "../../../../lib/auth";

function verifyDocusignSignature(req: Request, rawBody: string): boolean {
  const secret = process.env.DOCUSIGN_CONNECT_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-docusign-signature-1") ?? "";
  let gotBuf: Buffer;
  try {
    gotBuf = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  const expectedBuf = createHmac("sha256", secret).update(rawBody).digest();
  return expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf);
}

const DocusignConnectSchema = z.object({
  data: z.object({
    envelopeId: z.string().min(1),
    envelopeSummary: z
      .object({
        status: z.string(),
        customFields: z
          .object({
            textCustomFields: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

const STATUS_TO_OUTCOME: Record<string, "signed" | "declined" | "expired"> = {
  completed: "signed",
  declined: "declined",
  voided: "expired",
};

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    if (!verifyDocusignSignature(req, rawBody)) return Response.json({ error: "Bad signature" }, { status: 401 });

    let json: unknown = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Malformed webhook" }, { status: 400 });
    }
    const parsed = DocusignConnectSchema.safeParse(json);
    if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

    const { envelopeId, envelopeSummary } = parsed.data.data;
    const status = envelopeSummary?.status ?? "";
    const outcome = STATUS_TO_OUTCOME[status];
    if (!outcome) return Response.json({ received: true, ignored: true, status });

    const fields = envelopeSummary?.customFields?.textCustomFields ?? [];
    const tenantId = fields.find((f) => f.name === "tenantId")?.value;
    const proposalId = fields.find((f) => f.name === "proposalId")?.value;
    if (!tenantId || !proposalId) {
      return Response.json({ error: "Envelope missing tenantId/proposalId custom fields" }, { status: 400 });
    }

    const receipt = await checkAndRecordReceipt("docusign", `${envelopeId}:${status}`, rawBody);
    if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });

    const quoteId = await withTenant(tenantId, async (db) => {
      const [row] = await db.select({ quoteId: proposals.quoteId }).from(proposals).where(eq(proposals.id, proposalId));
      return row?.quoteId ?? null;
    });
    if (!quoteId) return Response.json({ error: "Proposal has no linked quote" }, { status: 400 });

    const result = await applySignatureOutcome({
      tenantId,
      quoteId,
      proposalId,
      signatureRequestId: envelopeId,
      outcome,
    });
    return Response.json({ received: true, applied: result.applied });
  } catch (err) {
    return errorResponse(err);
  }
}
