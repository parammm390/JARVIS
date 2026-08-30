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
      corpusHash: "9c6b01f4c6e1507eacce9041bfe86464e6b99302d2946926381fb8c546992e35",
      cases: expect.any(Array),
    });
    expect(p0.cases).toHaveLength(24);
    expect(p0.cases.flatMap((entry) => entry.selectors)).toHaveLength(40);
    expect(p1.corpusHash).toBe("2efea961984d5a1b819dd85aa4001c414bac779353023ab4ea7cfd1df86fada1");
    expect(p1.cases).toHaveLength(31);
    expect(p1.cases.flatMap((entry) => entry.selectors)).toHaveLength(70);
    expect(combined.combined).toMatchObject({ categoryCases: 55, selectorEntries: 110, uniqueSelectors: 109 });
    const lockedHash = combined.combined.corpusHash;
    const hashInput = structuredClone(combined) as Omit<typeof combined, "combined"> & {
      combined: Omit<typeof combined.combined, "corpusHash"> & { corpusHash?: string };
    };
    delete hashInput.combined.corpusHash;
    expect(lockedHash).toBe("c6d92a7bcd3e5dfb6fe612f4018fbed1c6234dc848874ac86bca5be26c4f5eb1");
    expect(lockedHash).toBe(hash(hashInput));
  });
});
