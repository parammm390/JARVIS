import { createEpistemicState } from "@finnor/epistemic-runtime";
import { describe, expect, it } from "vitest";
import { internalCanonicalWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { expandWorldBranches, validateWorldVariable, worldVariableFromP3 } from "./branches";
import { DEFAULT_SIMULATION_BOUNDS, P5_TEST_NOW, snapshotForProgram } from "./test-support";

describe("P5 uncertainty and bounded branch expansion", () => {
  it("derives alternatives from P3 without inventing probabilities", () => {
    const state = createEpistemicState({
      scope: { tenantId: "10000000-0000-4000-8000-000000000001", principalId: "employee:test", decisionId: "decision:p5" },
      asOf: P5_TEST_NOW,
      propositions: [{ id: "provider.accepts", subject: { kind: "provider", type: "service", id: "provider-1" }, predicate: { name: "accepts", operator: "available" } }],
    });
    state.propositions[0] = {
      ...state.propositions[0]!,
      status: "UNCERTAIN",
      value: { kind: "ALTERNATIVES", alternatives: [
        { value: "accepted", evidenceRefs: ["evidence:provider-history"] },
        { value: "declined", evidenceRefs: ["evidence:provider-history"] },
      ] },
      confidence: { ...state.propositions[0]!.confidence, level: "LOW" },
      evidenceRefs: ["evidence:provider-history"],
    };
    const variable = worldVariableFromP3({ state, propositionId: "provider.accepts", binding: { kind: "EFFECT_OUTCOME", effectRef: "effect.provider" } });
    expect(variable.provenance.owner).toBe("P3");
    expect(variable.possibleOutcomes).toHaveLength(2);
    expect(variable.possibleOutcomes.every((candidate) => candidate.likelihood.kind === "UNRANKED" && candidate.operationalStatus === "UNKNOWN")).toBe(true);
  });

  it("accepts empirical likelihood only with measured sample provenance", () => {
    const variable = {
      id: "world-variable:empirical",
      tenantId: "10000000-0000-4000-8000-000000000001",
      sourcePropositionId: "provider.measured",
      binding: { kind: "EFFECT_OUTCOME" as const, effectRef: "effect.provider" },
      possibleOutcomes: [{
        outcomeId: "accepted",
        value: true,
        operationalStatus: "SUCCESS" as const,
        risk: "LOW" as const,
        likelihood: { kind: "EMPIRICAL" as const, occurrences: 8, sampleSize: 10, datasetRef: "dataset:provider-acks:v1", measuredAt: P5_TEST_NOW },
        evidenceRefs: ["dataset:provider-acks:v1"],
      }],
      evidence: ["dataset:provider-acks:v1"],
      confidenceQuality: "MEDIUM" as const,
      provenance: { owner: "P3" as const, propositionId: "provider.measured", evidenceRefs: ["dataset:provider-acks:v1"], asOf: P5_TEST_NOW },
    };
    expect(() => validateWorldVariable(variable)).not.toThrow();
    expect(() => validateWorldVariable({ ...variable, possibleOutcomes: [{ ...variable.possibleOutcomes[0]!, likelihood: { ...variable.possibleOutcomes[0]!.likelihood, occurrences: 11 } }] })).toThrow("occurrences cannot exceed sampleSize");
  });

  it("fails before pruning when the full Cartesian world exceeds maxBranches", async () => {
    const program = internalCanonicalWriteProgram();
    const variable = {
      id: "world-variable:three",
      tenantId: "10000000-0000-4000-8000-000000000001",
      sourcePropositionId: "provider.three",
      binding: { kind: "EFFECT_OUTCOME" as const, effectRef: "effect.create-task" },
      possibleOutcomes: ["success", "failure", "ambiguous"].map((outcomeId, index) => ({
        outcomeId,
        value: outcomeId,
        operationalStatus: (["SUCCESS", "FAILURE", "AMBIGUOUS"] as const)[index]!,
        risk: index === 0 ? "LOW" as const : "HIGH" as const,
        likelihood: { kind: "UNRANKED" as const },
        evidenceRefs: [`evidence:${outcomeId}`],
      })),
      evidence: ["evidence:provider"],
      confidenceQuality: "LOW" as const,
      provenance: { owner: "P3" as const, propositionId: "provider.three", evidenceRefs: ["evidence:provider"], asOf: P5_TEST_NOW },
    };
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = expandWorldBranches({ snapshot, variables: [variable], bounds: { ...DEFAULT_SIMULATION_BOUNDS, maxBranches: 2 } });
    expect(result).toMatchObject({ status: "BOUNDED_INCOMPLETE", requiredBranches: 3, branches: [], highRiskBranchesDiscarded: 0 });
  });
});
