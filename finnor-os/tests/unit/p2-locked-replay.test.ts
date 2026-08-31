import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P2 extension of the certified P0 and P1 replay corpora", () => {
  it("retains P0 and P1 hashes and locks exact P2 and combined counts and hashes", () => {
    const p0 = JSON.parse(readFileSync(resolve(root, "architecture/p0/replay-corpus.json"), "utf8")) as { cases: unknown[]; corpusHash: string };
    const p1 = JSON.parse(readFileSync(resolve(root, "packages/operational-ir/fixtures/locked-cases.json"), "utf8")) as { cases: unknown[]; corpusHash: string };
    const p2 = JSON.parse(readFileSync(resolve(root, "packages/operational-ir/fixtures/p2-locked-cases.json"), "utf8")) as { cases: unknown[]; corpusHash: string };
    const combined = JSON.parse(readFileSync(resolve(root, "architecture/p2/replay-corpus.json"), "utf8")) as {
      combined: { categoryCases: number; selectorEntries: number; uniqueSelectors: number; corpusHash: string };
    };
    expect(p0).toMatchObject({ cases: expect.any(Array), corpusHash: "9c6b01f4c6e1507eacce9041bfe86464e6b99302d2946926381fb8c546992e35" });
    expect(p0.cases).toHaveLength(24);
    expect(p1).toMatchObject({ cases: expect.any(Array), corpusHash: "2efea961984d5a1b819dd85aa4001c414bac779353023ab4ea7cfd1df86fada1" });
    expect(p1.cases).toHaveLength(31);
    expect(p2).toMatchObject({ cases: expect.any(Array), corpusHash: "4717889a153ad82aac276c850b429c1b6f58dc0bbc5cfe69b8ded0801b05c5c2" });
    expect(p2.cases).toHaveLength(25);
    expect(combined.combined).toEqual({
      categoryCases: 80,
      selectorEntries: 151,
      uniqueSelectors: 150,
      corpusHash: "fe50d82070cfd6dd4070ccbdb63db7bfed99eb7be1fe2ef7a5c061016943a5d5",
    });
    const input = structuredClone(combined) as typeof combined;
    delete (input.combined as Partial<typeof input.combined>).corpusHash;
    expect(combined.combined.corpusHash).toBe(createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex"));
  });
});
