// Capability contract + binding types, and the generic execution wrapper that claims an
// integration_operations row before calling out. This generalizes the existing
// external_operations claim/reclaim dance (packages/tools/src/idempotent-call.ts) from
// being keyed by domain_action_id to being keyed by workflow_step_id.
//
// RetryPolicy is redeclared here (not imported from @finnor/tools) deliberately: contract
// implementations live in @finnor/tools/src/capabilities/* and import CapabilityContract/
// CapabilityBinding FROM this package, so this package must not depend back on
// @finnor/tools — that would be circular. The shape is intentionally identical to
// packages/tools/src/wrap.ts's RetryPolicy.

import { withTenant, integrationOperations, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { maybeChaosKill } from "./chaos";

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  timeoutMs: number;
}

export interface CapabilityContract<TIn, TOut> {
  domain: "scheduling" | "communications" | "crm" | "accounting" | "marketing" | "inventory" | "documents";
  capability: string;
  version: number;
  idempotencyKeyFrom(input: TIn): string;
  retryPolicy: RetryPolicy;
  requiredPermission: string;
  piiAllowlist: readonly string[];
  /** false ⇒ a post-commit-pre-ack crash always opens a reconciliation_case; the
   *  runtime never auto-retries a call whose real-world delivery is unknown. */
  retryOnUnknown: boolean;
}

export interface CapabilityBinding<TIn, TOut> {
  name: string;
  call(input: TIn): Promise<TOut>;
  reconcile?(operationKey: string): Promise<"delivered" | "not_delivered" | "unknown">;
  compensate?(input: TIn, output: TOut): Promise<void>;
}

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type CapabilityResult<TOut> = { ok: true; output: TOut } | { ok: false; error: string };

/**
 * Applies the contract's retryPolicy around a binding call — timeout per attempt, then
 * exponential backoff retry, mirroring packages/tools/src/wrap.ts's wrappedCall exactly
 * (duplicated rather than imported, to avoid a circular package dependency — see file
 * header). An error is retryable unless it explicitly sets `retryable: false` (e.g. the
 * emulators' AuthFaultError) — same convention as wrap.ts's IntegrationError.
 */
async function withRetryAndTimeout<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`capability call timed out after ${policy.timeoutMs}ms`)), policy.timeoutMs),
        ),
      ]);
    } catch (err) {
      lastErr = err;
      const retryable = (err as { retryable?: boolean }).retryable !== false;
      if (!retryable || attempt === policy.attempts) break;
      await new Promise((r) => setTimeout(r, policy.baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

export async function executeCapability<TIn, TOut>(
  tenantId: string,
  workflowStepId: string,
  contract: CapabilityContract<TIn, TOut>,
  binding: CapabilityBinding<TIn, TOut>,
  input: TIn,
): Promise<CapabilityResult<TOut>> {
  const operationKey = contract.idempotencyKeyFrom(input);
  const requestHash = hashInput(input);

  const claim = await withTenant(tenantId, async (db) => {
    const [row] = await db
      .insert(integrationOperations)
      .values({ tenantId, workflowStepId, operationKey, capability: contract.capability, requestHash, status: "running" })
      .onConflictDoNothing({ target: [integrationOperations.workflowStepId, integrationOperations.operationKey] })
      .returning();
    if (row) return { claimed: true as const };
    const [existing] = await db
      .select()
      .from(integrationOperations)
      .where(and(eq(integrationOperations.workflowStepId, workflowStepId), eq(integrationOperations.operationKey, operationKey)));
    return { claimed: false as const, existing };
  });

  if (!claim.claimed) {
    const existing = claim.existing!;
    if (existing.status === "succeeded") return { ok: true, output: existing.response as TOut };
    if (existing.status === "running") return { ok: false, error: "operation already in flight" };
    // status === 'failed' or 'unknown': reclaim the row and take a fresh attempt below —
    // a failed/unknown-but-since-reconciled attempt didn't durably block a retry.
    await withTenant(tenantId, (db) =>
      db
        .update(integrationOperations)
        .set({ status: "running", requestHash, updatedAt: new Date() })
        .where(and(eq(integrationOperations.workflowStepId, workflowStepId), eq(integrationOperations.operationKey, operationKey))),
    );
  }

  let output: TOut;
  try {
    output = await withRetryAndTimeout(() => binding.call(input), contract.retryPolicy);
  } catch (err) {
    await withTenant(tenantId, (db) =>
      db
        .update(integrationOperations)
        .set({ status: "failed", response: { error: (err as Error).message }, updatedAt: new Date() })
        .where(and(eq(integrationOperations.workflowStepId, workflowStepId), eq(integrationOperations.operationKey, operationKey))),
    );
    return { ok: false, error: (err as Error).message };
  }

  // The real effect above already happened. Simulate the process dying before this
  // result is ever written back, to prove the recovery path treats it as "unknown
  // delivery" rather than either a silent duplicate or a lost update.
  maybeChaosKill("post_commit_pre_ack");

  await withTenant(tenantId, (db) =>
    db
      .update(integrationOperations)
      .set({ status: "succeeded", response: output as Record<string, unknown>, updatedAt: new Date() })
      .where(and(eq(integrationOperations.workflowStepId, workflowStepId), eq(integrationOperations.operationKey, operationKey))),
  );

  return { ok: true, output };
}
