import { describe, expect, it } from "vitest";
import { composeOperationalProgramEffects, lowerOperationalProgram } from "@finnor/operational-ir";
import {
  capability,
  checkP2Resolved,
  emptyEpistemicState,
  estimate,
  queryProgram,
  searchProblem,
  unresolvedRequirement,
} from "../fixtures/programs";
import { searchOperationalPrograms } from "./search";

describe("bounded deterministic program search", () => {
  it("selects the best legal candidate lexicographically without a model judgment", async () => {
    const slower = queryProgram("money_summary", { variant: "slower" });
    const faster = queryProgram("work_list", { variant: "faster" });
    const problem = searchProblem({
      programs: [
        { candidateId: "slower", origin: "MODEL_CANDIDATE", originRef: "model-attempt-1", program: slower },
        { candidateId: "faster", origin: "PROCEDURE_TEMPLATE", originRef: "procedure-work-list", program: faster },
      ],
      capabilities: [capability("money_summary", { latency: 500 }), capability("work_list", { latency: 10 })],
    });
    const result = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });

    expect(result.status).toBe("SELECTED");
    expect(result.survivingCandidates).toHaveLength(2);
    expect(result.survivingCandidates[0]?.candidateId).toBe("faster");
    expect(result.selectedProgramHash).toBe(result.survivingCandidates[0]?.programHash);
    expect(result.hardConstraintsUsedAsScores).toBe(0);
    expect(result.modelFinalPlanJudgments).toBe(0);
  });

  it("rejects an SMT violation instead of converting it into a score penalty", async () => {
    const good = queryProgram("money_summary", { variant: "good" });
    const bad = queryProgram("work_list", { variant: "bad" });
    const problem = searchProblem({
      programs: [
        { candidateId: "bad", origin: "MODEL_CANDIDATE", originRef: "model", program: bad, solverFacts: { authorized: false } },
        { candidateId: "good", origin: "PROCEDURE_TEMPLATE", originRef: "procedure", program: good, solverFacts: { authorized: true } },
      ],
      capabilities: [capability("money_summary"), capability("work_list")],
      hardConstraints: [{
        id: "authorization-known-static",
        kind: "SMT",
        description: "Static authorization declaration must be true.",
        expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "authorized", operator: "EQ", value: true } },
      }],
    });
    const result = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
    expect(result.selectedProgram?.body.semanticId).toBe("query.good");
    expect(result.rejectedCandidates.find((candidate) => candidate.candidateId === "bad")?.rejection).toMatchObject({ stage: "SMT_SOLVER", reasonCode: "SMT_UNSAT" });
  });

  it("never selects P2 REJECTED or P2 UNRESOLVED candidates", async () => {
    const rejected = queryProgram("money_summary", { variant: "rejected" });
    const unresolved = queryProgram("work_list", { variant: "unresolved" });
    const result = await searchOperationalPrograms(searchProblem({
      programs: [
        { candidateId: "rejected", origin: "MODEL_CANDIDATE", originRef: "model", program: rejected },
        { candidateId: "unresolved", origin: "MODEL_CANDIDATE", originRef: "model", program: unresolved },
      ],
      capabilities: [capability("money_summary"), capability("work_list")],
    }), {
      checkP2: async (program) => ({
        status: program.body.semanticId.includes("rejected") ? "REJECTED" : "UNRESOLVED",
        reasonCodes: program.body.semanticId.includes("rejected") ? ["FORBIDDEN_IRREVERSIBLE_EFFECT"] : ["CAPABILITY_RESOLUTION_UNRESOLVED"],
        issues: [],
        informationFlows: [],
      }),
    });
    expect(result.selectedProgram).toBeNull();
    expect(result.rejectedCandidates.map((candidate) => candidate.rejection?.reasonCode).sort()).toEqual(["P2_REJECTED", "P2_UNRESOLVED"]);
  });

  it("returns unresolved candidate knowledge to P3 without acquiring it", async () => {
    const state = emptyEpistemicState(["provider.binding-known"]);
    const problem = searchProblem({
      epistemicState: state,
      epistemicRequirements: [],
      programs: [{
        candidateId: "needs-binding",
        origin: "CAPABILITY_ALTERNATIVE",
        originRef: "alternative",
        program: queryProgram(),
        requiredPropositionIds: ["provider.binding-known"],
      }],
    });
    const result = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
    expect(result.status).toBe("P3_UNRESOLVED");
    expect(result.requirementsForP3).toEqual(["provider.binding-known"]);
    expect(result.rejectedCandidates[0]?.rejection?.reasonCode).toBe("P3_CANDIDATE_MANDATORY_UNKNOWN");
  });

  it("stops before candidate search when P3 mandatory knowledge is unresolved", async () => {
    const state = emptyEpistemicState(["goal.mandatory"]);
    const result = await searchOperationalPrograms(searchProblem({
      epistemicState: state,
      epistemicRequirements: [unresolvedRequirement("goal.mandatory")],
    }), { checkP2: checkP2Resolved });
    expect(result).toMatchObject({ status: "P3_UNRESOLVED", selectedProgram: null });
    expect(result.searchStats.searchNodesVisited).toBe(0);
  });

  it("is byte-stable on deterministic decision artifacts for identical inputs", async () => {
    const problem = searchProblem();
    const first = await searchOperationalPrograms(problem, { checkP2: checkP2Resolved });
    const second = await searchOperationalPrograms(structuredClone(problem), { checkP2: checkP2Resolved });
    expect(second).toEqual(first);
    expect(first.deterministicReplayKey).toBe(second.deterministicReplayKey);
  });

  it("uses explicit fallback assumptions for unknown cost and never zero", async () => {
    const result = await searchOperationalPrograms(searchProblem({ capabilities: [capability("money_summary", { financial: null, latency: null })] }), { checkP2: checkP2Resolved });
    const cost = result.survivingCandidates[0]?.costEstimate;
    expect(cost?.financialSpend).toMatchObject({ value: null, fallbackAssumption: { value: 100 } });
    expect(cost?.expectedLatencyMs).toMatchObject({ value: null, fallbackAssumption: { value: 30_000 } });
    expect(result.extractionScore?.financialCost).toBeGreaterThan(0);
    expect(result.extractionScore?.latencyMs).toBeGreaterThan(0);
  });

  it("returns a structured bounded result without exceeding search nodes", async () => {
    const programs = Array.from({ length: 4 }, (_, index) => ({
      candidateId: `candidate-${index}`,
      origin: "MODEL_CANDIDATE" as const,
      originRef: `model-${index}`,
      program: queryProgram(index % 2 ? "work_list" : "money_summary", { variant: `bound-${index}` }),
    }));
    const result = await searchOperationalPrograms(searchProblem({
      programs,
      capabilities: [capability("money_summary"), capability("work_list")],
      searchBounds: { maxInitialCandidates: 4, maxRewriteIterations: 1, maxSearchNodes: 1, maxSolverTimeMs: 100, maxTotalSearchMs: 100, maxMemoryBytes: 1_000_000 },
    }), { checkP2: checkP2Resolved });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.searchStats.searchNodesVisited).toBeLessThanOrEqual(1);
    expect(result.searchStats.budgetReasonCodes).toContain("SEARCH_NODE_BUDGET_EXHAUSTED");
  });

  it("evaluates every candidate inside maxInitialCandidates before reporting source truncation", async () => {
    const programs = Array.from({ length: 4 }, (_, index) => ({
      candidateId: `candidate-${index}`,
      origin: "MODEL_CANDIDATE" as const,
      originRef: `model-${index}`,
      program: queryProgram(index % 2 ? "work_list" : "money_summary", { variant: `initial-cap-${index}` }),
    }));
    const result = await searchOperationalPrograms(searchProblem({
      programs,
      capabilities: [capability("money_summary"), capability("work_list")],
      searchBounds: { maxInitialCandidates: 3, maxRewriteIterations: 1, maxSearchNodes: 10, maxSolverTimeMs: 100, maxTotalSearchMs: 1_000, maxMemoryBytes: 1_000_000 },
    }), { checkP2: checkP2Resolved });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.searchStats.initialCandidatesAccepted).toBe(3);
    expect(result.survivingCandidates).toHaveLength(3);
    expect(result.rejectedCandidates).toContainEqual(expect.objectContaining({
      candidateId: "candidate-3",
      rejection: expect.objectContaining({ detailCodes: ["MAX_INITIAL_CANDIDATES"] }),
    }));
  });

  it("fails closed when P2 or the existing lowerer does not return a result", async () => {
    const p2Failure = await searchOperationalPrograms(searchProblem(), {
      checkP2: async () => { throw new Error("unavailable"); },
    });
    expect(p2Failure.selectedProgram).toBeNull();
    expect(p2Failure.rejectedCandidates[0]).toMatchObject({
      p2: { status: "UNRESOLVED" },
      rejection: { stage: "P2_STATIC_ADMISSIBILITY", reasonCode: "P2_UNRESOLVED", detailCodes: ["P2_CHECK_FAILED"] },
    });

    const loweringFailure = await searchOperationalPrograms(searchProblem(), {
      checkP2: checkP2Resolved,
      lower: () => { throw new Error("unsupported boundary"); },
    });
    expect(loweringFailure.status).toBe("UNSUPPORTED");
    expect(loweringFailure.rejectedCandidates[0]?.rejection).toMatchObject({
      stage: "RUNTIME_LOWERING",
      reasonCode: "UNSUPPORTED_RUNTIME_LOWERING",
      detailCodes: ["LOWERING_BOUNDARY_FAILED"],
    });
  });

  it("rejects invalid zero fallbacks and currency-unit mismatches instead of underpricing them", async () => {
    const invalid = searchProblem();
    invalid.initialPrograms[0]!.costOverrides = { financialSpend: estimate(null, "currency_units", 0) };
    await expect(searchOperationalPrograms(invalid, { checkP2: checkP2Resolved })).rejects.toThrow("INVALID_P4_SEARCH_PROBLEM");

    const mismatch = await searchOperationalPrograms(searchProblem({
      budgets: { maxFinancialSpend: { amount: 1_000, currency: "USD" } },
    }), { checkP2: checkP2Resolved });
    expect(mismatch.selectedProgram).toBeNull();
    expect(mismatch.rejectedCandidates[0]?.rejection).toMatchObject({
      stage: "SEARCH_BUDGET",
      reasonCode: "PROGRAM_BUDGET_EXCEEDED",
      detailCodes: ["FINANCIAL_SPEND_UNIT_MISMATCH:currency_units:USD"],
    });
  });

  it("rejects a program that the existing compatibility lowerer cannot represent", async () => {
    const base = queryProgram();
    const multi = {
      ...base,
      executionModel: "OBJECTIVE" as const,
      body: { kind: "sequence" as const, semanticId: "sequence.unsupported", steps: [base.body, { ...base.body, semanticId: "query.second" }] },
      budget: { ...base.budget!, maxSteps: 2, maxQueries: 2 },
    };
    const { sealOperationalProgram } = await import("@finnor/operational-ir");
    const { irSemanticHash: _hash, ...draft } = multi;
    const program = sealOperationalProgram(draft);
    const effects = composeOperationalProgramEffects(program);
    const result = await searchOperationalPrograms(searchProblem({
      programs: [{ candidateId: "unsupported", origin: "PROCEDURE_TEMPLATE", originRef: "multi-node", program }],
    }), {
      // Defense in depth: even a falsely permissive upstream stub cannot bypass
      // the real compatibility lowerer.
      checkP2: async () => ({ status: "ADMISSIBLE", reasonCodes: [], issues: [], informationFlows: [], summary: effects }),
      lower: lowerOperationalProgram,
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.rejectedCandidates[0]?.rejection?.reasonCode).toBe("UNSUPPORTED_RUNTIME_LOWERING");
  });
});
