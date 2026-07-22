// A4.T6: opt-in idempotency for POST /api/actions. The claim IS the INSERT — a second
// caller with the same (tenantId, idempotencyKey) conflicts on the unique index and is
// rejected BEFORE the orchestrator ever runs a second time, which is what actually makes
// this safe under a genuine concurrent race, not just a sequential retry.

import { withTenant, intakeIdempotency } from "@finnor/db";
import { and, eq } from "drizzle-orm";

export type IntakeClaimResult =
  | { status: "claimed"; id: string }
  | { status: "cached"; response: unknown }
  | { status: "in_progress" };

/** Attempts to claim (tenantId, idempotencyKey). Three outcomes:
 *  - "claimed": this call won — the caller should run the real work, then call
 *    completeIntakeClaim() with the result.
 *  - "cached": a PRIOR call already completed under this key — return its stored
 *    response verbatim, never re-run the orchestrator.
 *  - "in_progress": a prior call claimed this key but hasn't completed yet (still
 *    running, or crashed before ever calling completeIntakeClaim) — honestly reported,
 *    never silently dropped and never a second orchestrator run. */
export async function claimOrGetCachedIntake(tenantId: string, idempotencyKey: string): Promise<IntakeClaimResult> {
  const claimed = await withTenant(tenantId, (db) =>
    db.insert(intakeIdempotency).values({ tenantId, idempotencyKey }).onConflictDoNothing().returning({ id: intakeIdempotency.id }),
  );
  if (claimed.length > 0) return { status: "claimed", id: claimed[0]!.id };

  const [existing] = await withTenant(tenantId, (db) =>
    db.select().from(intakeIdempotency).where(and(eq(intakeIdempotency.tenantId, tenantId), eq(intakeIdempotency.idempotencyKey, idempotencyKey))),
  );
  if (existing?.completedAt) return { status: "cached", response: existing.response };
  return { status: "in_progress" };
}

export async function completeIntakeClaim(tenantId: string, id: string, response: unknown): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.update(intakeIdempotency).set({ response: response as Record<string, unknown>, completedAt: new Date() }).where(eq(intakeIdempotency.id, id)),
  );
}
