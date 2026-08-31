import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomicProgram,
  branchProgram,
  compensationProgram,
  knownActionProgram,
  parallelProgram,
  queryProgram,
  sequenceProgram,
  waitProgram,
} from "../fixtures/programs";

const REQUIRED_CASES = [
  "actual_execution_models",
  "core_ir_construction",
  "serialization_repeatability",
  "semantic_hash_repeatability",
  "invalid_schema",
  "duplicate_semantic_ids",
  "malformed_dependencies",
  "dependency_cycles",
  "ambiguous_references",
  "hard_soft_constraints",
  "query_representation",
  "effect_representation",
  "observation_representation",
  "sequence",
  "parallel",
  "branch",
  "wait",
  "compensation",
  "budget",
  "compatibility_lowering",
  "planning_candidate_adapter",
  "legacy_ir_semantic_parity",
  "cross_tenant_forgery",
  "unsupported_lossy_adapters",
  "identity_domain_separation",
  "package_import_cycles",
  "pure_determinism",
  "semantic_diff",
  "shadow_no_mutation",
  "verification_nonweakening",
  "production_query_shadow",
] as const;

interface CorpusManifest {
  baselineSha: string;
  determinism: { liveLlm: boolean; liveProviders: boolean; network: boolean; database: boolean; clock: string; propertySeed: number };
  fixtureSemanticHashes: Record<string, string>;
  cases: Array<{ id: string; selectors: Array<{ file: string; title: string }> }>;
  corpusHash: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

describe("P1 locked deterministic Operational IR corpus", () => {
  it("locks every audited P1 semantic category, fixture hash, selector, clock, and seed", () => {
    const osRoot = resolve(import.meta.dirname, "../../..");
    const manifestPath = resolve(import.meta.dirname, "../fixtures/locked-cases.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CorpusManifest;
    expect(manifest.baselineSha).toBe("8fcd8a1cebcf92791047777c0d9c70e95fc7aad2");
    expect(manifest.determinism).toEqual(expect.objectContaining({
      liveLlm: false,
      liveProviders: false,
      network: false,
      database: false,
      clock: "2026-08-30T04:00:00.000Z",
      propertySeed: 20260830,
    }));
    expect(manifest.cases.map((entry) => entry.id).sort()).toEqual([...REQUIRED_CASES].sort());
    expect(new Set(manifest.cases.map((entry) => entry.id)).size).toBe(manifest.cases.length);
    expect(manifest.cases).toHaveLength(31);
    expect(manifest.cases.reduce((count, entry) => count + entry.selectors.length, 0)).toBe(70);
    for (const entry of manifest.cases) {
      expect(entry.selectors.length, entry.id).toBeGreaterThan(0);
      for (const selector of entry.selectors) {
        expect(selector.file).not.toContain("/live/");
        expect(readFileSync(resolve(osRoot, selector.file), "utf8"), `${selector.file}#${selector.title}`).toContain(selector.title);
      }
    }

    const fixtureHashes = Object.fromEntries([
      atomicProgram(),
      knownActionProgram(),
      queryProgram(),
      sequenceProgram(),
      parallelProgram(),
      branchProgram(),
      waitProgram(),
      compensationProgram(),
    ].map((program) => [program.semanticId, program.irSemanticHash]));
    expect(manifest.fixtureSemanticHashes).toEqual(fixtureHashes);

    const { corpusHash: _lockedHash, ...body } = manifest;
    const hash = createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
    expect(manifest.corpusHash).toBe(hash);
  });
});
