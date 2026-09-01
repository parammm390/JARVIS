import { describe, expect, it } from "vitest";
import { financialWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { compareSimulationSemantics } from "./semantic-diff";
import { simulateOperationalProgram } from "./interpreter";
import { simulationToCausalReplayNodes, speculativeReplaySummary } from "./replay";
import { P5_TEST_NOW, effectWorldVariable, outcome, simulationInput, snapshotForProgram } from "./test-support";

describe("P5 replay and semantic differential", () => {
  it("records only structured simulator evidence and redacts assumption values", async () => {
    const program = financialWriteProgram();
    if (program.body.kind !== "effect") throw new Error("fixture drift");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("ambiguous", "AMBIGUOUS", { value: "secret-provider-payload" })] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    const summary = speculativeReplaySummary(result);
    const nodes = simulationToCausalReplayNodes(result, { recordedAt: P5_TEST_NOW });
    expect(summary.redaction).toBe("STRUCTURED_SIMULATOR_EVIDENCE_ONLY");
    expect(summary.snapshotProvenance).toMatchObject({ asOf: P5_TEST_NOW, materializationHash: snapshot.provenance.materializationHash });
    expect(summary.program).toMatchObject({ semanticId: program.semanticId, irSemanticHash: program.irSemanticHash });
    expect(summary.branches[0]).toMatchObject({
      hypotheticalEffects: [expect.objectContaining({ planningEffectRef: program.body.semanticId, outcome: "AMBIGUOUS" })],
      predictedObservations: expect.any(Array),
      branchOutcome: expect.objectContaining({ outcome: "UNKNOWN" }),
      recoveryPath: [expect.objectContaining({ kind: "RECONCILIATION", status: "REQUIRED" })],
    });
    expect(JSON.stringify({ summary, nodes })).not.toContain("secret-provider-payload");
    expect(nodes.map((node) => node.stage)).toEqual(["context", "planning", "recovery"]);
  });

  it("classifies equivalent, stricter-safe, and regression evidence explicitly", async () => {
    const program = financialWriteProgram();
    if (program.body.kind !== "effect") throw new Error("fixture drift");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("ambiguous", "AMBIGUOUS")] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    const base = { fixtureValid: true, supported: true, consequentialEffectRefs: [program.body.semanticId], failureModeCodes: ["AMBIGUOUS_EXTERNAL_RESULT"], minimumRecoveryKinds: ["RECONCILIATION" as const] };
    expect(compareSimulationSemantics({ expected: base, actual: result }).classification).toBe("EQUIVALENT");
    expect(compareSimulationSemantics({ expected: { ...base, expectedOutcome: "PREDICTED_SUCCESS" }, actual: result }).classification).toBe("STRICTER_SAFE");
    expect(compareSimulationSemantics({ expected: { ...base, failureModeCodes: ["IRREVERSIBLE_FAILURE"] }, actual: result })).toMatchObject({ classification: "REGRESSION", reasonCodes: ["HIDDEN_FAILURE_BRANCH:IRREVERSIBLE_FAILURE"] });
    expect(compareSimulationSemantics({ expected: { ...base, consequentialEffectRefs: [], failureModeCodes: [], minimumRecoveryKinds: [] }, actual: { ...structuredClone(result), status: "FAILED", branches: [], branchOutcomes: [], stats: { ...result.stats, simulatedBranches: 0 } } })).toMatchObject({
      classification: "REGRESSION",
      reasonCodes: expect.arrayContaining(["SIMULATION_NOT_COMPLETE:FAILED", "NO_BRANCH_OUTCOMES"]),
    });
  });
});
