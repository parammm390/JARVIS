// External-operation idempotency ledger — one row per (domain_action_id, operation_key)
// in the external_operations table (packages/db/migrations/0006_security_controls.sql),
// keyed by a real composite primary key so concurrent claims are enforced by Postgres
// itself, not app-level sequencing. Used by ScopedToolRegistry (registry.ts) so a
// retried execution (reflection retry, a resumed LangGraph thread) never re-fires an
// already-completed external side effect like sending an SMS or syncing an invoice.

import { withTenant, externalOperations } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { redactStructured } from "@finnor/security";

export type ExternalOperationRow = typeof externalOperations.$inferSelect;

export type ClaimResult = { claimed: true } | { claimed: false; existing: ExternalOperationRow };

export async function claimExternalOperation(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  requestHash: string,
  provider?: string,
  businessEffectId?: string,
): Promise<ClaimResult> {
  return withTenant(tenantId, async (db) => {
    let existing: ExternalOperationRow | undefined;
    for (let attempt = 0; attempt < 2 && !existing; attempt += 1) {
      const [row] = await db
        .insert(externalOperations)
        .values({ tenantId, domainActionId, businessEffectId: businessEffectId ?? null, operationKey, provider: provider ?? null, requestHash, status: "running" })
        .onConflictDoNothing({ target: [externalOperations.domainActionId, externalOperations.operationKey] })
        .returning();
      if (row) return { claimed: true } as const;
      [existing] = await db
        .select()
        .from(externalOperations)
        .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey)));
    }
    // Never execute a consequential provider call without owning a durable claim.
    // READ COMMITTED should reveal a conflict winner to the following SELECT; if an
    // administrative delete or an unexpected visibility fault prevents that, fail
    // closed instead of letting two callers dispatch the same effect.
    if (!existing) throw new Error("External operation claim could not be established safely");
    if ((existing.businessEffectId ?? null) !== (businessEffectId ?? null)) {
      throw new Error("External operation effect conflict: refusing to reuse an idempotency claim for a different Business Effect");
    }
    // Idempotency protects against re-doing a SUCCESSFUL side effect (never send the
    // same SMS twice) — it must NOT block a legitimate reflection retry after a
    // genuine failure, since retrying a failed send is exactly reflection's job, and a
    // failed attempt didn't actually deliver anything. Re-claim atomically: the
    // conditional WHERE status='failed' means only one concurrent retrier can win it.
    if (existing.status === "failed") {
      const [reclaimed] = await db
        .update(externalOperations)
        .set({ status: "running", requestHash, ...(provider ? { provider } : {}), updatedAt: new Date() })
        .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey), eq(externalOperations.status, "failed")))
        .returning();
      if (reclaimed) return { claimed: true } as const;
      const [refetched] = await db
        .select()
        .from(externalOperations)
        .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey)));
      return { claimed: false, existing: refetched ?? existing } as const;
    }
    return { claimed: false, existing } as const;
  });
}

/**
 * A losing concurrent claim can observe the winner's row while it's still `status:
 * "running"` — that's not a failure, the winner just hasn't finished yet. Poll briefly
 * for it to settle rather than reporting a false "not ok" for a call that's actually
 * still in progress. Bounded (2s) so a genuinely stuck row (e.g. the winner's process
 * crashed mid-call) doesn't hang the loser forever.
 */
export async function awaitExternalOperationResolution(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  row: ExternalOperationRow,
): Promise<ExternalOperationRow> {
  let current = row;
  const deadline = Date.now() + 2_000;
  while (current.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    const fresh = await withTenant(tenantId, (db) =>
      db
        .select()
        .from(externalOperations)
        .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey))),
    );
    if (fresh[0]) current = fresh[0];
  }
  return current;
}

export async function recordExternalOperationResult(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  status: "succeeded" | "failed" | "unknown",
  response: Record<string, unknown>,
): Promise<void> {
  const redacted = redactStructured(response) as Record<string, unknown>;
  // Provider/native record identifiers are required to resume a multi-step effect
  // after a crash (for example: replay a successful contact upsert, then send the
  // SMS to that contact). They are opaque operational keys, not message content or
  // phone/email PII. Preserve only this small allowlist after structural redaction;
  // without it the cached replay returned "[REDACTED]" as contactId and made a safe
  // retry fail before the send.
  for (const key of ["id", "contactId", "householdId", "messageId", "campaignId", "visitId", "appointmentId", "callId", "communicationIdentityId"]) {
    if (typeof response[key] === "string") redacted[key] = response[key];
  }
  await withTenant(tenantId, (db) =>
    db
      .update(externalOperations)
      // Cached results are replayed internally, but they are still durable customer
      // data. Keep only the minimum structured result and redact direct identifiers
      // before persisting the ledger.
      .set({ status, response: redacted, updatedAt: new Date() })
      .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey))),
  );
}

/** Explicit provider reconciliation is the only way an unknown operation becomes a
 * known success/failure. The caller supplies provider evidence, which is redacted by
 * the same persistence path as ordinary results. */
export async function reconcileExternalOperation(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  status: "succeeded" | "failed",
  evidence: Record<string, unknown>,
): Promise<ExternalOperationRow> {
  const redacted = redactStructured(evidence) as Record<string, unknown>;
  return withTenant(tenantId, async (db) => {
    const [row] = await db
      .update(externalOperations)
      .set({ status, response: redacted, updatedAt: new Date() })
      .where(and(
        eq(externalOperations.domainActionId, domainActionId),
        eq(externalOperations.operationKey, operationKey),
        // A stale running row can represent a process crash after provider dispatch;
        // reconciliation may settle it too, but normal succeeded/failed rows are final.
        sql`${externalOperations.status} IN ('unknown','running')`,
      ))
      .returning();
    if (!row) throw new Error("External operation is not awaiting reconciliation");
    return row;
  });
}

export async function markExternalOperationUnknown(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  evidence: Record<string, unknown> = {},
): Promise<void> {
  await recordExternalOperationResult(tenantId, domainActionId, operationKey, "unknown", evidence);
}
