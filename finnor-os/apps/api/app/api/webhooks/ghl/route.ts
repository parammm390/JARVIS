// POST /api/webhooks/ghl — CRM sync events (§8, §20). Logged as jobs for the worker's
// reconciliation handler. Idempotent on GHL's event id when present.

import { createHash, createVerify } from "node:crypto";
import { GhlWebhookSchema } from "@finnor/policy-schema";
import { adminDb, getPool, jobs } from "@finnor/db";
import { ensureSecretsLoaded } from "@finnor/security";
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
  if (!parsed.data.locationId) return Response.json({ error: "GHL event is missing its signed locationId" }, { status: 400 });
  const resolved = await getPool().query<{ tenant_id: string | null }>("SELECT finnor_os.resolve_inbound_provider_tenant('ghl',$1) tenant_id", [parsed.data.locationId]);
  const tenantId = resolved.rows[0]?.tenant_id;
  if (!tenantId) {
    logWithTrace({ route: "webhooks/ghl" }).warn({ event: "webhook_tenant_unresolved", provider: "ghl", locationId: parsed.data.locationId }, "rejected GHL webhook: tenant mapping was not unique");
    return Response.json({ error: "GHL location is not mapped to exactly one tenant" }, { status: 400 });
  }

  const eventId = (parsed.data as Record<string, unknown>)["webhookId"] ?? `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  // The durable job is the acceptance/replay claim. Recording a separate receipt
  // first creates a crash window where a retry is suppressed before normalization.
  const inserted = await adminDb()
    .insert(jobs)
    .values({
      type: "reconciliation",
      payload: { ...parsed.data, tenantId, _providerEventId: String(eventId) },
      idempotencyKey: `ghl:${tenantId}:${String(eventId)}`,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  return Response.json({ received: true, duplicate: inserted.length === 0 });
}
