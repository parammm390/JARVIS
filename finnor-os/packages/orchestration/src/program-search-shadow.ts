import {
  checkOperationalProgramAdmissibility,
  composeOperationalProgramEffects,
  P2_ZERO_SHADOW_MUTATIONS,
  type StaticResolutionProvider,
} from "@finnor/operational-ir";
import {
  PROGRAM_SEARCH_COST_MODEL_VERSION,
  PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION,
  PROGRAM_SEARCH_REWRITE_SET_VERSION,
  PROGRAM_SEARCH_SMT_SOLVER_VERSION,
  candidateSemanticSnapshot,
  compareProgramSemantics,
  createProgramSearchDecisionReceipt,
  estimateProgramCost,
  generateBoundedInitialCandidates,
  programSearchReceiptToCausalReplayNodes,
  programSemanticSnapshot,
  searchOperationalPrograms,
  type ProgramSemanticDiffClassification,
  type ProgramSearchDecisionReceipt,
  type SearchCapability,
  type SearchProblem,
  type SearchResult,
} from "@finnor/program-search";
import type { CausalReplayNode } from "@finnor/shared-types";
import { logWithTrace } from "@finnor/tools";
import {
  buildOperationalQueryP3DecisionState,
  operationalQueryP3DecisionRequirement,
  validateOperationalQueryP3AuthoritativeBoundary,
  type OperationalQueryP3EpistemicShadowInput,
} from "./epistemic-runtime-shadow";
import { finnorStaticResolutionProvider } from "./operational-ir-effect-resolution";
import { operationalQueryShadowProgram } from "./operational-ir-shadow";

export interface OperationalQueryP4ProgramSearchShadowSummary {
  event: "program_search_p4_shadow";
  version: 1;
  mode: "PURE_SHADOW";
  status: "OBSERVED" | "FAILED";
  authoritativePath: "EXISTING";
  authoritativeBehaviorChanged: false;
  queryIntent: string;
  searchStatus: SearchResult["status"] | "NOT_EVALUATED";
  selectedProgramHash: string | null;
  survivingCandidates: number;
  rejectedCandidates: number;
  semanticDiff: ProgramSemanticDiffClassification;
  semanticDiffReasonCodes: string[];
  p2Statuses: string[];
  requirementsForP3: string[];
  receiptId: string | null;
  causalReplay: Array<{ id: string; stage: CausalReplayNode["stage"]; status: string }>;
  failureReasonCodes: string[];
  plannerCallsAdded: 0;
  consequentialMutations: 0;
  persistenceWrites: 0;
  authorityDecisions: 0;
  approvalRequests: 0;
  providerCalls: 0;
  computerRuns: 0;
  workTransitions: 0;
}

export type OperationalQueryP4ProgramSearchShadowRecorder = (summary: OperationalQueryP4ProgramSearchShadowSummary) => void;

export interface OperationalQueryP4ProgramSearchShadowResult {
  authoritativeExecution: OperationalQueryP3EpistemicShadowInput["execution"];
  summary: OperationalQueryP4ProgramSearchShadowSummary;
  searchResult: SearchResult | null;
  receipt: ProgramSearchDecisionReceipt | null;
  causalReplayNodes: CausalReplayNode[];
  recording: "RECORDED" | "RECORDER_FAILED";
}

function estimate(value: number, unit: string, source: string) {
  return {
    value,
    unit,
    source,
    version: PROGRAM_SEARCH_COST_MODEL_VERSION,
    quality: "CONFIGURED" as const,
    confidence: "HIGH" as const,
    fallbackAssumption: { value, rationale: "Authoritative query shadow uses an explicit bounded local-read estimate." },
  };
}

function queryCapability(input: OperationalQueryP3EpistemicShadowInput): SearchCapability {
  const latency = Math.max(0, Math.ceil(input.execution.metadata.durationMs));
  return {
    capability: `query:${input.readDecision.request.intent}`,
    available: true,
    version: "operational-query-plane-v1",
    providerClass: "canonical_postgres",
    operation: input.readDecision.request.intent,
    cost: {
      modelCalls: estimate(0, "calls", "deterministic operational query plane"),
      tokens: estimate(0, "tokens", "deterministic operational query plane"),
      providerCalls: estimate(0, "calls", "canonical local database read"),
      financialSpend: estimate(0, "currency_units", "canonical local database read"),
      expectedLatencyMs: estimate(latency, "ms", "authoritative query latency observation"),
      humanInterruptions: estimate(0, "interruptions", "deterministic routed query"),
      computerUseMs: estimate(0, "ms", "no computer-use runtime"),
      failureRecoveryBurden: estimate(1, "ordinal_units", "bounded read-only retry burden"),
    },
    success: {
      ordinal: 900,
      source: "conservative read-only query heuristic",
      version: "p4-success-heuristic-v1",
      quality: "CONSERVATIVE_HEURISTIC",
      confidence: "LOW",
      calibratedProbability: false,
      fallbackAssumption: { ordinal: 700, rationale: "This ordinal is deliberately not a calibrated probability." },
    },
  };
}

function problemFor(input: OperationalQueryP3EpistemicShadowInput, trustedTenantId: string): SearchProblem {
  const state = buildOperationalQueryP3DecisionState(input, trustedTenantId);
  const program = operationalQueryShadowProgram(input);
  const generated = generateBoundedInitialCandidates({
    requestComplexity: "SIMPLE",
    maxInitialCandidates: 1,
    sources: [{
      origin: "PROCEDURE_TEMPLATE",
      originRef: "operational-query-shadow-program@1",
      programs: [{
        candidateId: "authoritative-query-program",
        program,
        solverFacts: { "constraint.constraint.query-completion": input.execution.result.status === "ok" },
      }],
    }],
  });
  return {
    version: 1,
    goal: program.goal,
    epistemicState: state,
    epistemicRequirements: [operationalQueryP3DecisionRequirement(state.scope.decisionId)],
    initialPrograms: generated.candidates,
    hardConstraints: [],
    softObjectives: [],
    capabilities: [queryCapability(input)],
    budgets: {
      maxModelCalls: 0,
      maxTokens: 0,
      maxProviderCalls: 0,
      maxFinancialSpend: { amount: 0, currency: "currency_units" },
      maxHumanInterruptions: 0,
      maxComputerUseMs: 0,
    },
    searchBounds: {
      maxInitialCandidates: 1,
      maxRewriteIterations: 1,
      maxSearchNodes: 4,
      maxSolverTimeMs: 32,
      maxTotalSearchMs: 128,
      maxMemoryBytes: 1_048_576,
    },
    fixedNow: input.execution.metadata.completedAt,
    seed: 4_004,
    solverVersions: { smt: PROGRAM_SEARCH_SMT_SOLVER_VERSION, cpSat: PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION },
    costModelVersion: PROGRAM_SEARCH_COST_MODEL_VERSION,
    rewriteSetVersion: PROGRAM_SEARCH_REWRITE_SET_VERSION,
  };
}

function failureSummary(input: OperationalQueryP3EpistemicShadowInput): OperationalQueryP4ProgramSearchShadowSummary {
  return {
    event: "program_search_p4_shadow",
    version: 1,
    mode: "PURE_SHADOW",
    status: "FAILED",
    authoritativePath: "EXISTING",
    authoritativeBehaviorChanged: false,
    queryIntent: input.readDecision.request.intent,
    searchStatus: "NOT_EVALUATED",
    selectedProgramHash: null,
    survivingCandidates: 0,
    rejectedCandidates: 0,
    semanticDiff: "FIXTURE_INVALID",
    semanticDiffReasonCodes: ["P4_SHADOW_NOT_EVALUATED"],
    p2Statuses: [],
    requirementsForP3: [],
    receiptId: null,
    causalReplay: [],
    failureReasonCodes: ["P4_SHADOW_INTERNAL_FAILURE"],
    plannerCallsAdded: 0,
    ...P2_ZERO_SHADOW_MUTATIONS,
  };
}

/**
 * Best-effort P4 observation over an already completed authoritative query. It has
 * no execution, persistence, Work, Authority, approval, provider, model, computer,
 * or BusinessEffect callback and returns the authoritative execution by identity.
 */
export async function observeOperationalQueryP4ProgramSearchShadow(
  input: OperationalQueryP3EpistemicShadowInput,
  trustedTenantId: string,
  provider: StaticResolutionProvider = finnorStaticResolutionProvider,
  recorder?: OperationalQueryP4ProgramSearchShadowRecorder,
): Promise<OperationalQueryP4ProgramSearchShadowResult> {
  let summary: OperationalQueryP4ProgramSearchShadowSummary;
  let searchResult: SearchResult | null = null;
  let receipt: ProgramSearchDecisionReceipt | null = null;
  let causalReplayNodes: CausalReplayNode[] = [];
  try {
    validateOperationalQueryP3AuthoritativeBoundary(input, trustedTenantId);
    const problem = problemFor(input, trustedTenantId);
    searchResult = await searchOperationalPrograms(problem, {
      checkP2: (program) => checkOperationalProgramAdmissibility(program, { resolution: { tenantId: trustedTenantId, provider } }),
    });
    const authoritativeProgram = problem.initialPrograms[0]!.program;
    const capability = problem.capabilities[0]!;
    const authoritativeSnapshot = programSemanticSnapshot({
      program: authoritativeProgram,
      effects: composeOperationalProgramEffects(authoritativeProgram),
      cost: estimateProgramCost({ program: authoritativeProgram, capabilities: [capability], origin: "PROCEDURE_TEMPLATE" }),
    });
    const optimized = searchResult.survivingCandidates.find((candidate) => candidate.programHash === searchResult!.selectedProgramHash);
    const semanticDiff = compareProgramSemantics({
      authoritativeStatus: "SUPPORTED",
      p4Status: optimized ? "SUPPORTED" : "UNSUPPORTED",
      authoritative: authoritativeSnapshot,
      ...(optimized && candidateSemanticSnapshot(optimized) ? { optimized: candidateSemanticSnapshot(optimized)! } : {}),
    });
    receipt = createProgramSearchDecisionReceipt(problem, searchResult);
    causalReplayNodes = programSearchReceiptToCausalReplayNodes(receipt);
    summary = {
      event: "program_search_p4_shadow",
      version: 1,
      mode: "PURE_SHADOW",
      status: "OBSERVED",
      authoritativePath: "EXISTING",
      authoritativeBehaviorChanged: false,
      queryIntent: input.readDecision.request.intent,
      searchStatus: searchResult.status,
      selectedProgramHash: searchResult.selectedProgramHash,
      survivingCandidates: searchResult.survivingCandidates.length,
      rejectedCandidates: searchResult.rejectedCandidates.length,
      semanticDiff: semanticDiff.classification,
      semanticDiffReasonCodes: semanticDiff.reasonCodes,
      p2Statuses: [...new Set([...searchResult.survivingCandidates, ...searchResult.rejectedCandidates].flatMap((candidate) => candidate.p2 ? [candidate.p2.status] : []))].sort(),
      requirementsForP3: searchResult.requirementsForP3,
      receiptId: receipt.receiptId,
      causalReplay: causalReplayNodes.map((node) => ({ id: node.id, stage: node.stage, status: node.status })),
      failureReasonCodes: [],
      plannerCallsAdded: 0,
      ...P2_ZERO_SHADOW_MUTATIONS,
    };
  } catch {
    summary = failureSummary(input);
  }

  const effectiveRecorder = recorder ?? ((record: OperationalQueryP4ProgramSearchShadowSummary) => {
    logWithTrace({ workId: input.workId, instructionId: input.instructionId }).info(record, "P4 program search shadow");
  });
  try {
    effectiveRecorder(summary);
    return { authoritativeExecution: input.execution, summary, searchResult, receipt, causalReplayNodes, recording: "RECORDED" };
  } catch {
    return { authoritativeExecution: input.execution, summary, searchResult, receipt, causalReplayNodes, recording: "RECORDER_FAILED" };
  }
}
