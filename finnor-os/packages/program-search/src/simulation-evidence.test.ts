import { describe, expect, it } from "vitest";
import type { ProgramSimulationEvidence, ProgramSimulationRequest } from "./contracts";
import { searchOperationalPrograms } from "./search";
import { validateProgramSimulationEvidence } from "./simulation-evidence";
import { capability, checkP2Resolved, queryProgram, searchProblem } from "../fixtures/programs";

function evidence(request: ProgramSimulationRequest, options: {
  outcome?: ProgramSimulationEvidence["branches"][number]["outcome"];
  goal?: 0 | 250 | 500 | 750 | 1000;
  hard?: ProgramSimulationEvidence["branches"][number]["hardConstraintStatus"];
  status?: ProgramSimulationEvidence["status"];
  required?: number;
  simulated?: number;
  dbMutations?: number;
} = {}): ProgramSimulationEvidence {
  const suffix = request.programHash.slice(-64);
  return {
    version: 1,
    source: "P5",
    status: options.status ?? "COMPLETE",
    tenantId: request.epistemicState.scope.tenantId,
    programIrSemanticHash: request.program.irSemanticHash,
    p4CandidateHash: request.programHash,
    snapshotId: `p5:snapshot:sha256:${suffix}`,
    replayIdentity: `p5:replay:sha256:${suffix}`,
    traceId: `p5:trace:sha256:${suffix}`,
    requiredBranches: options.required ?? 1,
    simulatedBranches: options.simulated ?? 1,
    budgetExhausted: false,
    highRiskBranchesDiscarded: 0,
    realSideEffects: {
      dbMutations: options.dbMutations ?? 0,
      providerCalls: 0,
      computerMutations: 0,
      authorityDecisions: 0,
      approvalRequests: 0,
      workTransitions: 0,
      outboxWrites: 0,
      externalWebhooks: 0,
      paymentMutations: 0,
    },
    ownership: {
      predictsWorlds: "P5",
      selectsPrograms: "P4",
      epistemicOwner: "P3",
      staticAdmissibilityOwner: "P2",
      authoritativeExecution: "EXISTING_GOVERNED_RUNTIME",
    },
    branches: [{
      branchId: `p5:branch:sha256:${suffix}`,
      outcome: options.outcome ?? "PREDICTED_SUCCESS",
      goalSatisfactionOrdinal: options.goal ?? 1000,
      hardConstraintStatus: options.hard ?? "SATISFIED",
      verificationStrength: "CANONICAL_PREDICTED",
      recoveryBurden: "NONE",
      irreversibility: "READ_ONLY",
      humanInterruptionsUpperBound: 0,
      latencyMs: null,
      financialCost: null,
      financialCurrency: null,
      failureModeCodes: [],
      consequentialFailure: false,
      uncertaintyRemaining: [],
    }],
    issueCodes: [],
  };
}

describe("P4 consumes P5 branch evidence without transferring selection authority", () => {
  it("uses conservative worst-branch evidence in deterministic P4 extraction", async () => {
    const riskyFast = queryProgram("work_list", { variant: "p5-risky-fast" });
    const safeSlow = queryProgram("money_summary", { variant: "p5-safe-slow" });
    const problem = searchProblem({
      programs: [
        { candidateId: "risky-fast", origin: "MODEL_CANDIDATE", originRef: "model", program: riskyFast },
        { candidateId: "safe-slow", origin: "PROCEDURE_TEMPLATE", originRef: "procedure", program: safeSlow },
      ],
      capabilities: [capability("work_list", { latency: 1 }), capability("money_summary", { latency: 500 })],
    });
    problem.simulationPolicy = { version: 1, mode: "REQUIRED" };
    const result = await searchOperationalPrograms(problem, {
      checkP2: checkP2Resolved,
      simulate: async (request) => request.candidateId === "risky-fast"
        ? evidence(request, { outcome: "PREDICTED_FAILURE", goal: 0 })
        : evidence(request),
    });
    expect(result.status).toBe("SELECTED");
    expect(result.selectedProgramHash).toBe(result.survivingCandidates.find((candidate) => candidate.candidateId === "safe-slow")?.programHash);
    expect(result.survivingCandidates.every((candidate) => candidate.simulationEvidence?.ownership.selectsPrograms === "P4")).toBe(true);
    expect(result.proofRecords.filter((proof) => proof.kind === "SIMULATION_RESULT")).toHaveLength(2);
    expect(result.searchStats.simulationCalls).toBe(2);
  });

  it("fails closed when required P5 evidence is unavailable", async () => {
    const problem = searchProblem();
    problem.simulationPolicy = { version: 1, mode: "REQUIRED" };
    const result = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
    expect(result).toMatchObject({ status: "UNSUPPORTED", selectedProgram: null });
    expect(result.rejectedCandidates[0]?.rejection).toMatchObject({
      stage: "P5_SPECULATIVE_EVIDENCE",
      reasonCode: "P5_SIMULATION_UNAVAILABLE",
    });
  });

  it("never invokes P5 before a candidate passes P2", async () => {
    const problem = searchProblem();
    problem.simulationPolicy = { version: 1, mode: "REQUIRED" };
    let simulationCalls = 0;
    const result = await searchOperationalPrograms(problem, {
      checkP2: async (program) => ({ ...(await checkP2Resolved(program)), status: "REJECTED" }),
      simulate: async (request) => { simulationCalls += 1; return evidence(request); },
    });
    expect(simulationCalls).toBe(0);
    expect(result.rejectedCandidates[0]?.rejection?.stage).toBe("P2_STATIC_ADMISSIBILITY");
  });

  it.each([
    ["real side effect", { dbMutations: 1 }, "P5_SIMULATION_SIDE_EFFECT_ESCAPE"],
    ["incomplete coverage", { required: 2, simulated: 1 }, "P5_SIMULATION_BRANCH_COVERAGE_INCOMPLETE"],
    ["hard-constraint violation", { hard: "VIOLATED" as const }, "P5_SIMULATION_HARD_CONSTRAINT_VIOLATION"],
  ])("rejects %s as a hard evidence gate", async (_label, options, reasonCode) => {
    const problem = searchProblem();
    problem.simulationPolicy = { version: 1, mode: "REQUIRED" };
    const result = await searchOperationalPrograms(problem, {
      checkP2: checkP2Resolved,
      simulate: async (request) => evidence(request, options),
    });
    expect(result.selectedProgram).toBeNull();
    expect(result.rejectedCandidates[0]?.rejection?.reasonCode).toBe(reasonCode);
  });

  it("rejects evidence bound to a different tenant, program, or P4 candidate", async () => {
    const problem = searchProblem();
    problem.simulationPolicy = { version: 1, mode: "REQUIRED" };
    const result = await searchOperationalPrograms(problem, {
      checkP2: checkP2Resolved,
      simulate: async (request) => ({ ...evidence(request), tenantId: "different-tenant" }),
    });
    expect(result.rejectedCandidates[0]?.rejection).toMatchObject({
      stage: "P5_SPECULATIVE_EVIDENCE",
      reasonCode: "P5_SIMULATION_EVIDENCE_INVALID",
      detailCodes: ["P5_EVIDENCE_PROGRAM_OR_TENANT_BINDING_MISMATCH"],
    });
  });

  it("validates a complete zero-side-effect evidence envelope", () => {
    const program = queryProgram();
    const request = {
      candidateId: "candidate",
      programHash: `p4:program:sha256:${"a".repeat(64)}` as const,
      program,
      p2Status: "ADMISSIBLE" as const,
      fixedNow: "2026-09-01T00:00:00.000Z",
      epistemicState: searchProblem().epistemicState,
    };
    expect(validateProgramSimulationEvidence(evidence(request))).toEqual({ valid: true, reasonCode: null, detailCodes: [] });
    expect(validateProgramSimulationEvidence({ ...evidence(request), snapshotId: "p5:snapshot:sha256:short" })).toMatchObject({
      valid: false,
      detailCodes: ["P5_EVIDENCE_IDENTITY_DOMAIN_INVALID"],
    });
  });
});
