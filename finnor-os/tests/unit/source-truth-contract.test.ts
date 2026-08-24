import { describe, expect, it } from "vitest";
import { freshnessState, observeExternalEffect, sourceTruthHash } from "@finnor/data-platform";

describe("Phase 4 source-truth contracts", () => {
  it("hashes canonical object state independent of key order", () => {
    expect(sourceTruthHash({ b: 2, a: { y: 2, x: 1 } })).toBe(sourceTruthHash({ a: { x: 1, y: 2 }, b: 2 }));
    expect(sourceTruthHash({ a: 1 })).not.toBe(sourceTruthHash({ a: 2 }));
  });

  it("computes fresh, stale, expired, and unknown from an explicit policy", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const policy = { scope: "accounting", maxAgeSeconds: 60, criticality: "consequential", staleBehavior: "refresh_then_block" } as const;
    expect(freshnessState(null, policy, now)).toBe("unknown");
    expect(freshnessState("2026-08-24T11:59:30.000Z", policy, now)).toBe("fresh");
    expect(freshnessState("2026-08-24T11:58:30.000Z", policy, now)).toBe("stale");
    expect(freshnessState("2026-08-24T11:55:00.000Z", policy, now)).toBe("expired");
  });

  it("classifies exact expected subsets without treating provider acceptance as proof", () => {
    const base = {
      tenantId: "00000000-0000-4000-8000-000000000001",
      businessEffectId: "00000000-0000-4000-8000-000000000002",
      integrationId: "00000000-0000-4000-8000-000000000003",
      provider: "quickbooks",
      externalObjectType: "invoice",
      externalId: "123",
      observedAt: "2026-08-24T12:00:00.000Z",
      expected: { amountUsd: 500, customer: { id: "42" } },
      evidence: { mechanism: "read_after_write" as const },
    };
    expect(observeExternalEffect({ ...base }).classification).toBe("unknown");
    expect(observeExternalEffect({ ...base, observed: { amountUsd: 500, customer: { id: "42", name: "Ada" }, ignored: true } }).classification).toBe("present");
    expect(observeExternalEffect({ ...base, observed: { amountUsd: 499, customer: { id: "42" } } })).toMatchObject({
      classification: "divergent",
      mismatches: [{ path: "amountUsd", expected: 500, observed: 499 }],
    });
    expect(observeExternalEffect({ ...base, definitelyAbsent: true }).classification).toBe("absent");
  });
});
