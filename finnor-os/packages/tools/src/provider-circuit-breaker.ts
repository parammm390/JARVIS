// Phase 4 (§4.4): durable circuit breaker for the 9 capability-provider bindings.
// Distinct from ./provider-health.ts (that one is an in-process LLM-fallback signal,
// Phase 13, deliberately per-process — see its own header). This one has to be
// Postgres-backed: real provider calls happen inside short-lived serverless
// invocations (Vercel API routes, worker job handlers) with no shared process memory,
// so "3 consecutive failures" only means anything if it survives between calls.

import { adminDb, providerCircuitState } from "@finnor/db";
import { eq, sql } from "drizzle-orm";
import { logWithTrace } from "./logger";

const OPEN_AFTER_CONSECUTIVE_FAILURES = 3;
// A3.T3: real half-open recovery — before this, an opened breaker refused every
// attempt forever, since nothing that could ever call recordProviderSuccess() again
// (withCircuitBreaker itself refused the call) was left running. 60s matches the
// plan's own "5 fails -> open, 60s half-open" (this repo opens at 3, not 5 — see the
// existing OPEN_AFTER_CONSECUTIVE_FAILURES comment history; kept as-is, not part of
// this task's scope to change the threshold).
const OPEN_COOLDOWN_MS = 60_000;

export interface CircuitState {
  provider: string;
  state: "closed" | "open";
  consecutiveFailures: number;
  openedAt?: Date | null;
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
 *  from the caller's stale snapshot) so concurrent failing calls can't undercount.
 *  A failure recorded while ALREADY open (a failed half-open probe, see
 *  withCircuitBreaker) re-stamps openedAt so the cooldown restarts from now — without
 *  this, a probe that fails would leave the old openedAt in place and the very next
 *  check would immediately think the cooldown had elapsed again, busy-looping probes
 *  instead of actually waiting out OPEN_COOLDOWN_MS. */
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
  if (row!.state === "open") {
    const [restamped] = await adminDb()
      .update(providerCircuitState)
      .set({ openedAt: new Date() })
      .where(eq(providerCircuitState.provider, provider))
      .returning();
    return { provider, state: "open", consecutiveFailures: restamped!.consecutiveFailures, openedAt: restamped!.openedAt };
  }
  if (row!.consecutiveFailures >= OPEN_AFTER_CONSECUTIVE_FAILURES) {
    const [opened] = await adminDb()
      .update(providerCircuitState)
      .set({ state: "open", openedAt: new Date() })
      .where(eq(providerCircuitState.provider, provider))
      .returning();
    return { provider, state: opened!.state as "open", consecutiveFailures: opened!.consecutiveFailures, openedAt: opened!.openedAt };
  }
  return { provider, state: row!.state as "closed" | "open", consecutiveFailures: row!.consecutiveFailures, openedAt: row!.openedAt };
}

export async function circuitSnapshot(provider: string): Promise<CircuitState> {
  const row = await getOrInit(provider);
  return { provider, state: row.state as "closed" | "open", consecutiveFailures: row.consecutiveFailures, openedAt: row.openedAt };
}

export interface CircuitBreakerMeta {
  tenantId?: string;
  traceId?: string;
}

/** Wraps a real provider call with breaker enforcement: refuses to even attempt the
 *  call while open AND still within the cooldown, records the real outcome either
 *  way. Never used to decide emulator-vs-real — only to decide "attempt vs degrade"
 *  once a binding is already real.
 *
 *  Half-open recovery (A3.T3): once OPEN_COOLDOWN_MS has passed since openedAt, the
 *  NEXT call is let through as a single probe rather than refused forever — success
 *  closes the breaker (recordProviderSuccess), failure re-opens it and restarts the
 *  cooldown (recordProviderFailure's own re-stamping above). Before this, an opened
 *  breaker had no path back to closed short of someone manually calling
 *  recordProviderSuccess — which nothing did, since this function itself refused
 *  every subsequent attempt. */
export async function withCircuitBreaker<T>(provider: string, fn: () => Promise<T>, meta: CircuitBreakerMeta = {}): Promise<T> {
  const snap = await circuitSnapshot(provider);
  const log = logWithTrace({ provider, ...meta });
  if (snap.state === "open") {
    const cooldownElapsed = Date.now() - (snap.openedAt?.getTime() ?? 0) >= OPEN_COOLDOWN_MS;
    if (!cooldownElapsed) {
      log.warn({ event: "circuit_breaker_refused", consecutiveFailures: snap.consecutiveFailures }, `circuit breaker open for ${provider} — call refused`);
      throw new Error(`degraded: awaiting ${provider} (circuit breaker open after repeated failures)`);
    }
    log.info({ event: "circuit_breaker_half_open_probe" }, `circuit breaker cooldown elapsed for ${provider} — attempting one probe call`);
  }
  try {
    const result = await fn();
    await recordProviderSuccess(provider);
    if (snap.state === "open") log.info({ event: "circuit_breaker_closed" }, `circuit breaker for ${provider} closed — probe succeeded`);
    return result;
  } catch (err) {
    const after = await recordProviderFailure(provider);
    if (after.state === "open") {
      log.error(
        { event: "circuit_breaker_open", consecutiveFailures: after.consecutiveFailures, err: (err as Error).message },
        `circuit breaker for ${provider} is open`,
      );
    }
    throw err;
  }
}
