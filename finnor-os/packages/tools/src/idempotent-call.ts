// External-operation idempotency ledger — one row per (domain_action_id, operation_key)
// in the external_operations table (packages/db/migrations/0006_security_controls.sql),
// keyed by a real composite primary key so concurrent claims are enforced by Postgres
// itself, not app-level sequencing. Used by ScopedToolRegistry (registry.ts) so a
// retried execution (reflection retry, a resumed LangGraph thread) never re-fires an
// already-completed external side effect like sending an SMS or syncing an invoice.

import { withTenant, externalOperations } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { redactStructured } from "@finnor/security";

export type ExternalOperationRow = typeof externalOperations.$inferSelect;

export type ClaimResult = { claimed: true } | { claimed: false; existing: ExternalOperationRow };

export async function claimExternalOperation(
  tenantId: string,
  domainActionId: string,
  operationKey: string,
  requestHash: string,
): Promise<ClaimResult> {
  return withTenant(tenantId, async (db) => {
    const [row] = await db
      .insert(externalOperations)
      .values({ tenantId, domainActionId, operationKey, requestHash, status: "running" })
      .onConflictDoNothing({ target: [externalOperations.domainActionId, externalOperations.operationKey] })
      .returning();
    if (row) return { claimed: true } as const;
    const [existing] = await db
      .select()
      .from(externalOperations)
      .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey)));
    // The INSERT lost the race but the winner hasn't committed its row yet (vanishingly
    // rare, sub-millisecond window) — treat as claimed rather than crash; the winner's
    // own claim call already has the real row.
    if (!existing) return { claimed: true } as const;
    // Idempotency protects against re-doing a SUCCESSFUL side effect (never send the
    // same SMS twice) — it must NOT block a legitimate reflection retry after a
    // genuine failure, since retrying a failed send is exactly reflection's job, and a
    // failed attempt didn't actually deliver anything. Re-claim atomically: the
    // conditional WHERE status='failed' means only one concurrent retrier can win it.
    if (existing.status === "failed") {
      const [reclaimed] = await db
        .update(externalOperations)
        .set({ status: "running", requestHash, updatedAt: new Date() })
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
  status: "succeeded" | "failed",
  response: Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db
      .update(externalOperations)
      // Cached results are replayed internally, but they are still durable customer
      // data. Keep only the minimum structured result and redact direct identifiers
      // before persisting the ledger.
      .set({ status, response: redactStructured(response), updatedAt: new Date() })
      .where(and(eq(externalOperations.domainActionId, domainActionId), eq(externalOperations.operationKey, operationKey))),
  );
}
