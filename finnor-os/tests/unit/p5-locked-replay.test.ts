import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalSerialize, canonicalizeIrFragment } from "@finnor/operational-ir";
import { describe, expect, it } from "vitest";
import { P5_LOCKED_CASES, runP5LockedCorpus } from "../../packages/speculative-runtime/fixtures/locked-corpus";

const OS_ROOT = resolve(import.meta.dirname, "../..");
const CANONICAL_HASH = "0575d50dfa75c915fd0160b76c6eeb69df813336dd2c4e07733bc94805cf8d36";
const RAW_HASH = "1a5ec39882f37656e02dee9dd8938e467e0147e39dc1626ae0da16ef5c145fb0";
const COMBINED_HASH = "683d68028325d7747e82ddca8d155e0b3b4bff97ca2a6033ab25866fd5be1df1";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P5 locked replay identity", () => {
  it("locks the 26-case extension corpus and combined P0-P5 identity", async () => {
    const fixturePath = resolve(OS_ROOT, "packages/speculative-runtime/fixtures/locked-cases.json");
    expect(createHash("sha256").update(readFileSync(fixturePath)).digest("hex")).toBe(RAW_HASH);
    expect(createHash("sha256").update(canonicalSerialize(canonicalizeIrFragment(P5_LOCKED_CASES))).digest("hex")).toBe(CANONICAL_HASH);
    expect(P5_LOCKED_CASES).toHaveLength(26);
    expect(await runP5LockedCorpus()).toHaveLength(26);
    const manifest = JSON.parse(readFileSync(resolve(OS_ROOT, "architecture/p5/replay-corpus.json"), "utf8"));
    expect(manifest).toMatchObject({ extensionCases: 26, liveExternalDependencies: 0, combined: { categoryCases: 156, selectorEntries: 203, uniqueSelectors: 202, corpusHash: COMBINED_HASH } });
    delete manifest.combined.corpusHash;
    expect(createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex")).toBe(COMBINED_HASH);
  });
});
