// Phase 4 (§4.4): durable circuit breaker for the 9 capability-provider bindings.
// Distinct from ./provider-health.ts (that one is an in-process LLM-fallback signal,
// Phase 13, deliberately per-process — see its own header). This one has to be
// Postgres-backed: real provider calls happen inside short-lived serverless
// invocations (Vercel API routes, worker job handlers) with no shared process memory,
// so "3 consecutive failures" only means anything if it survives between calls.

import { adminDb, providerCircuitState } from "@finnor/db";
import { eq, sql } from "drizzle-orm";

const OPEN_AFTER_CONSECUTIVE_FAILURES = 3;

export interface CircuitState {
  provider: string;
  state: "closed" | "open";
  consecutiveFailures: number;
}

async function getOrInit(provider: string): Promise<typeof providerCircuitState.$inferSelect> {
  const [existing] = await adminDb().select().from(providerCircuitState).where(eq(providerCircuitState.provider, provider));
  if (existing) return existing;
  const [created] = await adminDb()
    .insert(providerCircuitState)
    .values({ provider })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await adminDb().select().from(providerCircuitState).where(eq(providerCircuitState.provider, provider));
  return row!;
}

/** True when the breaker is open — callers must NOT attempt the real provider call;
 *  the affected action should queue as degraded instead (never silently fall back to
 *  the emulator, per §0.3.10). */
export async function isCircuitOpen(provider: string): Promise<boolean> {
  const row = await getOrInit(provider);
  return row.state === "open";
}

export async function recordProviderSuccess(provider: string): Promise<void> {
  await adminDb()
    .insert(providerCircuitState)
    .values({ provider, consecutiveFailures: 0, state: "closed", lastSuccessAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: providerCircuitState.provider,
      set: { consecutiveFailures: 0, state: "closed", openedAt: null, lastSuccessAt: new Date(), updatedAt: new Date() },
    });
}

/** Records a real failure and opens the breaker once the threshold is hit. Uses an
 *  atomic UPDATE ... RETURNING off the DB's own current count (not a read-then-write
 *  from the caller's stale snapshot) so concurrent failing calls can't undercount. */
export async function recordProviderFailure(provider: string): Promise<CircuitState> {
  await getOrInit(provider); // ensure the row exists before the atomic increment below
  const [row] = await adminDb()
    .update(providerCircuitState)
    .set({
      consecutiveFailures: sql`${providerCircuitState.consecutiveFailures} + 1`,
      lastFailureAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(providerCircuitState.provider, provider))
    .returning();
  if (row!.consecutiveFailures >= OPEN_AFTER_CONSECUTIVE_FAILURES && row!.state === "closed") {
    const [opened] = await adminDb()
      .update(providerCircuitState)
      .set({ state: "open", openedAt: new Date() })
      .where(eq(providerCircuitState.provider, provider))
      .returning();
    return { provider, state: opened!.state as "open", consecutiveFailures: opened!.consecutiveFailures };
  }
  return { provider, state: row!.state as "closed" | "open", consecutiveFailures: row!.consecutiveFailures };
}

export async function circuitSnapshot(provider: string): Promise<CircuitState> {
  const row = await getOrInit(provider);
  return { provider, state: row.state as "closed" | "open", consecutiveFailures: row.consecutiveFailures };
}

/** Wraps a real provider call with breaker enforcement: refuses to even attempt the
 *  call while open, records the real outcome either way. Never used to decide
 *  emulator-vs-real — only to decide "attempt vs degrade" once a binding is already
 *  real. */
export async function withCircuitBreaker<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  if (await isCircuitOpen(provider)) {
    throw new Error(`degraded: awaiting ${provider} (circuit breaker open after repeated failures)`);
  }
  try {
    const result = await fn();
    await recordProviderSuccess(provider);
    return result;
  } catch (err) {
    await recordProviderFailure(provider);
    throw err;
  }
}
