import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { queryProgram } from "../fixtures/programs";
import {
  computerWriteProgram,
  declaredCommunicationProgram,
  externalSpendProgram,
  financialWriteProgram,
  internalCanonicalWriteProgram,
  parallelConflictingWritesProgram,
  piiResearchExportProgram,
  validCompensationProgram,
} from "../fixtures/p2-programs";

const REQUIRED_CASES = [
  "effect_taxonomy_and_information_lattice", "hash_participating_effect_semantics", "read_only_and_pii_reads",
  "sequence_effect_union", "branch_possible_and_guaranteed_effects", "parallel_conflicts_and_determinism",
  "compensation_composition", "wait_observation", "pii_external_export_rejection", "redaction_and_declassification_proof",
  "unclassified_export_fail_closed", "canonical_internal_write", "governed_communication",
  "financial_write_and_external_spend", "computer_mutation_and_exact_binding",
  "tenant_entity_type_freshness_and_binding_resolution", "capability_observation_and_resource_scope",
  "pre_postcondition_and_authority_shape", "unresolved_never_admissible", "irreversible_and_compensation_policy",
  "contradictory_hard_constraints", "unsupported_inference_and_fail_closed_lowering",
  "runtime_mapping_and_semantic_differential", "shadow_first_and_scoped_enforcement", "production_query_effect_shadow",
] as const;

interface CorpusManifest {
  baselineSha: string;
  p1CertifiedSha: string;
  p1Status: string;
  determinism: { liveLlm: boolean; liveProviders: boolean; network: boolean; database: boolean; clock: string; propertySeed: number; propertyRuns: number };
  fixtureSemanticHashes: Record<string, string>;
  cases: Array<{ id: string; selectors: Array<{ file: string; title: string }> }>;
  corpusHash: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P2 locked deterministic Operational Effect corpus", () => {
  it("locks every P2 category, fixture hash, selector, clock, seed, and offline boundary", () => {
    const osRoot = resolve(import.meta.dirname, "../../..");
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/p2-locked-cases.json"), "utf8")) as CorpusManifest;
    expect(manifest).toMatchObject({
      baselineSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      p1CertifiedSha: "18d35eb27320a8b89377208d652e2230ce2b5deb",
      p1Status: "P1_PASS",
      determinism: { liveLlm: false, liveProviders: false, network: false, database: false, clock: "2026-08-30T04:00:00.000Z", propertySeed: 20260830, propertyRuns: 32 },
    });
    expect(manifest.cases.map((entry) => entry.id).sort()).toEqual([...REQUIRED_CASES].sort());
    expect(new Set(manifest.cases.map((entry) => entry.id)).size).toBe(manifest.cases.length);
    expect(manifest.cases).toHaveLength(25);
    const selectors = manifest.cases.flatMap((entry) => entry.selectors);
    expect(selectors).toHaveLength(41);
    expect(new Set(selectors.map((selector) => `${selector.file}\u0000${selector.title}`)).size).toBe(41);
    for (const selector of selectors) {
      expect(selector.file).not.toContain("/live/");
      expect(readFileSync(resolve(osRoot, selector.file), "utf8"), `${selector.file}#${selector.title}`).toContain(selector.title);
    }

    const fixtures = [
      queryProgram(), internalCanonicalWriteProgram(), declaredCommunicationProgram(), financialWriteProgram(), externalSpendProgram(),
      computerWriteProgram(true), piiResearchExportProgram(false), piiResearchExportProgram(true), parallelConflictingWritesProgram(), validCompensationProgram(),
    ];
    expect(manifest.fixtureSemanticHashes).toEqual(Object.fromEntries(fixtures.map((program) => [program.semanticId, program.irSemanticHash])));
    const { corpusHash: _locked, ...body } = manifest;
    const actual = createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
    expect(manifest.corpusHash).toBe(actual);
  });
});
