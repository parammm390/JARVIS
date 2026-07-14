// Webhook replay protection — one row per (provider, event_id) in webhook_receipts
// (packages/db/migrations/0006_security_controls.sql), keyed by a real composite
// primary key so the check-and-record is atomic even under concurrent delivery
// (webhook senders retry on timeout; this must not process the same event twice).
// Complements, not replaces, the GHL route's existing jobs.idempotencyKey dedup —
// that only covers events that reach a job row; this covers acceptance of the raw
// event itself, including malformed payloads that never make it that far.

import { createHash } from "node:crypto";
import { getPool } from "@finnor/db";

export async function checkAndRecordReceipt(provider: string, eventId: string, rawBody: string): Promise<"new" | "duplicate"> {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const { rowCount } = await getPool().query(
    `INSERT INTO webhook_receipts (provider, event_id, payload_hash) VALUES ($1, $2, $3)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId, payloadHash],
  );
  return rowCount === 1 ? "new" : "duplicate";
}
