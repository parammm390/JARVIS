import { describe, expect, it } from "vitest";
import { comparePlanningSemantics } from "@finnor/planning-ir";
import { classifyInstructionRoute, IrAdmissibilityCompiler, lowerAdmittedPlanningIr } from "@finnor/orchestration";
import { PHASE1_EXPECTED_CORPUS_HASH, PHASE1_FIXED_CLOCK, PHASE1_LOCKED_CORPUS, PHASE1_LOCKED_CORPUS_HASH, PHASE1_LOCKED_COUNTS } from "./locked-corpus";

const compiler = (grounded = true) => new IrAdmissibilityCompiler({
  groundPayload: async (payload) => Object.keys(payload).filter((field) => field.endsWith("Id")).map((field) => ({ field, status: grounded ? "verified" as const : "not_found" as const })),
  groundRef: async () => grounded ? "verified" : "not_found",
  hasCapability: (capability) => capability === "action:fixture_action",
  hasActionType: (actionType) => actionType === "fixture_action",
  requiredObservation: () => "canonical_state",
  now: () => new Date(PHASE1_FIXED_CLOCK),
});

describe("Phase-1 permanent offline deterministic corpus", () => {
  it("locks the exact required semantic case counts", () => {
    expect(PHASE1_LOCKED_COUNTS).toEqual({ routing: 240, ir: 320, malformed: 200, forged: 100, constraint: 100, semanticDiff: 100, total: 1060, water: 20, hvac: 20, plumbing: 20 });
    expect(PHASE1_LOCKED_CORPUS_HASH).toBe(PHASE1_EXPECTED_CORPUS_HASH);
    expect(new Set(PHASE1_LOCKED_CORPUS.map(({ semantic }) => semantic)).size).toBe(1060);
  });

  it("certifies every locked case without network, provider, model, or wall-clock access", async () => {
    for (const testCase of PHASE1_LOCKED_CORPUS) {
      if (testCase.suite === "routing") {
        const decision = classifyInstructionRoute({ instruction: testCase.instruction, fastReadDecision: testCase.fastRead ? { route: "fast_read", confidence: "high", request: { intent: "business_state" } } : { route: "planner", reason: "not_question" }, conversational: testCase.conversational });
        expect(decision.route, testCase.id).toBe(testCase.expected);
      } else if (testCase.suite === "ir") {
        const result = await compiler().admit(testCase.artifact);
        expect(result.admissible, testCase.id).toBe(true);
        if (result.admissible) expect(lowerAdmittedPlanningIr(result.admitted), testCase.id).toHaveLength(1);
      } else if (testCase.suite === "malformed") {
        expect((await compiler().admit(testCase.artifact)).admissible, testCase.id).toBe(false);
      } else if (testCase.suite === "forged") {
        expect((await compiler(false).admit(testCase.artifact)).admissible, testCase.id).toBe(false);
      } else if (testCase.suite === "constraint") {
        expect((await compiler().admit(testCase.artifact)).admissible, testCase.id).toBe(testCase.expected === "ADMIT_SOFT");
      } else {
        expect(comparePlanningSemantics(testCase.legacy, testCase.ir).classification, testCase.id).toBe(testCase.expected);
      }
    }
  });
});
