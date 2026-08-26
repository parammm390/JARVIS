import { describe, expect, it } from "vitest";
import { comparePlanningSemantics, type ConstraintSpec } from "@finnor/planning-ir";
import { businessEffectObservationForAction, classifyInstructionRoute, IrAdmissibilityCompiler, lowerAdmittedPlanningIr } from "@finnor/orchestration";
import { ACTION_HARDENING_SPEC, ACTION_HARDENING_SPEC_BY_ACTION } from "../../scripts/release/action-hardening-spec";
import {
  REAL_FINNOR_CATEGORY_COUNTS,
  REAL_FINNOR_COUNTS,
  REAL_FINNOR_CORPUS_HASH,
  REAL_FINNOR_EXPECTED_CORPUS_HASH,
  REAL_FINNOR_FIXED_CLOCK,
  REAL_FINNOR_PHASE1_CORPUS,
  REAL_FINNOR_SEMANTIC_DIFF,
  realCaseArtifact,
  type RealFinnorCase,
} from "./real-finnor-corpus";

const consequentialProfiles = new Set(ACTION_HARDENING_SPEC
  .filter(({ profile }) => profile !== "READ_ONLY" && profile !== "META_NO_SIDE_EFFECT")
  .map(({ profile }) => profile));

function compilerFor(testCase: RealFinnorCase): IrAdmissibilityCompiler {
  const entities = new Map(testCase.trustedWorld.entities.map((entity) => [entity.entityId, entity]));
  const truth = new Map(testCase.expected.hardConstraints.map((constraint) => [constraint.id, constraint]));
  const groundPayload = async (payload: Record<string, unknown>) => {
    const results: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }> = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value === "string" && entities.has(value)) {
        results.push({ field: path, status: entities.get(value)!.tenantId === testCase.trustedWorld.tenantId ? "verified" : "not_found" });
      } else if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}.${index}`));
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key));
    };
    visit(payload, "");
    return results;
  };
  return new IrAdmissibilityCompiler({
    groundPayload,
    groundRef: async (ref) => {
      const entity = entities.get(ref.entityId);
      return entity && entity.tenantId === testCase.trustedWorld.tenantId ? "verified" : "not_found";
    },
    hasCapability: (capability) => testCase.trustedWorld.availableCapabilities.includes(capability),
    hasActionType: (actionType) => ACTION_HARDENING_SPEC_BY_ACTION.has(actionType),
    requiredObservation: businessEffectObservationForAction,
    evaluateConstraint: async (constraint: ConstraintSpec) => {
      const expected = truth.get(constraint.id);
      return expected
        ? { truth: expected.truth, source: "canonical_state" as const, evidence: [`frozen-world:${testCase.id}:${constraint.id}`], reason: expected.description, sourceVersions: { corpus: "real-finnor-phase1-1.0.0", policy: String(testCase.trustedWorld.policyRevision) } }
        : { truth: "unresolved" as const, source: "unsupported" as const, evidence: [], reason: "No independent frozen-world evaluator exists", sourceVersions: { corpus: "real-finnor-phase1-1.0.0", policy: "n/a" } };
    },
    now: () => new Date(REAL_FINNOR_FIXED_CLOCK),
  });
}

describe("Phase-1 real FINNOR permanent offline corpus", () => {
  it("locks 1,000 semantically distinct business cases and all consequential profiles", () => {
    expect(REAL_FINNOR_COUNTS.total).toBe(1_000);
    for (const [category, count] of Object.entries(REAL_FINNOR_CATEGORY_COUNTS)) expect(REAL_FINNOR_PHASE1_CORPUS.filter((entry) => entry.category === category).length).toBe(count);
    expect(new Set(REAL_FINNOR_PHASE1_CORPUS.map(({ semanticKey }) => semanticKey)).size).toBe(1_000);
    expect(REAL_FINNOR_COUNTS.query).toBeGreaterThan(0);
    expect(REAL_FINNOR_COUNTS.conversation).toBeGreaterThan(0);
    expect(REAL_FINNOR_COUNTS.atomicEffect).toBeGreaterThan(0);
    expect(REAL_FINNOR_COUNTS.objective).toBeGreaterThan(0);
    expect(REAL_FINNOR_COUNTS.water).toBeGreaterThanOrEqual(20);
    expect(REAL_FINNOR_COUNTS.hvac).toBeGreaterThanOrEqual(20);
    expect(REAL_FINNOR_COUNTS.plumbing).toBeGreaterThanOrEqual(20);
    expect(REAL_FINNOR_COUNTS.consequentialFamilies).toBe(consequentialProfiles.size);
    expect(REAL_FINNOR_CORPUS_HASH).toBe(REAL_FINNOR_EXPECTED_CORPUS_HASH);
  });

  it("derives truth from frozen canonical state and certifies every case without network/model/provider access", async () => {
    for (const testCase of REAL_FINNOR_PHASE1_CORPUS) {
      if (testCase.expected.compilerResult === "NO_PLANNER") {
        const decision = classifyInstructionRoute({
          instruction: testCase.instruction,
          fastReadDecision: testCase.expected.executionClass === "QUERY"
            ? { route: "fast_read", confidence: "high", request: { intent: "business_state" } }
            : { route: "planner", reason: "not_question" },
          conversational: testCase.expected.executionClass === "CONVERSATION",
        });
        expect(decision.route, testCase.id).toBe(testCase.expected.executionClass);
        continue;
      }
      const artifact = realCaseArtifact(testCase)!;
      for (const constraint of [...artifact.constraints.hard, ...artifact.constraints.soft]) {
        const expected = testCase.expected.hardConstraints.find(({ id }) => id === constraint.id)!;
        if (expected.truth === "satisfied") expect(constraint.status, `${testCase.id}:${constraint.id}`).toBe("violated");
        else expect(constraint.status, `${testCase.id}:${constraint.id}`).toBe("satisfied");
      }
      const result = await compilerFor(testCase).admit(artifact);
      expect(result.admissible, testCase.id).toBe(testCase.expected.compilerResult === "ADMIT");
      if (result.admissible) {
        const lowered = lowerAdmittedPlanningIr(result.admitted);
        expect(lowered.map(({ actionType }) => actionType), testCase.id).toEqual(testCase.expected.allowedEffects);
        expect(result.admitted.constraintEvaluations.map(({ truth }) => truth), testCase.id).toEqual(testCase.expected.hardConstraints.map(({ truth }) => truth));
      } else expect(testCase.expected.allowedEffects, testCase.id).toEqual([]);
    }
  }, 60_000);

  it("locks 100 frozen legacy-to-native semantic comparisons with zero regression", () => {
    expect(REAL_FINNOR_SEMANTIC_DIFF).toHaveLength(100);
    expect(REAL_FINNOR_SEMANTIC_DIFF.filter(({ expected }) => expected === "EQUIVALENT")).toHaveLength(50);
    expect(REAL_FINNOR_SEMANTIC_DIFF.filter(({ expected }) => expected === "EXPECTED_IMPROVEMENT")).toHaveLength(50);
    for (const testCase of REAL_FINNOR_SEMANTIC_DIFF) {
      expect(comparePlanningSemantics(testCase.legacy, testCase.native).classification, testCase.id).toBe(testCase.expected);
      if (testCase.expected === "EXPECTED_IMPROVEMENT") expect(testCase.expectedImprovementReason).toMatchObject({ retainedLegacySemantics: true });
    }
  });
});
