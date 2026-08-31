import {
  analyzeProgramGraph,
  checkOperationalProgramAdmissibility,
  composeOperationalProgramEffects,
  lowerOperationalProgram,
  validateOperationalProgram,
  type OperationalProgram,
  type ProgramEffectSummary,
} from "@finnor/operational-ir";
import {
  PROGRAM_SEARCH_COST_MODEL_VERSION,
  PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION,
  PROGRAM_SEARCH_REWRITE_SET_VERSION,
  PROGRAM_SEARCH_SMT_SOLVER_VERSION,
  PROGRAM_SEARCH_VERSION,
  type CandidateProgramInput,
  type CandidateRecord,
  type NumericEstimate,
  type ProgramSearchDependencies,
  type ProgramSearchHash,
  type SearchHardConstraint,
  type SearchProblem,
  type SearchProofRecord,
  type SearchRejection,
  type SearchRejectionReasonCode,
  type SearchResult,
  type SearchStats,
  type SmtHardConstraint,
} from "./contracts";
import { effectiveEstimate, estimateProgramCost, estimateProgramSuccess, unknownProgramCost } from "./cost-model";
import { derivePartialOrder } from "./dependencies";
import { candidateKnowledgeReady, decisionReady } from "./epistemic";
import { rankCandidates } from "./extraction";
import {
  computeEquivalenceClass,
  computeProgramSearchHash,
  deterministicReplayKey,
  estimatedCanonicalBytes,
  stableFragment,
} from "./identity";
import { generateGuardedRewrites, type GuardedRewrite } from "./rewrites";
import { solveCpSatConstraint, solveSmtConstraint } from "./solvers";

interface CandidateEnvelope extends CandidateProgramInput {
  parentProgramHash: ProgramSearchHash | null;
  rewriteRule: string | null;
  rewriteApplications: CandidateRecord["rewriteApplications"];
  provenEquivalenceClass?: string;
}

interface ProcessResult {
  record: CandidateRecord;
  survives: boolean;
  newRequirements: string[];
}

function reject(
  stage: SearchRejection["stage"],
  reasonCode: SearchRejectionReasonCode,
  detailCodes: string[],
  message: string,
): SearchRejection {
  return { stage, reasonCode, detailCodes: [...new Set(detailCodes)].sort(), message };
}

function requiredCapabilities(program: OperationalProgram): string[] {
  const graph = analyzeProgramGraph(program.body);
  return [...new Set([...graph.nodes.values()].flatMap(({ node }) => {
    if (node.kind === "effect") return [node.requiredCapability];
    if (node.kind === "query") return [`query:${node.request.intent}`];
    return [];
  }))].sort();
}

function implicitSmtConstraints(program: OperationalProgram): SmtHardConstraint[] {
  return [
    ...program.constraints.filter((constraint) => constraint.severity === "HARD").map((constraint): SmtHardConstraint => ({
      id: `program-hard:${constraint.semanticId}`,
      kind: "SMT",
      description: "Operational IR hard constraint must be statically satisfied.",
      expression: { kind: "ATOM", atom: { kind: "PROGRAM_CONSTRAINT_SATISFIED", constraintId: constraint.semanticId } },
    })),
    ...requiredCapabilities(program).map((capability): SmtHardConstraint => ({
      id: `capability-available:${capability}`,
      kind: "SMT",
      description: "Every executable capability must be statically available.",
      expression: { kind: "ATOM", atom: { kind: "CAPABILITY_AVAILABLE", capability } },
    })),
  ];
}

function budgetViolations(problem: SearchProblem, record: CandidateRecord): string[] {
  const limits = problem.budgets;
  const cost = record.costEstimate;
  return [
    ...(limits.maxModelCalls !== undefined && effectiveEstimate(cost.modelCalls) > limits.maxModelCalls ? ["MAX_MODEL_CALLS"] : []),
    ...(limits.maxTokens !== undefined && effectiveEstimate(cost.tokens) > limits.maxTokens ? ["MAX_TOKENS"] : []),
    ...(limits.maxProviderCalls !== undefined && effectiveEstimate(cost.providerCalls) > limits.maxProviderCalls ? ["MAX_PROVIDER_CALLS"] : []),
    ...(limits.maxFinancialSpend !== undefined && cost.financialSpend.unit !== limits.maxFinancialSpend.currency
      ? [`FINANCIAL_SPEND_UNIT_MISMATCH:${cost.financialSpend.unit}:${limits.maxFinancialSpend.currency}`]
      : limits.maxFinancialSpend !== undefined && effectiveEstimate(cost.financialSpend) > limits.maxFinancialSpend.amount
        ? [`MAX_FINANCIAL_SPEND:${limits.maxFinancialSpend.currency}`]
        : []),
    ...(limits.maxExpectedLatencyMs !== undefined && effectiveEstimate(cost.expectedLatencyMs) > limits.maxExpectedLatencyMs ? ["MAX_EXPECTED_LATENCY_MS"] : []),
    ...(limits.maxHumanInterruptions !== undefined && effectiveEstimate(cost.humanInterruptions) > limits.maxHumanInterruptions ? ["MAX_HUMAN_INTERRUPTS"] : []),
    ...(limits.maxComputerUseMs !== undefined && effectiveEstimate(cost.computerUseMs) > limits.maxComputerUseMs ? ["MAX_COMPUTER_USE_MS"] : []),
  ];
}

function validBounds(problem: SearchProblem): boolean {
  const bounds = problem.searchBounds;
  const nonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const validEstimate = (value: NumericEstimate): boolean => value
    && (value.value === null || nonNegative(value.value))
    && nonNegative(value.fallbackAssumption?.value)
    && (value.value !== null || value.fallbackAssumption.value > 0)
    && typeof value.unit === "string" && value.unit.length > 0
    && typeof value.source === "string" && value.source.length > 0
    && typeof value.version === "string" && value.version.length > 0;
  const validSuccess = (value: CandidateProgramInput["successOverride"]): boolean => !value || (
    (value.ordinal === null || (Number.isSafeInteger(value.ordinal) && value.ordinal >= 0 && value.ordinal <= 1_000))
    && Number.isSafeInteger(value.fallbackAssumption.ordinal)
    && value.fallbackAssumption.ordinal >= 0
    && value.fallbackAssumption.ordinal <= 1_000
    && value.calibratedProbability === false
  );
  const budgetValues = [
    problem.budgets.maxModelCalls,
    problem.budgets.maxTokens,
    problem.budgets.maxProviderCalls,
    problem.budgets.maxFinancialSpend?.amount,
    problem.budgets.maxExpectedLatencyMs,
    problem.budgets.maxHumanInterruptions,
    problem.budgets.maxComputerUseMs,
  ].filter((value): value is number => value !== undefined);
  return Number.isSafeInteger(problem.seed)
    && Number.isFinite(Date.parse(problem.fixedNow))
    && Object.values(bounds).every((value) => Number.isSafeInteger(value) && value > 0)
    && budgetValues.every(nonNegative)
    && (problem.budgets.maxFinancialSpend === undefined || problem.budgets.maxFinancialSpend.currency.trim().length > 0)
    && new Set(problem.initialPrograms.map((candidate) => candidate.candidateId)).size === problem.initialPrograms.length
    && new Set(problem.hardConstraints.map((constraint) => constraint.id)).size === problem.hardConstraints.length
    && new Set(problem.capabilities.map((capability) => capability.capability)).size === problem.capabilities.length
    && problem.initialPrograms.every((candidate) => candidate.candidateId.trim().length > 0
      && candidate.originRef.trim().length > 0
      && Object.values(candidate.costOverrides ?? {}).every(validEstimate)
      && validSuccess(candidate.successOverride))
    && problem.capabilities.every((capability) => capability.capability.trim().length > 0
      && capability.version.trim().length > 0
      && Object.values(capability.cost).every((estimate) => estimate !== undefined
        && (estimate.value === null || nonNegative(estimate.value))
        && (estimate.fallbackAssumption === undefined
          || (nonNegative(estimate.fallbackAssumption.value)
            && (estimate.value !== null || estimate.fallbackAssumption.value > 0))))
      && validSuccess(capability.success))
    && problem.solverVersions.smt === PROGRAM_SEARCH_SMT_SOLVER_VERSION
    && problem.solverVersions.cpSat === PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION
    && problem.costModelVersion === PROGRAM_SEARCH_COST_MODEL_VERSION
    && problem.rewriteSetVersion === PROGRAM_SEARCH_REWRITE_SET_VERSION;
}

function baseRecord(envelope: CandidateEnvelope): CandidateRecord {
  let programHash: ProgramSearchHash;
  try { programHash = computeProgramSearchHash(envelope.program); }
  catch { programHash = `p4:program:sha256:${"0".repeat(64)}`; }
  return {
    candidateId: envelope.candidateId,
    origin: envelope.origin,
    originRef: envelope.originRef,
    programHash,
    irSemanticHash: envelope.program.irSemanticHash,
    parentProgramHash: envelope.parentProgramHash,
    rewriteRule: envelope.rewriteRule,
    equivalenceClass: "p4:eclass:unvalidated",
    program: envelope.program,
    constraintResults: [],
    costEstimate: unknownProgramCost(),
    successEstimate: {
      ordinal: null,
      source: "program unavailable before structural validation",
      version: "p4-success-heuristic-v1",
      quality: "UNKNOWN",
      confidence: "UNKNOWN",
      calibratedProbability: false,
      fallbackAssumption: { ordinal: 0, rationale: "Invalid programs receive no success credit." },
    },
    rewriteApplications: envelope.rewriteApplications,
  };
}

function semanticDedupKey(record: CandidateRecord): string {
  const mandatory = record.dependencies?.relations
    .filter((relation) => ["MUST_PRECEDE", "ENABLES", "COMPENSATES", "CONFLICTS"].includes(relation.relation))
    .map((relation) => `${relation.from}|${relation.to}|${relation.relation}`)
    .sort() ?? [];
  const cost = Object.fromEntries(Object.entries(record.costEstimate).map(([key, estimate]) => [key, {
    value: estimate.value,
    fallback: estimate.fallbackAssumption.value,
    unit: estimate.unit,
  }]));
  return stableFragment({ equivalenceClass: record.equivalenceClass, mandatory, cost });
}

function makeStats(problem: SearchProblem): SearchStats {
  return {
    mode: problem.initialPrograms.length <= 1 && problem.searchBounds.maxRewriteIterations <= 1
      ? "SIMPLE_FAST_PATH" : "BOUNDED_SEARCH",
    initialCandidatesReceived: problem.initialPrograms.length,
    initialCandidatesAccepted: 0,
    rewriteIterations: 0,
    rewriteApplications: 0,
    searchNodesVisited: 0,
    duplicatesEliminated: 0,
    solverCalls: { smt: 0, cpSat: 0 },
    solverNodes: 0,
    deterministicTimeUnits: 0,
    wallTimeMs: 0,
    estimatedMemoryBytes: 0,
    budgetExhausted: false,
    budgetReasonCodes: [],
  };
}

function finish(input: {
  problem: SearchProblem;
  status: SearchResult["status"];
  survivors: CandidateRecord[];
  rejected: CandidateRecord[];
  proofs: SearchProofRecord[];
  requirements: Set<string>;
  stats: SearchStats;
}): SearchResult {
  const ranked = rankCandidates({ goal: input.problem.goal, candidates: input.survivors, softObjectives: input.problem.softObjectives });
  const selected = ranked[0] ?? null;
  if (selected) input.proofs.push({
    sequence: input.proofs.length + 1,
    kind: "EXTRACTION",
    programHash: selected.programHash,
    reasonCodes: ["LEXICOGRAPHIC_WINNER"],
    detail: { tieBreak: selected.programHash, survivorCount: ranked.length },
  });
  input.stats.wallTimeMs = input.stats.deterministicTimeUnits;
  const replayMaterial = {
    problem: {
      ...input.problem,
      initialPrograms: [...input.problem.initialPrograms].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
      hardConstraints: [...input.problem.hardConstraints].sort((left, right) => left.id.localeCompare(right.id)),
      softObjectives: [...input.problem.softObjectives].sort((left, right) => left.id.localeCompare(right.id)),
      capabilities: [...input.problem.capabilities].sort((left, right) => left.capability.localeCompare(right.capability)),
      epistemicRequirements: [...input.problem.epistemicRequirements].sort((left, right) => left.propositionId.localeCompare(right.propositionId)),
    },
    status: input.status,
    selectedProgramHash: selected?.programHash ?? null,
    survivorHashes: ranked.map((record) => record.programHash),
    rejectionCodes: input.rejected.map((record) => record.rejection?.reasonCode ?? "NONE"),
    solverVersions: input.problem.solverVersions,
    costModelVersion: input.problem.costModelVersion,
    rewriteSetVersion: input.problem.rewriteSetVersion,
    seed: input.problem.seed,
  };
  return {
    version: PROGRAM_SEARCH_VERSION,
    status: input.status,
    selectedProgram: selected?.program ?? null,
    selectedProgramHash: selected?.programHash ?? null,
    survivingCandidates: ranked,
    rejectedCandidates: input.rejected,
    proofRecords: input.proofs,
    extractionScore: selected?.extractionScore ?? null,
    requirementsForP3: [...input.requirements].sort(),
    searchStats: input.stats,
    deterministicReplayKey: deterministicReplayKey(replayMaterial),
    hardConstraintsUsedAsScores: 0,
    modelFinalPlanJudgments: 0,
  };
}

/**
 * Pure, fail-closed P4 search. It never authorizes, dispatches, persists, performs
 * information acquisition, or executes a program. All candidates and material
 * rewrites must independently pass P3, P2, dependency, solver, budget, and existing
 * runtime-lowering gates before deterministic lexicographic extraction.
 */
export async function searchOperationalPrograms(
  problem: SearchProblem,
  dependencies: ProgramSearchDependencies = {},
): Promise<SearchResult> {
  if (problem.version !== PROGRAM_SEARCH_VERSION || !validBounds(problem)) {
    throw new TypeError("INVALID_P4_SEARCH_PROBLEM");
  }
  const checkP2 = dependencies.checkP2 ?? ((program: OperationalProgram) => checkOperationalProgramAdmissibility(program));
  const lower = dependencies.lower ?? lowerOperationalProgram;
  const stats = makeStats(problem);
  const survivors: CandidateRecord[] = [];
  const rejected: CandidateRecord[] = [];
  const proofs: SearchProofRecord[] = [{
    sequence: 1,
    kind: "SEARCH_STARTED",
    reasonCodes: [stats.mode],
    detail: {
      seed: problem.seed,
      initialCandidates: problem.initialPrograms.length,
      maxSearchNodes: problem.searchBounds.maxSearchNodes,
      maxTotalSearchMs: problem.searchBounds.maxTotalSearchMs,
    },
  }];
  const requirements = new Set<string>();
  const seenHashes = new Set<ProgramSearchHash>();
  const semanticKeys = new Set<string>();
  const candidateContext = new Map<ProgramSearchHash, {
    solverFacts?: CandidateProgramInput["solverFacts"];
    requiredPropositionIds: string[];
  }>();

  const recordProof = (kind: SearchProofRecord["kind"], reasonCodes: string[], detail: SearchProofRecord["detail"], programHash?: ProgramSearchHash): void => {
    proofs.push({ sequence: proofs.length + 1, kind, ...(programHash ? { programHash } : {}), reasonCodes: [...new Set(reasonCodes)].sort(), detail });
  };
  const exhaust = (reason: SearchRejectionReasonCode): void => {
    stats.budgetExhausted = true;
    if (!stats.budgetReasonCodes.includes(reason)) stats.budgetReasonCodes.push(reason);
    recordProof("BUDGET_STOP", [reason], { deterministicTimeUnits: stats.deterministicTimeUnits });
  };
  const advance = (units = 1): boolean => {
    stats.deterministicTimeUnits += Math.max(1, Math.floor(units));
    if (stats.deterministicTimeUnits > problem.searchBounds.maxTotalSearchMs) {
      stats.deterministicTimeUnits = problem.searchBounds.maxTotalSearchMs;
      exhaust("SEARCH_TIME_BUDGET_EXHAUSTED");
      return false;
    }
    return true;
  };

  const globalKnowledge = decisionReady(problem.epistemicState, problem.epistemicRequirements);
  if (!globalKnowledge.ready) {
    for (const id of globalKnowledge.unresolvedMandatory) requirements.add(id);
    recordProof("CANDIDATE_REJECTED", globalKnowledge.reasonCodes, { stage: "P3_KNOWLEDGE_SUFFICIENCY" });
    return finish({ problem, status: "P3_UNRESOLVED", survivors, rejected, proofs, requirements, stats });
  }

  const processCandidate = async (envelope: CandidateEnvelope): Promise<ProcessResult> => {
    const record = baseRecord(envelope);
    if (stats.searchNodesVisited >= problem.searchBounds.maxSearchNodes) {
      exhaust("SEARCH_NODE_BUDGET_EXHAUSTED");
      record.rejection = reject("SEARCH_BUDGET", "SEARCH_NODE_BUDGET_EXHAUSTED", [], "Candidate was not explored because the bounded search-node limit was reached.");
      return { record, survives: false, newRequirements: [] };
    }
    stats.searchNodesVisited += 1;
    const baseBytes = estimatedCanonicalBytes({
      candidateId: envelope.candidateId,
      origin: envelope.origin,
      originRef: envelope.originRef,
      parentProgramHash: envelope.parentProgramHash,
      rewriteRule: envelope.rewriteRule,
      program: envelope.program,
    });
    if (stats.estimatedMemoryBytes + baseBytes > problem.searchBounds.maxMemoryBytes) {
      exhaust("SEARCH_MEMORY_BUDGET_EXHAUSTED");
      record.rejection = reject("SEARCH_BUDGET", "SEARCH_MEMORY_BUDGET_EXHAUSTED", [], "Candidate graph node would exceed the configured search-memory bound.");
      return { record, survives: false, newRequirements: [] };
    }
    stats.estimatedMemoryBytes += baseBytes;
    if (!advance()) {
      record.rejection = reject("SEARCH_BUDGET", "SEARCH_TIME_BUDGET_EXHAUSTED", [], "Candidate was not explored because the deterministic total-search bound was reached.");
      return { record, survives: false, newRequirements: [] };
    }

    const validation = validateOperationalProgram(envelope.program);
    if (!validation.valid || !validation.program) {
      record.rejection = reject("IR_STRUCTURAL_VALIDATION", "IR_STRUCTURAL_INVALID", validation.errors.map((error) => error.code), "Operational IR structural validation failed.");
      return { record, survives: false, newRequirements: [] };
    }
    const program = validation.program;
    record.program = program;
    record.programHash = computeProgramSearchHash(program);
    if (seenHashes.has(record.programHash)) {
      stats.duplicatesEliminated += 1;
      record.rejection = reject("REWRITE_GUARD", "DUPLICATE_PROGRAM", [], "An identical canonical program was already explored.");
      return { record, survives: false, newRequirements: [] };
    }
    seenHashes.add(record.programHash);

    const requiredKnowledge = candidateKnowledgeReady(problem.epistemicState, envelope.requiredPropositionIds ?? []);
    if (!requiredKnowledge.ready) {
      record.rejection = reject("P3_KNOWLEDGE_SUFFICIENCY", "P3_CANDIDATE_MANDATORY_UNKNOWN", requiredKnowledge.reasonCodes, "Candidate introduced mandatory knowledge not resolved by P3.");
      return { record, survives: false, newRequirements: requiredKnowledge.unresolvedMandatory };
    }
    if (!advance()) {
      record.rejection = reject("SEARCH_BUDGET", "SEARCH_TIME_BUDGET_EXHAUSTED", [], "Search time bound reached before P2 admissibility.");
      return { record, survives: false, newRequirements: [] };
    }

    let p2: Awaited<ReturnType<NonNullable<ProgramSearchDependencies["checkP2"]>>>;
    try {
      p2 = await checkP2(program);
    } catch {
      record.p2 = { status: "UNRESOLVED", reasonCodes: [], issues: [] };
      record.rejection = reject("P2_STATIC_ADMISSIBILITY", "P2_UNRESOLVED", ["P2_CHECK_FAILED"], "P2 admissibility did not return a proven result; P4 failed closed.");
      return { record, survives: false, newRequirements: [] };
    }
    record.p2 = { status: p2.status, reasonCodes: p2.reasonCodes, issues: p2.issues };
    if (p2.status !== "ADMISSIBLE") {
      const reasonCode = p2.status === "REJECTED" ? "P2_REJECTED" : "P2_UNRESOLVED";
      record.rejection = reject("P2_STATIC_ADMISSIBILITY", reasonCode, p2.reasonCodes, `P2 returned ${p2.status}; P4 cannot override it.`);
      return { record, survives: false, newRequirements: [] };
    }

    const effects: ProgramEffectSummary = p2.summary ?? composeOperationalProgramEffects(program);
    record.effects = effects;
    record.equivalenceClass = envelope.provenEquivalenceClass ?? computeEquivalenceClass(program, effects);
    record.dependencies = derivePartialOrder(program, effects);
    if (!record.dependencies.legal) {
      const conflict = record.dependencies.reasonCodes.some((code) => code.includes("CONFLICT"));
      record.rejection = reject("DEPENDENCY_LEGALITY", conflict ? "CONFLICTING_PARALLEL_EFFECTS" : record.dependencies.reasonCodes.includes("DEPENDENCY_CYCLE") ? "DEPENDENCY_CYCLE" : "DEPENDENCY_VIOLATION", record.dependencies.reasonCodes, "Causal dependency graph is illegal.");
      return { record, survives: false, newRequirements: [] };
    }

    record.costEstimate = estimateProgramCost({ program, capabilities: problem.capabilities, origin: envelope.origin, overrides: envelope.costOverrides });
    record.successEstimate = estimateProgramSuccess({ program, capabilities: problem.capabilities, summary: effects, override: envelope.successOverride });
    const solverContext = {
      program,
      effects,
      dependencies: record.dependencies,
      capabilities: problem.capabilities,
      facts: envelope.solverFacts ?? {},
    };
    const constraints: SearchHardConstraint[] = [...implicitSmtConstraints(program), ...problem.hardConstraints]
      .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
    for (const constraint of constraints) {
      const result = constraint.kind === "SMT"
        ? solveSmtConstraint(constraint, solverContext, problem.solverVersions.smt, problem.searchBounds.maxSolverTimeMs)
        : solveCpSatConstraint(constraint, envelope.solverFacts ?? {}, problem.solverVersions.cpSat, problem.searchBounds.maxSolverTimeMs);
      record.constraintResults.push(result);
      stats.solverCalls[constraint.kind === "SMT" ? "smt" : "cpSat"] += 1;
      stats.solverNodes += result.exploredNodes;
      if (!advance(result.deterministicTimeUnits)) {
        record.rejection = reject(constraint.kind === "SMT" ? "SMT_SOLVER" : "CP_SAT_SOLVER", "SOLVER_TIME_BUDGET_EXHAUSTED", result.reasonCodes, "Solver or total deterministic time bound was exhausted.");
        return { record, survives: false, newRequirements: [] };
      }
      recordProof("SOLVER_RESULT", result.reasonCodes, { constraintId: constraint.id, solver: result.solver, status: result.status, exploredNodes: result.exploredNodes }, record.programHash);
      const accepted = constraint.kind === "SMT" ? result.status === "SAT" : result.status === "FEASIBLE" || result.status === "OPTIMAL";
      if (!accepted) {
        const reasonCode = constraint.kind === "SMT"
          ? result.status === "UNSAT" ? "SMT_UNSAT" : result.reasonCodes.includes("SMT_DETERMINISTIC_TIME_BOUND_EXHAUSTED") ? "SOLVER_TIME_BUDGET_EXHAUSTED" : "SMT_UNKNOWN"
          : result.status === "INFEASIBLE" ? "CP_SAT_INFEASIBLE" : result.reasonCodes.includes("CP_SAT_DETERMINISTIC_TIME_BOUND_EXHAUSTED") ? "SOLVER_TIME_BUDGET_EXHAUSTED" : "CP_SAT_UNKNOWN";
        if (reasonCode === "SOLVER_TIME_BUDGET_EXHAUSTED") exhaust(reasonCode);
        record.rejection = reject(constraint.kind === "SMT" ? "SMT_SOLVER" : "CP_SAT_SOLVER", reasonCode, result.reasonCodes, "Hard solver constraint did not produce a proven feasible result.");
        return { record, survives: false, newRequirements: [] };
      }
    }

    const overBudget = budgetViolations(problem, record);
    if (overBudget.length > 0) {
      record.rejection = reject("SEARCH_BUDGET", "PROGRAM_BUDGET_EXCEEDED", overBudget, "Candidate exceeds a hard program budget.");
      return { record, survives: false, newRequirements: [] };
    }

    let lowering: ReturnType<NonNullable<ProgramSearchDependencies["lower"]>>;
    try {
      lowering = lower(program);
    } catch {
      record.rejection = reject("RUNTIME_LOWERING", "UNSUPPORTED_RUNTIME_LOWERING", ["LOWERING_BOUNDARY_FAILED"], "Existing governed-runtime lowering did not return a supported result.");
      return { record, survives: false, newRequirements: [] };
    }
    record.lowering = { status: lowering.status, classification: lowering.classification, reasons: lowering.reasons };
    if (lowering.status !== "LOWERED") {
      record.rejection = reject("RUNTIME_LOWERING", "UNSUPPORTED_RUNTIME_LOWERING", lowering.reasons, "Existing governed runtime cannot lower this complete program.");
      return { record, survives: false, newRequirements: [] };
    }

    const dedupKey = semanticDedupKey(record);
    if (semanticKeys.has(dedupKey)) {
      stats.duplicatesEliminated += 1;
      record.rejection = reject("REWRITE_GUARD", "DUPLICATE_PROGRAM", ["GUARDED_SEMANTIC_EQUIVALENCE"], "A guarded semantically equivalent program with the same execution cost was already retained.");
      return { record, survives: false, newRequirements: [] };
    }
    semanticKeys.add(dedupKey);

    const bytes = estimatedCanonicalBytes({ effects, dependencies: record.dependencies, constraints: record.constraintResults, cost: record.costEstimate });
    if (stats.estimatedMemoryBytes + bytes > problem.searchBounds.maxMemoryBytes) {
      exhaust("SEARCH_MEMORY_BUDGET_EXHAUSTED");
      record.rejection = reject("SEARCH_BUDGET", "SEARCH_MEMORY_BUDGET_EXHAUSTED", [], "Candidate graph node would exceed the configured search-memory bound.");
      return { record, survives: false, newRequirements: [] };
    }
    stats.estimatedMemoryBytes += bytes;
    candidateContext.set(record.programHash, {
      ...(envelope.solverFacts ? { solverFacts: envelope.solverFacts } : {}),
      requiredPropositionIds: [...(envelope.requiredPropositionIds ?? [])],
    });
    return { record, survives: true, newRequirements: [] };
  };

  const initial = [...problem.initialPrograms].sort((left, right) => `${left.candidateId}\u0000${left.origin}\u0000${left.originRef}`.localeCompare(`${right.candidateId}\u0000${right.origin}\u0000${right.originRef}`));
  const eligibleInitial = initial.slice(0, problem.searchBounds.maxInitialCandidates);
  const initialCandidateBoundExceeded = initial.length > eligibleInitial.length;
  for (const omitted of initial.slice(problem.searchBounds.maxInitialCandidates)) {
    const envelope: CandidateEnvelope = { ...omitted, parentProgramHash: null, rewriteRule: null, rewriteApplications: [] };
    const record = baseRecord(envelope);
    record.rejection = reject("SEARCH_BUDGET", "SEARCH_NODE_BUDGET_EXHAUSTED", ["MAX_INITIAL_CANDIDATES"], "Candidate was outside maxInitialCandidates.");
    rejected.push(record);
    recordProof("CANDIDATE_REJECTED", ["SEARCH_NODE_BUDGET_EXHAUSTED", "MAX_INITIAL_CANDIDATES"], { stage: "SEARCH_BUDGET" }, record.programHash);
  }
  let frontier: CandidateRecord[] = [];
  for (const candidate of eligibleInitial) {
    const result = await processCandidate({ ...candidate, parentProgramHash: null, rewriteRule: null, rewriteApplications: [] });
    for (const id of result.newRequirements) requirements.add(id);
    if (result.survives) {
      survivors.push(result.record);
      frontier.push(result.record);
      stats.initialCandidatesAccepted += 1;
      recordProof("CANDIDATE_ACCEPTED", ["ALL_HARD_GATES_PASSED"], { origin: result.record.origin }, result.record.programHash);
    } else {
      rejected.push(result.record);
      recordProof(result.record.rejection?.reasonCode === "DUPLICATE_PROGRAM" ? "DUPLICATE_ELIMINATED" : "CANDIDATE_REJECTED", [result.record.rejection?.reasonCode ?? "UNKNOWN_REJECTION"], { stage: result.record.rejection?.stage ?? "UNKNOWN" }, result.record.programHash);
    }
    if (stats.budgetExhausted) break;
  }

  for (let iteration = 1; iteration <= problem.searchBounds.maxRewriteIterations && frontier.length > 0 && !stats.budgetExhausted; iteration += 1) {
    stats.rewriteIterations = iteration;
    const next: CandidateRecord[] = [];
    for (const parent of [...frontier].sort((left, right) => left.programHash.localeCompare(right.programHash))) {
      const generated: GuardedRewrite[] = generateGuardedRewrites(parent.program, problem.capabilities);
      for (const rewrite of generated) {
        stats.rewriteApplications += 1;
        const resultHash = computeProgramSearchHash(rewrite.program);
        const application = {
          ruleId: rewrite.rule.id,
          ruleVersion: rewrite.rule.version,
          parentProgramHash: parent.programHash,
          resultProgramHash: resultHash,
          safetyClass: rewrite.safetyClass,
          proofRefs: rewrite.proofRefs,
          costImpact: rewrite.rule.costImpact,
          effectRelation: rewrite.effectRelation,
        } as const;
        recordProof("REWRITE_APPLIED", [rewrite.rule.id, rewrite.safetyClass, rewrite.effectRelation], { iteration, ruleVersion: rewrite.rule.version }, resultHash);
        const inherited = candidateContext.get(parent.programHash);
        const origin = rewrite.rule.id === "substitute_equivalent_capability" ? "CAPABILITY_ALTERNATIVE"
          : rewrite.rule.id === "introduce_legal_compensation_path" ? "RECOVERY_ALTERNATIVE"
            : "DETERMINISTIC_REWRITE";
        const result = await processCandidate({
          candidateId: `${parent.candidateId}:rw:${iteration}:${rewrite.rule.id}:${resultHash.slice(-12)}`,
          origin,
          originRef: `${rewrite.rule.id}@${rewrite.rule.version}`,
          program: rewrite.program,
          requiredPropositionIds: [...new Set([...(inherited?.requiredPropositionIds ?? []), ...rewrite.requiredPropositionIds])],
          ...(inherited?.solverFacts ? { solverFacts: inherited.solverFacts } : {}),
          parentProgramHash: parent.programHash,
          rewriteRule: rewrite.rule.id,
          rewriteApplications: [...parent.rewriteApplications, application],
          ...(rewrite.safetyClass === "SEMANTIC_EQUIVALENCE" ? { provenEquivalenceClass: parent.equivalenceClass } : {}),
        });
        for (const id of result.newRequirements) requirements.add(id);
        if (result.survives) {
          survivors.push(result.record);
          next.push(result.record);
          recordProof("CANDIDATE_ACCEPTED", ["REWRITE_ALL_HARD_GATES_PASSED"], { origin: result.record.origin }, result.record.programHash);
        } else {
          rejected.push(result.record);
          recordProof(result.record.rejection?.reasonCode === "DUPLICATE_PROGRAM" ? "DUPLICATE_ELIMINATED" : "CANDIDATE_REJECTED", [result.record.rejection?.reasonCode ?? "UNKNOWN_REJECTION"], { stage: result.record.rejection?.stage ?? "UNKNOWN" }, result.record.programHash);
        }
        if (stats.budgetExhausted) break;
      }
      if (stats.budgetExhausted) break;
    }
    frontier = next;
  }

  // Truncating the source set makes the result explicitly incomplete, but all
  // candidates inside maxInitialCandidates are still evaluated before the stop.
  if (initialCandidateBoundExceeded) exhaust("SEARCH_NODE_BUDGET_EXHAUSTED");

  const loweringUnsupportedOnly = survivors.length === 0 && rejected.length > 0
    && rejected.every((record) => record.rejection?.reasonCode === "UNSUPPORTED_RUNTIME_LOWERING" || record.rejection?.reasonCode === "P2_UNRESOLVED");
  const status: SearchResult["status"] = stats.budgetExhausted ? "BOUNDED_INCOMPLETE"
    : survivors.length > 0 ? "SELECTED"
      : requirements.size > 0 ? "P3_UNRESOLVED"
        : loweringUnsupportedOnly ? "UNSUPPORTED"
          : "NO_SURVIVING_PROGRAM";
  return finish({ problem, status, survivors, rejected, proofs, requirements, stats });
}
