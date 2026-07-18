// Phase 13 Part B: the in-process LLM provider health tracker, and CompositeProvider's
// health-aware ordering built on top of it. No network calls — fake LLMProvider
// implementations drive the ordering assertions, same style as observability.test.ts's
// Sentry-mocking (module state is real here, so resetProviderHealth() between cases
// takes the place of a mock reset).

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordOutcome,
  healthSnapshot,
  isDegraded,
  resetProviderHealth,
  CompositeProvider,
  registerProvider,
  resolveProvider,
  type LLMProvider,
} from "@finnor/tools";

describe("provider-health — recordOutcome / healthSnapshot / isDegraded", () => {
  beforeEach(() => resetProviderHealth());

  it("an unrecorded provider has an empty, non-degraded snapshot", () => {
    const snap = healthSnapshot("nobody-called-this");
    expect(snap).toEqual({
      provider: "nobody-called-this",
      window: 0,
      failures: 0,
      failureRate: 0,
      p50LatencyMs: null,
      consecutiveFailures: 0,
      lastFailureAt: null,
    });
    expect(isDegraded("nobody-called-this")).toBe(false);
  });

  it("3 consecutive failures degrade a provider regardless of window size", () => {
    recordOutcome("p", false, 100);
    recordOutcome("p", false, 100);
    expect(isDegraded("p")).toBe(false); // only 2 consecutive so far
    recordOutcome("p", false, 100);
    expect(isDegraded("p")).toBe(true);
    const snap = healthSnapshot("p");
    expect(snap.consecutiveFailures).toBe(3);
    expect(snap.lastFailureAt).not.toBeNull();
  });

  it("a success resets the consecutive-failure streak", () => {
    recordOutcome("p", false, 50);
    recordOutcome("p", false, 50);
    recordOutcome("p", true, 50);
    expect(healthSnapshot("p").consecutiveFailures).toBe(0);
    expect(isDegraded("p")).toBe(false);
  });

  it("degrades on failure rate only once the minimum sample size is reached", () => {
    // 6 failures, 3 successes, interleaved so consecutiveFailures never hits 3 —
    // isolates the failureRate branch of isDegraded from the consecutive branch.
    const pattern = [false, false, true, false, false, true, false, true, false];
    for (const ok of pattern) recordOutcome("p", ok, 10);
    expect(healthSnapshot("p").window).toBe(9);
    expect(healthSnapshot("p").failureRate).toBeCloseTo(6 / 9);
    expect(healthSnapshot("p").consecutiveFailures).toBe(1);
    expect(isDegraded("p")).toBe(false); // window < 10 yet

    recordOutcome("p", false, 10); // 10th sample, failureRate 7/10 = 0.7 > 0.5
    expect(healthSnapshot("p").window).toBe(10);
    expect(healthSnapshot("p").consecutiveFailures).toBe(2);
    expect(isDegraded("p")).toBe(true);
  });

  it("exactly 0.5 failure rate is NOT degraded (strictly greater than, per spec)", () => {
    // Interleaved so consecutiveFailures never hits 3 — isolates the boundary check.
    const pattern = [true, false, true, false, true, false, true, false, true, false];
    for (const ok of pattern) recordOutcome("p", ok, 10);
    expect(healthSnapshot("p").failureRate).toBeCloseTo(0.5);
    expect(healthSnapshot("p").consecutiveFailures).toBe(1);
    expect(isDegraded("p")).toBe(false);
  });

  it("the window is capped at 50 samples — oldest fall off first", () => {
    for (let i = 0; i < 60; i++) recordOutcome("p", true, i);
    const snap = healthSnapshot("p");
    expect(snap.window).toBe(50);
    // the first 10 samples (latency 0-9) should have fallen off; median of 10..59 is 34 or 35
    expect(snap.p50LatencyMs).toBeGreaterThanOrEqual(34);
  });

  it("p50LatencyMs is the median of recorded latencies", () => {
    for (const ms of [10, 20, 30]) recordOutcome("p", true, ms);
    expect(healthSnapshot("p").p50LatencyMs).toBe(20);
  });

  it("resetProviderHealth() clears all providers", () => {
    recordOutcome("p", false, 10);
    resetProviderHealth();
    expect(healthSnapshot("p").window).toBe(0);
    expect(isDegraded("p")).toBe(false);
  });

  it("providers are tracked independently", () => {
    recordOutcome("a", false, 10);
    recordOutcome("a", false, 10);
    recordOutcome("a", false, 10);
    expect(isDegraded("a")).toBe(true);
    expect(isDegraded("b")).toBe(false);
  });
});

function fakeProvider(name: string, calls: string[], behavior: "ok" | "fail"): LLMProvider {
  return {
    name,
    async complete() {
      calls.push(name);
      if (behavior === "fail") throw new Error(`${name} failed`);
      return `${name}-response`;
    },
  };
}

describe("CompositeProvider — health-aware ordering", () => {
  beforeEach(() => resetProviderHealth());

  it("with no history, tries providers in the given order", async () => {
    const calls: string[] = [];
    const composite = new CompositeProvider([fakeProvider("first", calls, "ok"), fakeProvider("second", calls, "ok")]);
    await composite.complete({ system: "s", user: "u" });
    expect(calls).toEqual(["first"]);
  });

  it("once a provider is driven degraded, the composite tries the OTHER provider first — never drops the degraded one", async () => {
    const calls: string[] = [];
    // Drive "flaky" degraded via 3 consecutive real failed complete() calls.
    const flaky = fakeProvider("flaky", calls, "fail");
    const solid = fakeProvider("solid", calls, "ok");
    const preDegrade = new CompositeProvider([flaky]);
    for (let i = 0; i < 3; i++) {
      await expect(preDegrade.complete({ system: "s", user: "u" })).rejects.toThrow();
    }
    expect(isDegraded("flaky")).toBe(true);
    calls.length = 0;

    const composite = new CompositeProvider([flaky, solid]);
    const text = await composite.complete({ system: "s", user: "u" });
    expect(text).toBe("solid-response");
    // "solid" was called first despite "flaky" being listed first in the constructor —
    // proves reordering, not removal. "flaky" is never called at all here because
    // "solid" (tried first) already succeeds — the composite short-circuits on the
    // first success, same as before this phase.
    expect(calls).toEqual(["solid"]);
  });

  it("if every provider is degraded, order is unchanged from the original (falls through the last resort)", async () => {
    const calls: string[] = [];
    const a = fakeProvider("a-degraded", calls, "fail");
    const b = fakeProvider("b-degraded", calls, "fail");
    for (let i = 0; i < 3; i++) {
      await expect(new CompositeProvider([a]).complete({ system: "s", user: "u" })).rejects.toThrow();
    }
    for (let i = 0; i < 3; i++) {
      await expect(new CompositeProvider([b]).complete({ system: "s", user: "u" })).rejects.toThrow();
    }
    expect(isDegraded("a-degraded")).toBe(true);
    expect(isDegraded("b-degraded")).toBe(true);
    calls.length = 0;

    const composite = new CompositeProvider([a, b]);
    await expect(composite.complete({ system: "s", user: "u" })).rejects.toThrow(); // both fail
    // both degraded → the "non-degraded first" partition is empty → original order
    // falls out unchanged → "a-degraded" is still tried before "b-degraded".
    expect(calls).toEqual(["a-degraded", "b-degraded"]);
  });
});

describe("resolveProvider — policy-pinned providers are untouched by health reordering", () => {
  beforeEach(() => resetProviderHealth());

  it("pinning a specific provider name always resolves to that provider, degraded or not", async () => {
    const calls: string[] = [];
    registerProvider("pinned-test-provider", () => fakeProvider("pinned-test-provider", calls, "fail"));

    const wrapped = resolveProvider("pinned-test-provider");
    for (let i = 0; i < 3; i++) {
      await expect(wrapped.complete({ system: "s", user: "u" })).rejects.toThrow();
    }
    expect(isDegraded("pinned-test-provider")).toBe(true);

    // Resolving the same pinned name again still returns a provider with that exact
    // name — degradation never causes resolveProvider to silently substitute a
    // different provider for an explicit config choice.
    const stillPinned = resolveProvider("pinned-test-provider");
    expect(stillPinned.name).toBe("pinned-test-provider");
  });
});
