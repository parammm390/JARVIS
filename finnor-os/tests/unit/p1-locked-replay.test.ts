import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

describe("P1 extension of the certified P0 replay corpus", () => {
  it("retains P0 unchanged and locks exact combined category, selector, and hash counts", () => {
    const p0 = JSON.parse(readFileSync(resolve(root, "architecture/p0/replay-corpus.json"), "utf8")) as {
      cases: Array<{ selectors: Array<{ file: string; title: string }> }>;
      corpusHash: string;
    };
    const p1 = JSON.parse(readFileSync(resolve(root, "packages/operational-ir/fixtures/locked-cases.json"), "utf8")) as typeof p0;
    const combined = JSON.parse(readFileSync(resolve(root, "architecture/p1/replay-corpus.json"), "utf8")) as {
      p0Corpus: Record<string, unknown>;
      p1Extension: Record<string, unknown>;
      combined: { categoryCases: number; selectorEntries: number; uniqueSelectors: number; corpusHash: string };
    };
    expect(p0).toMatchObject({
      corpusHash: "68383cc0070064ffa64935ada38bcb62f6435ff2633061c9c4bd3e1ada9faf4f",
      cases: expect.any(Array),
    });
    expect(p0.cases).toHaveLength(24);
    expect(p0.cases.flatMap((entry) => entry.selectors)).toHaveLength(40);
    expect(p1.corpusHash).toBe("f14775c8982fd4be5a811c41540b352ee806b6b9fbc13baab3f6e3df6ac4739c");
    expect(p1.cases).toHaveLength(31);
    expect(p1.cases.flatMap((entry) => entry.selectors)).toHaveLength(71);
    expect(combined.combined).toMatchObject({ categoryCases: 55, selectorEntries: 111, uniqueSelectors: 110 });
    const lockedHash = combined.combined.corpusHash;
    const hashInput = structuredClone(combined) as Omit<typeof combined, "combined"> & {
      combined: Omit<typeof combined.combined, "corpusHash"> & { corpusHash?: string };
    };
    delete hashInput.combined.corpusHash;
    expect(lockedHash).toBe("519a384f4537afb7b2cae9465fed98377956b5baa83cc2f7cda840575029f010");
    expect(lockedHash).toBe(hash(hashInput));
  });
});
