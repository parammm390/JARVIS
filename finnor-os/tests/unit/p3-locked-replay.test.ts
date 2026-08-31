import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runLockedCorpus } from "../../packages/epistemic-runtime/fixtures/locked-corpus";

const root = resolve(import.meta.dirname, "../..");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P3 extension of the certified P0, P1, and P2 replay corpora", () => {
  it("runs all 24 frozen P3 cases and locks exact phase and combined counts and hashes", async () => {
    const fixtureBytes = readFileSync(resolve(root, "packages/epistemic-runtime/fixtures/locked-cases.json"));
    const manifest = JSON.parse(readFileSync(resolve(root, "architecture/p3/replay-corpus.json"), "utf8")) as {
      extensionCases: number;
      fixtureSha256: string;
      liveExternalDependencies: number;
      phaseCorpora: Record<"p0" | "p1" | "p2" | "p3", { categoryCases: number; corpusHash: string }>;
      combined: { categoryCases: number; selectorEntries: number; uniqueSelectors: number; corpusHash: string };
    };
    const results = await runLockedCorpus();
    expect(results).toHaveLength(24);
    expect(results.filter((result) => !result.passed)).toEqual([]);
    expect(manifest).toMatchObject({
      extensionCases: 24,
      fixtureSha256: "ce3632ddf4c3a004347d365361ae307d04257c22ba31672c5fea178ec70c42fc",
      liveExternalDependencies: 0,
      phaseCorpora: {
        p0: { categoryCases: 24, corpusHash: "9c6b01f4c6e1507eacce9041bfe86464e6b99302d2946926381fb8c546992e35" },
        p1: { categoryCases: 31, corpusHash: "2efea961984d5a1b819dd85aa4001c414bac779353023ab4ea7cfd1df86fada1" },
        p2: { categoryCases: 25, corpusHash: "4717889a153ad82aac276c850b429c1b6f58dc0bbc5cfe69b8ded0801b05c5c2" },
        p3: { categoryCases: 24, corpusHash: "ce3632ddf4c3a004347d365361ae307d04257c22ba31672c5fea178ec70c42fc" },
      },
      combined: {
        categoryCases: 104,
        selectorEntries: 151,
        uniqueSelectors: 150,
        corpusHash: "62da72452f6d4c0e9a87f307c8f6e8253c966beebaed2f0615a65d427324b2d5",
      },
    });
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(manifest.fixtureSha256);
    const hashInput = structuredClone(manifest);
    delete (hashInput.combined as Partial<typeof hashInput.combined>).corpusHash;
    expect(manifest.combined.corpusHash).toBe(createHash("sha256").update(JSON.stringify(canonicalize(hashInput))).digest("hex"));
  });
});
