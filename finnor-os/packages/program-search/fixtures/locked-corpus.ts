import casesJson from "./locked-cases.json";
import {
  checkOperationalProgramAdmissibility,
  composeOperationalProgramEffects,
  inferExecutableNodeEffects,
  lowerOperationalProgram,
  sealOperationalProgram,
  type OperationalProgram,
} from "@finnor/operational-ir";
import {
  financialWriteProgram,
  internalCanonicalWriteProgram,
  parallelConflictingWritesProgram,
  piiResearchExportProgram,
  staticResolutionContext,
  validCompensationProgram,
} from "../../operational-ir/fixtures/p2-programs";
import { createTaskEffect, effectObservation, reseal, sequenceProgram } from "../../operational-ir/fixtures/programs";
import {
  derivePartialOrder,
  effectiveEstimate,
  generateGuardedRewrites,
  rankCandidates,
  rewriteInventory,
  searchOperationalPrograms,
  solveCpSatConstraint,
  solveSmtConstraint,
  type CandidateRecord,
  type SearchCapability,
} from "../src/index";
import {
  capability,
  checkP2Resolved,
  emptyEpistemicState,
  estimate,
  queryProgram,
  searchProblem,
  unresolvedRequirement,
} from "./programs";

export interface P4LockedCase {
  id: string;
  category: string;
  evidence: string;
}

export interface P4LockedCaseResult extends P4LockedCase {
  passed: true;
  actual: string;
}

export const P4_LOCKED_CASES = casesJson as P4LockedCase[];

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`P4_LOCKED_CASE_FAILED:${code}`);
}

function actionCapability(name: string, options: Partial<SearchCapability> = {}): SearchCapability {
  return {
    capability: name,
    available: true,
    version: "p4-locked-action-v1",
    cost: {
      modelCalls: estimate(0, "calls"), tokens: estimate(0, "tokens"), providerCalls: estimate(1, "calls"),
      financialSpend: estimate(0, "currency_units"), expectedLatencyMs: estimate(10, "ms"), humanInterruptions: estimate(0, "interruptions"),
      computerUseMs: estimate(0, "ms"), failureRecoveryBurden: estimate(1, "ordinal_units"),
    },
    success: {
      ordinal: 700, source: "locked action ordinal", version: "p4-success-heuristic-v1", quality: "CONSERVATIVE_HEURISTIC",
      confidence: "LOW", calibratedProbability: false, fallbackAssumption: { ordinal: 300, rationale: "Ordinal only." },
    },
    ...options,
  };
}

function multiQueryUnsupported(): OperationalProgram {
  const base = queryProgram();
  const { irSemanticHash: _hash, ...draft } = base;
  return sealOperationalProgram({
    ...draft,
    executionModel: "OBJECTIVE",
    body: { kind: "sequence", semanticId: "sequence.unsupported", steps: [base.body, { ...base.body, semanticId: "query.unsupported-second" }] },
    budget: { ...base.budget!, maxSteps: 2, maxQueries: 2 },
  });
}

function smtContext() {
  const program = queryProgram();
  return {
    program,
    effects: composeOperationalProgramEffects(program),
    dependencies: derivePartialOrder(program),
    capabilities: [capability("money_summary")],
    facts: { enabled: true },
  };
}

async function runCase(id: string): Promise<string> {
  if (id === "p4_single_obvious_program") {
    const result = await searchOperationalPrograms(searchProblem(), { checkP2: checkP2Resolved });
    assert(result.status === "SELECTED" && result.survivingCandidates.length === 1, id);
    return "SEARCH_SELECTED";
  }
  if (id === "p4_multiple_equivalent_programs" || id === "p4_duplicate_program_elimination") {
    const program = queryProgram();
    const result = await searchOperationalPrograms(searchProblem({ programs: [
      { candidateId: "a", origin: "MODEL_CANDIDATE", originRef: "a", program },
      { candidateId: "b", origin: "PROCEDURE_TEMPLATE", originRef: "b", program },
    ] }), { checkP2: checkP2Resolved });
    assert(result.survivingCandidates.length === 1 && result.rejectedCandidates.some((candidate) => candidate.rejection?.reasonCode === "DUPLICATE_PROGRAM"), id);
    return id === "p4_multiple_equivalent_programs" ? "SEMANTIC_DEDUP" : "DUPLICATE_PROGRAM";
  }
  if (id === "p4_one_illegal_candidate" || id === "p4_hard_vs_soft_constraints") {
    const legal = queryProgram("money_summary", { variant: "legal" });
    const illegal = queryProgram("work_list", { variant: "illegal" });
    const result = await searchOperationalPrograms(searchProblem({
      programs: [
        { candidateId: "illegal", origin: "CAPABILITY_ALTERNATIVE", originRef: "preferred", program: illegal, solverFacts: { legal: false } },
        { candidateId: "legal", origin: "PROCEDURE_TEMPLATE", originRef: "legal", program: legal, solverFacts: { legal: true } },
      ],
      capabilities: [capability("money_summary", { latency: 1_000 }), capability("work_list", { latency: 1 })],
      hardConstraints: [{ id: "must-be-legal", kind: "SMT", description: "Legality is hard.", expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "legal", operator: "EQ", value: true } } }],
      softObjectives: [{ id: "prefer-illegal-capability", kind: "PREFER_CAPABILITY", capability: "query:work_list", description: "A soft preference cannot override legality." }],
    }), { checkP2: checkP2Resolved });
    assert(result.survivingCandidates[0]?.candidateId === "legal" && result.rejectedCandidates[0]?.rejection?.reasonCode === "SMT_UNSAT" && result.hardConstraintsUsedAsScores === 0, id);
    return id === "p4_one_illegal_candidate" ? "HARD_REJECTION_WITH_SURVIVOR" : "HARD_NEVER_SCORED";
  }
  if (id === "p4_all_illegal_candidates") {
    const result = await searchOperationalPrograms(searchProblem({ capabilities: [capability("money_summary", { available: false })] }), { checkP2: checkP2Resolved });
    assert(result.status === "NO_SURVIVING_PROGRAM" && result.rejectedCandidates[0]?.rejection?.reasonCode === "SMT_UNSAT", id);
    return "NO_SURVIVING_PROGRAM";
  }
  if (id === "p4_dependent_sequence") {
    const program = reseal(sequenceProgram(), (draft) => {
      if (draft.body.kind !== "sequence" || draft.body.steps[1]?.kind !== "effect") throw new Error("fixture drift");
      draft.body.steps[1].dependsOn = [draft.body.steps[0]!.semanticId];
    });
    assert(derivePartialOrder(program).relations.some((relation) => relation.relation === "MUST_PRECEDE"), id);
    return "MUST_PRECEDE";
  }
  if (id === "p4_independent_parallel_actions") {
    const rewrite = generateGuardedRewrites(sequenceProgram(), []).find((candidate) => candidate.rule.id === "parallelize_independent_operations");
    assert(rewrite?.program.body.kind === "parallel" && rewrite.safetyClass === "SEMANTIC_EQUIVALENCE", id);
    return "GUARDED_PARALLELIZATION";
  }
  if (id === "p4_conflicting_writes") {
    const plan = derivePartialOrder(parallelConflictingWritesProgram());
    assert(!plan.legal && plan.relations.some((relation) => relation.relation === "CONFLICTS"), id);
    return "PARALLEL_CONFLICT_REJECTED";
  }
  if (id === "p4_alternative_capabilities") {
    const original = internalCanonicalWriteProgram();
    assert(original.body.kind === "effect", "alternative_fixture");
    const replacement = { ...structuredClone(original.body), requiredCapability: "action:create_task_alternative" };
    const common = { equivalenceClass: "audited-create-task-v1" };
    const capabilities = [
      actionCapability("action:create_task", common),
      actionCapability("action:create_task_alternative", { ...common, substitution: { replacesCapability: "action:create_task", proofRef: "audit:create-task-equivalence:v1", replacementEffect: replacement } }),
    ];
    const rewrite = generateGuardedRewrites(original, capabilities).find((candidate) => candidate.rule.id === "substitute_equivalent_capability");
    assert(rewrite?.proofRefs.includes("audit:create-task-equivalence:v1") && rewrite.program.body.kind === "effect" && rewrite.program.body.requiredCapability === "action:create_task_alternative", id);
    return "AUDITED_SUBSTITUTION";
  }
  if (id === "p4_batching") {
    const base = internalCanonicalWriteProgram();
    const first = createTaskEffect({ semanticId: "effect.batch-a", expectedObservationRefs: ["observation.effect.batch-a"] });
    const second = createTaskEffect({ semanticId: "effect.batch-b", expectedObservationRefs: ["observation.effect.batch-b"] });
    const goalObservation = (semanticId: string) => ({
      kind: "observation" as const,
      semanticId,
      subject: { kind: "goal" as const, ref: base.goal.semanticId },
      description: "The batched task state is visible in canonical state.",
      strength: "REQUIRED" as const,
      verificationFloor: "EXISTING_OR_STRONGER" as const,
      evidence: { kind: "canonical_state" as const, entityRef: base.entities[0]!.semanticId, assertion: base.goal.predicate },
    });
    const program = reseal(base, (draft) => {
      draft.executionModel = "OBJECTIVE";
      draft.body = { kind: "sequence", semanticId: "sequence.batchable", steps: [first, second] };
      draft.observations = [goalObservation("observation.effect.batch-a"), goalObservation("observation.effect.batch-b")];
      draft.successCondition.criteria = draft.observations.map((observation) => ({ kind: "observation" as const, observationRef: observation.semanticId }));
      if (draft.budget) { draft.budget.maxSteps = 2; draft.budget.maxEffects = 2; }
    });
    const inferred = inferExecutableNodeEffects(first, program).declaration;
    assert(inferred, "batch_declaration_missing");
    const declaration = structuredClone(inferred);
    declaration.contract.reads.push(...structuredClone(declaration.contract.reads));
    declaration.contract.writes.push(...structuredClone(declaration.contract.writes));
    declaration.contract.observes = ["observation.effect.batch-a", "observation.effect.batch-b"];
    declaration.authorityRequirements.push(...structuredClone(declaration.authorityRequirements));
    const replacement = {
      ...structuredClone(first),
      semanticId: "effect.batch-create-task",
      arguments: { householdId: String(first.arguments.householdId), items: [first.arguments, second.arguments] },
      expectedObservationRefs: ["observation.effect.batch-a", "observation.effect.batch-b"],
      effectDeclaration: declaration,
    };
    const batchCapability = actionCapability("action:create_task", {
      batch: { compatibleOperation: "create_task", batchOperation: "batch_create_task", maxItems: 10, proofRef: "audit:batch-create-task:v1", replacementEffect: replacement },
    });
    const rewrite = generateGuardedRewrites(program, [batchCapability]).find((candidate) => candidate.rule.id === "batch_compatible_operations");
    assert(rewrite?.proofRefs.includes("audit:batch-create-task:v1"), id);
    return "AUDITED_BATCH_RULE";
  }
  if (id === "p4_compensation_path") {
    const complete = validCompensationProgram();
    assert(complete.body.kind === "sequence" && complete.body.steps[0]?.kind === "effect" && complete.body.steps[1]?.kind === "compensation", "compensation_fixture");
    const original = complete.body.steps[0];
    const compensation = complete.body.steps[1].effect;
    const { irSemanticHash: _hash, ...draft } = complete;
    const program = sealOperationalProgram({ ...draft, body: original });
    const recovery = actionCapability(compensation.requiredCapability, {
      compensation: { forOperation: original.operation, effect: compensation, proofRef: "audit:message-recovery:v1" },
    });
    const rewrite = generateGuardedRewrites(program, [recovery]).find((candidate) => candidate.rule.id === "introduce_legal_compensation_path");
    assert(rewrite?.safetyClass === "STRICTER_SAFE" && rewrite.proofRefs.includes("audit:message-recovery:v1"), id);
    const summary = composeOperationalProgramEffects(rewrite.program);
    const plan = derivePartialOrder(rewrite.program, summary);
    assert(summary.compensationLinks.length === 1 && plan.relations.some((relation) => relation.relation === "COMPENSATES"), id);
    return "GUARDED_COMPENSATION_REWRITE";
  }
  if (id === "p4_irreversible_action_preference") {
    const first = await searchOperationalPrograms(searchProblem({ programs: [
      { candidateId: "recoverable", origin: "PROCEDURE_TEMPLATE", originRef: "r", program: queryProgram("money_summary", { variant: "recoverable" }) },
      { candidateId: "irreversible", origin: "PROCEDURE_TEMPLATE", originRef: "i", program: queryProgram("work_list", { variant: "irreversible" }) },
    ], capabilities: [capability("money_summary", { latency: 10_000 }), capability("work_list", { latency: 1 })] }), { checkP2: checkP2Resolved });
    const recoverable = first.survivingCandidates.find((candidate) => candidate.candidateId === "recoverable")!;
    const irreversible = first.survivingCandidates.find((candidate) => candidate.candidateId === "irreversible")!;
    recoverable.effects = composeOperationalProgramEffects(internalCanonicalWriteProgram());
    irreversible.effects = composeOperationalProgramEffects(financialWriteProgram());
    assert(rankCandidates({ goal: first.selectedProgram!.goal, candidates: [irreversible, recoverable], softObjectives: [] })[0]?.candidateId === "recoverable", id);
    return "REVERSIBILITY_PRECEDES_COST";
  }
  if (id === "p4_latency_cost_tradeoff" || id === "p4_human_interruption_tradeoff") {
    const fast = queryProgram("money_summary", { variant: "fast" });
    const slow = queryProgram("work_list", { variant: "slow" });
    const fastOptions = id === "p4_latency_cost_tradeoff" ? { latency: 1, financial: 100 } : { latency: 1_000, interruptions: 0 };
    const slowOptions = id === "p4_latency_cost_tradeoff" ? { latency: 100, financial: 0 } : { latency: 1, interruptions: 1 };
    const result = await searchOperationalPrograms(searchProblem({ programs: [
      { candidateId: "fast", origin: "PROCEDURE_TEMPLATE", originRef: "fast", program: fast },
      { candidateId: "slow", origin: "PROCEDURE_TEMPLATE", originRef: "slow", program: slow },
    ], capabilities: [capability("money_summary", fastOptions), capability("work_list", slowOptions)] }), { checkP2: checkP2Resolved });
    assert(result.survivingCandidates[0]?.candidateId === "fast", id);
    return id === "p4_latency_cost_tradeoff" ? "LEXICOGRAPHIC_LATENCY_THEN_COST" : "FEWER_INTERRUPTS_FIRST";
  }
  if (id === "p4_solver_infeasibility" || id === "p4_cp_sat_assignment") {
    const assignment = id === "p4_solver_infeasibility"
      ? { variables: [{ id: "a", domain: [1] }, { id: "b", domain: [1] }], constraints: [{ kind: "ALL_DIFFERENT" as const, variables: ["a", "b"] }] }
      : { variables: [{ id: "a", domain: [0, 1] }, { id: "b", domain: [0, 1] }], constraints: [{ kind: "ALL_DIFFERENT" as const, variables: ["a", "b"] }], objective: { direction: "MINIMIZE" as const, terms: [{ variable: "a", coefficient: 1 }, { variable: "b", coefficient: 1 }] } };
    const result = solveCpSatConstraint({ id, kind: "CP_SAT", description: id, model: assignment, candidateFactPrefix: "x." }, {}, "locked-cp-v1", 100);
    assert(id === "p4_solver_infeasibility" ? result.status === "INFEASIBLE" : result.status === "OPTIMAL" && result.objectiveValue === 1, id);
    return id === "p4_solver_infeasibility" ? "CP_SAT_INFEASIBLE" : "CP_SAT_OPTIMAL";
  }
  if (id === "p4_smt_logical_constraint") {
    const context = smtContext();
    const sat = solveSmtConstraint({ id: "sat", kind: "SMT", description: "sat", expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "enabled", operator: "EQ", value: true } } }, context, "locked-smt-v1", 10);
    const unsat = solveSmtConstraint({ id: "unsat", kind: "SMT", description: "unsat", expression: { kind: "NOT", expression: { kind: "ATOM", atom: { kind: "FACT_COMPARE", fact: "enabled", operator: "EQ", value: true } } } }, context, "locked-smt-v1", 10);
    assert(sat.status === "SAT" && unsat.status === "UNSAT", id);
    return "SMT_SAT_UNSAT";
  }
  if (id === "p4_rewrite_loop_prevention") {
    const parent = sequenceProgram();
    const first = generateGuardedRewrites(parent, []);
    const hashes = new Set(first.map((rewrite) => rewrite.program.irSemanticHash));
    assert(!hashes.has(parent.irSemanticHash) && hashes.size === first.length, id);
    return "SEEN_HASH_DEDUP";
  }
  if (id === "p4_search_budget_exhaustion") {
    const programs = Array.from({ length: 3 }, (_, index) => ({ candidateId: `c${index}`, origin: "MODEL_CANDIDATE" as const, originRef: `c${index}`, program: queryProgram(index % 2 ? "work_list" : "money_summary", { variant: `budget-${index}` }) }));
    const result = await searchOperationalPrograms(searchProblem({ programs, capabilities: [capability("money_summary"), capability("work_list")], searchBounds: { maxInitialCandidates: 3, maxRewriteIterations: 1, maxSearchNodes: 1, maxSolverTimeMs: 20, maxTotalSearchMs: 100, maxMemoryBytes: 1_000_000 } }), { checkP2: checkP2Resolved });
    assert(result.status === "BOUNDED_INCOMPLETE" && result.searchStats.searchNodesVisited <= 1, id);
    return "BOUNDED_INCOMPLETE";
  }
  if (id === "p4_unknown_cost") {
    const result = await searchOperationalPrograms(searchProblem({ capabilities: [capability("money_summary", { financial: null })] }), { checkP2: checkP2Resolved });
    const cost = result.survivingCandidates[0]!.costEstimate.financialSpend;
    assert(cost.value === null && effectiveEstimate(cost) > 0, id);
    return "EXPLICIT_NONZERO_FALLBACK";
  }
  if (id === "p4_p2_rejection") {
    const program = piiResearchExportProgram(false);
    const result = await searchOperationalPrograms(searchProblem({ programs: [{ candidateId: "p2-reject", origin: "MODEL_CANDIDATE", originRef: "p2", program }], capabilities: [actionCapability("action:send_message")] }), { checkP2: (candidate) => checkOperationalProgramAdmissibility(candidate, { resolution: staticResolutionContext() }) });
    assert(result.selectedProgram === null && result.rejectedCandidates[0]?.rejection?.reasonCode === "P2_REJECTED", id);
    return "P2_REJECTED_NOT_SELECTED";
  }
  if (id === "p4_p2_unresolved") {
    const result = await searchOperationalPrograms(searchProblem(), {});
    assert(result.selectedProgram === null && result.rejectedCandidates[0]?.rejection?.reasonCode === "P2_UNRESOLVED", id);
    return "P2_UNRESOLVED_NOT_SELECTED";
  }
  if (id === "p4_p3_unresolved") {
    const state = emptyEpistemicState(["mandatory"]);
    const result = await searchOperationalPrograms(searchProblem({ epistemicState: state, epistemicRequirements: [unresolvedRequirement("mandatory")] }), { checkP2: checkP2Resolved });
    assert(result.status === "P3_UNRESOLVED" && result.searchStats.searchNodesVisited === 0, id);
    return "P3_HANDOFF";
  }
  if (id === "p4_deterministic_tie_breaking") {
    const result = await searchOperationalPrograms(searchProblem({ programs: [
      { candidateId: "b", origin: "PROCEDURE_TEMPLATE", originRef: "b", program: queryProgram("work_list", { variant: "tie-b" }) },
      { candidateId: "a", origin: "PROCEDURE_TEMPLATE", originRef: "a", program: queryProgram("money_summary", { variant: "tie-a" }) },
    ], capabilities: [capability("work_list"), capability("money_summary")] }), { checkP2: checkP2Resolved });
    const minimum = [...result.survivingCandidates].map((candidate) => candidate.programHash).sort()[0];
    assert(result.selectedProgramHash === minimum && result.extractionScore?.tieBreak === minimum, id);
    return "PROGRAM_HASH_TIE_BREAK";
  }
  if (id === "p4_unsupported_lowering") {
    const program = multiQueryUnsupported();
    const effects = composeOperationalProgramEffects(program);
    const result = await searchOperationalPrograms(searchProblem({ programs: [{ candidateId: "unsupported", origin: "PROCEDURE_TEMPLATE", originRef: "unsupported", program }], capabilities: [capability("money_summary")] }), {
      checkP2: async () => ({ status: "ADMISSIBLE", reasonCodes: [], issues: [], informationFlows: [], summary: effects }),
      lower: lowerOperationalProgram,
    });
    assert(result.status === "UNSUPPORTED" && result.rejectedCandidates[0]?.rejection?.reasonCode === "UNSUPPORTED_RUNTIME_LOWERING", id);
    return "UNSUPPORTED_NOT_EXECUTED";
  }
  throw new Error(`P4_LOCKED_CASE_UNIMPLEMENTED:${id}`);
}

export async function runP4LockedCorpus(): Promise<P4LockedCaseResult[]> {
  assert(P4_LOCKED_CASES.length === 26, "CORPUS_COUNT");
  assert(new Set(P4_LOCKED_CASES.map((entry) => entry.id)).size === P4_LOCKED_CASES.length, "CORPUS_DUPLICATE_ID");
  assert(rewriteInventory().length === 9, "REWRITE_INVENTORY");
  const results: P4LockedCaseResult[] = [];
  for (const fixture of P4_LOCKED_CASES) {
    const actual = await runCase(fixture.id);
    assert(actual === fixture.evidence, `${fixture.id}:EXPECTED_${fixture.evidence}:ACTUAL_${actual}`);
    results.push({ ...fixture, passed: true, actual });
  }
  return results;
}
