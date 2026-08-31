import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARDED_REWRITE_RULES,
  PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION,
  PROGRAM_SEARCH_SMT_SOLVER_VERSION,
} from "../../packages/program-search/src/index";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, any>;
const contract = read("architecture/p4/search-contract.json");
const audit = read("architecture/p4/pre-change-reference-inventory.json");
const corpus = read("architecture/p4/replay-corpus.json");
const gates = read("architecture/p4/hard-gates.json") as { gates: Array<{ id: string; expected: number; evidence: Array<{ file: string; title: string }> }> };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

describe("P4 program-search architecture contract", () => {
  it("locks exact P3 lineage, pure search contracts, bounded candidate origins, and identity separation", () => {
    expect(contract).toMatchObject({
      p4BaselineSha: "c0965059b92c1b0f73100c4556301044c1b7e9c4",
      p3CertifiedSha: "c0965059b92c1b0f73100c4556301044c1b7e9c4",
      p3Status: "P3_PASS_LOCAL_CERTIFIED",
      package: "@finnor/program-search",
    });
    expect(contract.contract.SearchProblem).toEqual(expect.arrayContaining(["goal", "epistemicState", "initialPrograms", "hardConstraints", "softObjectives", "capabilities", "budgets", "searchBounds"]));
    expect(contract.contract.SearchResult).toEqual(expect.arrayContaining(["selectedProgram", "survivingCandidates", "rejectedCandidates", "proofRecords", "extractionScore", "searchStats"]));
    expect(contract.candidateGeneration.origins).toEqual(["MODEL_CANDIDATE", "DETERMINISTIC_REWRITE", "CAPABILITY_ALTERNATIVE", "RECOVERY_ALTERNATIVE", "PROCEDURE_TEMPLATE"]);
    expect(contract.identitySeparation).toEqual(expect.arrayContaining(["BusinessEffect hash", "Work id", "idempotency key", "provider operation id"]));
  });

  it("locks nine guarded rewrites, hard solver boundaries, partial orders, and lexicographic extraction", () => {
    expect(GUARDED_REWRITE_RULES).toHaveLength(9);
    expect(GUARDED_REWRITE_RULES.every((rule) => rule.preconditions.length && rule.effectRequirements.length && rule.costImpact)).toBe(true);
    expect(contract.solvers.smt).toMatchObject({ version: PROGRAM_SEARCH_SMT_SOLVER_VERSION, nativeZ3Dependency: false, unknownIsWinning: false });
    expect(contract.solvers.cpSat).toMatchObject({ version: PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION, alwaysInvoked: false, nativeOrToolsDependency: false, partialAssignmentCanWin: false });
    expect(contract.partialOrderRelations).toEqual(["MUST_PRECEDE", "MAY_PRECEDE", "INDEPENDENT", "CONFLICTS", "COMPENSATES", "ENABLES", "OBSERVES"]);
    expect(contract.extractionLexicographicOrder).toEqual(["safety_legality", "goal_satisfaction", "verification_strength", "reversibility_recoverability", "success_ordinal", "fewer_human_interruptions", "lower_latency", "lower_financial_provider_cost", "lower_model_token_cost", "program_hash_tie_break"]);
  });

  it("records the exact pre-change audit and no runtime, authority, BusinessEffect, Work, or cutover owner", () => {
    expect(audit.auditScope).toMatchObject({ trackedTypeScriptFiles: 506, roots: ["apps", "packages"] });
    expect(audit.references).toHaveLength(14);
    expect(audit.ownership).toEqual({
      newExecutionEngine: false,
      newAuthoritySystem: false,
      newBusinessEffectIdentity: false,
      newWorkIdentity: false,
      newIdempotencyIdentity: false,
      productionPlannerCutover: false,
    });
    expect(contract.shadow).toMatchObject({ authoritativePath: "EXISTING", consequentialMutations: 0, plannerCallsAdded: 0, canAuthorize: false, canDispatchWork: false, canCreateBusinessEffect: false });
  });

  it("locks all 23 zero-tolerance gates to executable evidence and the exact 26-case corpus", () => {
    expect(gates.gates).toHaveLength(23);
    expect(new Set(gates.gates.map((gate) => gate.id)).size).toBe(23);
    for (const gate of gates.gates) {
      expect(gate.expected).toBe(0);
      expect(gate.evidence.length).toBeGreaterThan(0);
      for (const evidence of gate.evidence) {
        const path = resolve(root, evidence.file);
        expect(existsSync(path), `${gate.id}:${evidence.file}`).toBe(true);
        expect(readFileSync(path, "utf8"), `${gate.id}:${evidence.title}`).toContain(evidence.title);
      }
    }
    const fixtures = read("packages/program-search/fixtures/locked-cases.json") as unknown as any[];
    expect(fixtures).toHaveLength(26);
    expect(hash(fixtures)).toBe("9c2735988365f09408b793b935cb53d0c429fd202b7d4cf99b0dfad6641f5365");
    expect(corpus).toMatchObject({ extensionCases: 26, liveExternalDependencies: 0, combined: { categoryCases: 130, selectorEntries: 177, uniqueSelectors: 176 } });
    const combinedHash = corpus.combined.corpusHash;
    delete corpus.combined.corpusHash;
    expect(hash(corpus)).toBe(combinedHash);
    expect(combinedHash).toBe("31cd85f0db2a948be03f0104d724d5a2b3f1f3c02f925b7bd3779b19274ac5fd");
  });
});
