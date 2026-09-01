import { describe, expect, it } from "vitest";
import { internalCanonicalWriteProgram } from "../../operational-ir/fixtures/p2-programs";
import { simulateOperationalProgram, ZERO_REAL_SIDE_EFFECTS } from "@finnor/speculative-runtime";
import { simulationInput, snapshotForProgram } from "../../speculative-runtime/src/test-support";
import { programSimulationEvidence } from "./speculative-runtime-shadow";

describe("P5 -> P4 shadow evidence projection", () => {
  it("projects branch evidence without an authority or execution recommendation", async () => {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot }));
    expect(result.sideEffects).toEqual(ZERO_REAL_SIDE_EFFECTS);
    expect(programSimulationEvidence(result)).toMatchObject({
      source: "P5",
      status: "COMPLETE",
      requiredBranches: 1,
      simulatedBranches: 1,
      highRiskBranchesDiscarded: 0,
      realSideEffects: {
        dbMutations: 0,
        providerCalls: 0,
        computerMutations: 0,
        authorityDecisions: 0,
        approvalRequests: 0,
        workTransitions: 0,
      },
      ownership: { predictsWorlds: "P5", selectsPrograms: "P4", authoritativeExecution: "EXISTING_GOVERNED_RUNTIME" },
    });
  });
});
