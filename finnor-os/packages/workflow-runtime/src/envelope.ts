// Versioned event envelope (§2.2) — every inbox/outbox message is one of these
// (EventEnvelope in @finnor/shared-types). A consumer checks the envelope's major
// version before touching its payload; an unrecognized major is a DLQ candidate, never
// a best-effort parse of a shape the consumer wasn't built for.

import type { EventEnvelope, ErrorKind } from "@finnor/shared-types";

export const CURRENT_ENVELOPE_MAJOR = 1;

export function makeEnvelope<T>(params: {
  type: string;
  tenantId: string;
  payload: T;
  version?: number;
}): EventEnvelope<T> {
  return {
    type: params.type,
    version: params.version ?? CURRENT_ENVELOPE_MAJOR,
    tenantId: params.tenantId,
    occurredAt: new Date().toISOString(),
    payload: params.payload,
  };
}

export interface EnvelopeCheckResult {
  ok: boolean;
  errorKind?: ErrorKind;
  reason?: string;
}

/** A consumer's version gate: same major → ok; unrecognized/future major → reject as
 *  `terminal` (never retryable — retrying won't make an unknown shape known). */
export function checkEnvelopeVersion(envelope: Pick<EventEnvelope, "version">): EnvelopeCheckResult {
  if (envelope.version === CURRENT_ENVELOPE_MAJOR) return { ok: true };
  return {
    ok: false,
    errorKind: "terminal",
    reason: `envelope version ${envelope.version} not recognized (consumer understands major ${CURRENT_ENVELOPE_MAJOR})`,
  };
}
