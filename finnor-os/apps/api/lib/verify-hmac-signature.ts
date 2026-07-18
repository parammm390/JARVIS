// Shared HMAC-with-timestamp webhook signature verifier. Extracted from the Vapi
// route's original `verifySignature` (which pioneered this shape in this repo) so
// Stripe webhook verification doesn't become a third hand-rolled copy — Stripe's own
// `stripe-signature` header is `t=<unix>,v1=<hex hmac over "${t}.${rawBody}">`, the
// exact same shape Vapi already uses, not a coincidence worth re-deriving.

import { createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_SECONDS = 300;

export interface VerifyTimestampedHmacOptions {
  /** Request header name carrying `t=<unix>,v1=<hex>` (e.g. "x-vapi-signature", "stripe-signature"). */
  header: string;
  secret: string | undefined;
  rawBody: string;
  /** Whether an unset secret should verify as true (dev convenience) or false
   *  (fail closed). Callers decide this — e.g. `process.env.NODE_ENV !== "production"`. */
  allowUnsetSecret: boolean;
}

/**
 * Fails OPEN only when the secret is unset AND the caller opted into that (dev
 * convenience) — fails CLOSED otherwise, and always rejects a signature outside a
 * 5-minute window even with a valid secret (replay protection).
 */
export function verifyTimestampedHmacSignature(req: Request, opts: VerifyTimestampedHmacOptions): boolean {
  if (!opts.secret) return opts.allowUnsetSecret;
  const header = req.headers.get(opts.header) ?? "";
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > REPLAY_WINDOW_SECONDS) return false;
  const expected = createHmac("sha256", opts.secret).update(`${t}.${opts.rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(v1, "hex");
  return expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf);
}
