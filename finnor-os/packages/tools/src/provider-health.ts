// Per-process LLM provider health tracker (Phase 13 Part B, ground-truth §9): Sentry
// breadcrumbs recorded by withObservability() below are write-only — nothing anywhere
// reads them back, and Sentry's ingest is not a queryable local store. This module is
// the honest alternative: a small in-process sliding window of ok/fail/latency per
// provider, used to prefer healthy providers in a fallback chain.
//
// Scope is deliberately per-process — the worker and the API each see only their own
// call outcomes, which is correct-enough because provider selection happens where the
// calls happen; no cross-process store until real usage shows one is needed
// (measure-first rule, same as the rest of this phase).

const WINDOW = 50;
const DEGRADED_CONSECUTIVE_FAILURES = 3;
const DEGRADED_MIN_SAMPLES = 10;
const DEGRADED_FAILURE_RATE = 0.5;
const VOICE_LATENCY_MIN_SAMPLES = 3;
const DEFAULT_VOICE_P50_LATENCY_MS = 1_500;

interface Sample {
  ok: boolean;
  ms: number;
  at: number;
}

const history = new Map<string, Sample[]>();

export interface ProviderHealthSnapshot {
  provider: string;
  window: number; // samples considered, capped at WINDOW
  failures: number;
  failureRate: number; // failures/window, 0 when window===0
  p50LatencyMs: number | null;
  consecutiveFailures: number;
  lastFailureAt: string | null;
}

export function recordOutcome(provider: string, ok: boolean, ms: number): void {
  const samples = history.get(provider) ?? [];
  samples.push({ ok, ms, at: Date.now() });
  if (samples.length > WINDOW) samples.shift();
  history.set(provider, samples);
}

export function healthSnapshot(provider: string): ProviderHealthSnapshot {
  const samples = history.get(provider) ?? [];
  const window = samples.length;
  const failures = samples.filter((s) => !s.ok).length;
  const sortedMs = samples.map((s) => s.ms).sort((a, b) => a - b);
  let consecutiveFailures = 0;
  for (let i = samples.length - 1; i >= 0 && !samples[i]!.ok; i--) consecutiveFailures++;
  let lastFailureAt: string | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (!samples[i]!.ok) {
      lastFailureAt = new Date(samples[i]!.at).toISOString();
      break;
    }
  }
  return {
    provider,
    window,
    failures,
    failureRate: window === 0 ? 0 : failures / window,
    p50LatencyMs: window === 0 ? null : sortedMs[Math.floor((window - 1) / 2)]!,
    consecutiveFailures,
    lastFailureAt,
  };
}

// degraded ⇔ consecutiveFailures >= 3 OR (window >= 10 AND failureRate > 0.5)
// Failure health remains the default so existing non-voice callers keep the same
// semantics. Voice routing additionally treats a repeatedly slow provider as a poor
// live-call candidate; the threshold is deployment configuration, not a market claim.
export function isDegraded(provider: string, channel?: "voice" | "text" | "console" | "background"): boolean {
  const snap = healthSnapshot(provider);
  const failureDegraded = snap.consecutiveFailures >= DEGRADED_CONSECUTIVE_FAILURES || (snap.window >= DEGRADED_MIN_SAMPLES && snap.failureRate > DEGRADED_FAILURE_RATE);
  return failureDegraded || (channel === "voice" && isLatencyDegraded(provider));
}

export function isLatencyDegraded(provider: string): boolean {
  const snap = healthSnapshot(provider);
  const threshold = Number(process.env.LLM_VOICE_P50_LATENCY_MS ?? DEFAULT_VOICE_P50_LATENCY_MS);
  return Number.isFinite(threshold) && threshold > 0 && snap.window >= VOICE_LATENCY_MIN_SAMPLES && snap.p50LatencyMs !== null && snap.p50LatencyMs > threshold;
}

/** Stable health-aware ordering for a fallback chain. Voice callers prefer a
 * provider with observed latency over an unobserved one only when both have data;
 * this preserves the configured cold-start order while allowing live-call traffic
 * to move away from a provider that has become predictably slow. */
export function orderProvidersByHealth<T extends { name: string }>(providers: T[], channel?: "voice" | "text" | "console" | "background"): T[] {
  return providers
    .map((provider, index) => ({ provider, index, degraded: isDegraded(provider.name, channel), snapshot: healthSnapshot(provider.name) }))
    .sort((a, b) => {
      if (a.degraded !== b.degraded) return a.degraded ? 1 : -1;
      if (channel === "voice" && !a.degraded && !b.degraded && a.snapshot.p50LatencyMs !== null && b.snapshot.p50LatencyMs !== null && a.snapshot.p50LatencyMs !== b.snapshot.p50LatencyMs) {
        return a.snapshot.p50LatencyMs - b.snapshot.p50LatencyMs;
      }
      return a.index - b.index;
    })
    .map(({ provider }) => provider);
}

export function resetProviderHealth(): void {
  history.clear();
}
