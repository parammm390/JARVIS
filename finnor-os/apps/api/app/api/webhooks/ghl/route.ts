// POST /api/webhooks/ghl — CRM sync events (§8, §20). Logged as jobs for the worker's
// reconciliation handler. Idempotent on GHL's event id when present.

import { createHash, createVerify } from "node:crypto";
import { GhlWebhookSchema } from "@finnor/policy-schema";
import { adminDb, jobs } from "@finnor/db";
import { ensureSecretsLoaded } from "@finnor/security";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { logWithTrace } from "@finnor/tools";

/**
 * GHL (HighLevel) marketplace webhooks are signed RSA-SHA256 against GHL's own
 * published public key (header `x-wh-signature`), not an HMAC shared secret — there is
 * no secret to generate here. GHL_WEBHOOK_PUBLIC_KEY must come from the founder's own
 * HighLevel developer dashboard; this verifies against whatever value is configured
 * and is a no-op (accepts unsigned, same as today) until it's set — ready to activate,
 * never fabricated.
 */
function verifySignature(req: Request, rawBody: string): boolean {
  const publicKey = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return process.env.NODE_ENV !== "production";
  const signature = req.headers.get("x-wh-signature");
  if (!signature) return false;
  try {
    return createVerify("RSA-SHA256").update(rawBody).verify(publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  await ensureSecretsLoaded();
  const rawBody = await req.text();
  if (!verifySignature(req, rawBody)) {
    logWithTrace({ route: "webhooks/ghl" }).warn({ event: "webhook_signature_rejected", provider: "ghl" }, "rejected webhook: bad x-wh-signature");
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    // parsed.success below handles it
  }
  const parsed = GhlWebhookSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

  const eventId = (parsed.data as Record<string, unknown>)["webhookId"] ?? `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  // Replay protection at acceptance time — complements, doesn't replace, the
  // jobs.idempotencyKey dedup below (that only covers events with a webhookId that
  // reach this insert; this covers the raw event regardless).
  const receipt = await checkAndRecordReceipt("ghl", String(eventId), rawBody);
  if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });
  await adminDb()
    .insert(jobs)
    .values({
      type: "reconciliation",
      payload: parsed.data,
      idempotencyKey: eventId ? `ghl:${String(eventId)}` : null,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey });
  return Response.json({ received: true });
}
