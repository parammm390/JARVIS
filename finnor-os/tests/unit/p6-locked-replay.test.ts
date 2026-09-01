import { createHash } from "node:crypto";
import { readFileSync, } from "node:fs";
import { resolve } from "node:path";
import { canonicalSerialize } from "@finnor/trace-compiler";
import { describe, expect, it } from "vitest";
import { P6_LOCKED_CASES, runP6LockedCorpus } from "../../packages/trace-compiler/fixtures/locked-corpus";

const OS_ROOT = resolve(import.meta.dirname, "../..");
const CANONICAL_HASH = "192d07f939b223f7ec0f3be3b202ef5ea704529a07e5746e54092316152d685c";
const RAW_HASH = "7bdfd7d17e4086c398e92fd1390e49adce8c92c0217096e7153032a8cc425dec";
const RESULT_HASH = "8e450419d22c780309299a8da0a3bd709d3ed10f23e99c2fc2ad8fae9b9d139a";
const COMBINED_HASH = "30c62819459c3c898378b8b4ab40381c4ff2a7293c8ba8936317cf48142fa35d";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P6 locked replay identity", () => {
  it("locks the 31-case extension corpus and combined P0-P6 identity", () => {
    const fixturePath = resolve(OS_ROOT, "packages/trace-compiler/fixtures/locked-cases.json");
    expect(createHash("sha256").update(readFileSync(fixturePath)).digest("hex")).toBe(RAW_HASH);
    expect(createHash("sha256").update(canonicalSerialize(P6_LOCKED_CASES)).digest("hex")).toBe(CANONICAL_HASH);
    expect(P6_LOCKED_CASES).toHaveLength(31);
    const results = runP6LockedCorpus();
    expect(results).toHaveLength(31);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(createHash("sha256").update(canonicalSerialize(results)).digest("hex")).toBe(RESULT_HASH);
    const manifest = JSON.parse(readFileSync(resolve(OS_ROOT, "architecture/p6/replay-corpus.json"), "utf8"));
    expect(manifest).toMatchObject({ extensionCases: 31, liveExternalDependencies: 0, combined: { categoryCases: 187, corpusHash: COMBINED_HASH } });
    delete manifest.combined.corpusHash;
    expect(createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex")).toBe(COMBINED_HASH);
  });
});
