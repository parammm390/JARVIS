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
export function isDegraded(provider: string): boolean {
  const snap = healthSnapshot(provider);
  return snap.consecutiveFailures >= DEGRADED_CONSECUTIVE_FAILURES || (snap.window >= DEGRADED_MIN_SAMPLES && snap.failureRate > DEGRADED_FAILURE_RATE);
}

export function resetProviderHealth(): void {
  history.clear();
}
