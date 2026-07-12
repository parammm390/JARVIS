// POST /api/webhooks/ghl — CRM sync events (§8, §20). Logged as jobs for the worker's
// reconciliation handler. Idempotent on GHL's event id when present.

import { GhlWebhookSchema } from "@finnor/policy-schema";
import { adminDb, jobs } from "@finnor/db";

export async function POST(req: Request): Promise<Response> {
  const parsed = GhlWebhookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

  const eventId = (parsed.data as Record<string, unknown>)["webhookId"] ?? null;
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
