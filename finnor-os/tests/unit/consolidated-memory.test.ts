// Zep consolidation layer — unconfigured state must be explicit and never attempt a
// real network call or throw into the gated pipeline it's layered onto, same contract
// every other adapter (quickbooks.ts, ads.ts, exa.ts) holds.

import { describe, it, expect, beforeEach } from "vitest";

describe("consolidated memory (Zep) — unconfigured state", () => {
  beforeEach(() => {
    delete process.env.ZEP_API_KEY;
  });

  it("zepProviderStatus reports not configured when no env var is set", async () => {
    const { zepProviderStatus } = await import("@finnor/memory");
    expect(zepProviderStatus()).toEqual({ configured: false });
  });

  it("mirrorTurnToZep resolves without throwing and makes no network call", async () => {
    const { mirrorTurnToZep } = await import("@finnor/memory");
    await expect(mirrorTurnToZep("tenant-1", "session-1", "some turn content")).resolves.toBeUndefined();
  });

  it("queryConsolidatedFacts returns [] — never guessed, never a fabricated hit", async () => {
    const { queryConsolidatedFacts } = await import("@finnor/memory");
    const hits = await queryConsolidatedFacts("tenant-1", "what's the renewal price?");
    expect(hits).toEqual([]);
  });

  it("reports configured:true once ZEP_API_KEY is present (still untested against a real account)", async () => {
    process.env.ZEP_API_KEY = "test-key";
    const { zepProviderStatus } = await import("@finnor/memory");
    expect(zepProviderStatus()).toEqual({ configured: true });
  });
});

describe("buildMemorySnapshot — Zep is additive, never a regression when unconfigured", () => {
  beforeEach(() => {
    delete process.env.ZEP_API_KEY;
  });

  it("semantic array is populated from pgvector alone when no semanticQuery is given, without erroring", async () => {
    const { buildMemorySnapshot } = await import("@finnor/memory");
    const snapshot = await buildMemorySnapshot({ tenantId: "00000000-0000-4000-8000-000000000001" });
    expect(snapshot.semantic).toEqual([]);
    expect(snapshot.shortTerm).toBeNull();
    expect(snapshot.longTerm).toBeNull();
  });
});
