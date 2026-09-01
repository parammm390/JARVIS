import { analyzeProgramGraph, type Observation, type OperationalProgram, type Predicate } from "@finnor/operational-ir";
import type {
  BranchFailureMode,
  BranchOutcome,
  PredictedObservation,
  RecoveryPathStep,
  SpeculativeEstimateInput,
  WorldVariable,
} from "./contracts";
import { evaluatePredicateState, resolvedWorldRef, type PredicateRuntimeState } from "./predicates";

function observationPredicate(observation: Observation): Predicate | null {
  return observation.evidence.kind === "canonical_query" || observation.evidence.kind === "canonical_state"
    ? observation.evidence.assertion
    : null;
}

function overlayTouchesObservation(observation: Observation, state: PredicateRuntimeState): boolean {
  const predicate = observationPredicate(observation);
  if (!predicate || predicate.kind !== "assertion" || predicate.subject.kind !== "entity" || !predicate.subject.ref) return false;
  const ref = resolvedWorldRef(state, predicate.subject.ref);
  return Boolean(ref && state.effects.some((effect) => effect.changes.some((change) =>
    change.target.kind === ref.kind && change.target.type === ref.type && change.target.id === ref.id)));
}

type MatchedEventObservation = Observation & { evidence: Extract<Observation["evidence"], { kind: "matched_event" }> };

function matchedWaitPredicted(observation: MatchedEventObservation, state: PredicateRuntimeState): boolean {
  const expectedRefs = observation.evidence.subjectRefs.map((semanticRef) => resolvedWorldRef(state, semanticRef));
  if (expectedRefs.some((ref) => ref === null)) return false;
  const graph = analyzeProgramGraph(state.program.body);
  return state.variables.some((variable) => {
    if (variable.binding.kind !== "WAIT_EVENT") return false;
    const assumption = state.assumptions.find((candidate) => candidate.variableId === variable.id);
    if (assumption?.operationalStatus !== "SUCCESS") return false;
    const node = graph.nodes.get(variable.binding.waitRef)?.node;
    if (node?.kind !== "wait" || !node.event || node.event.eventType !== observation.evidence.eventType) return false;
    const waitRefs = new Set(node.event.refs.map((ref) => `${ref.type}:${ref.id}`));
    return expectedRefs.every((ref) => ref !== null && waitRefs.has(`${ref.type}:${ref.id}`));
  });
}

export function evaluatePredictedObservation(observation: Observation, state: PredicateRuntimeState): PredictedObservation {
  const predicate = observationPredicate(observation);
  if (predicate) {
    const evaluated = evaluatePredicateState(predicate, state);
    const evidenceClass = observation.evidence.kind === "canonical_query" ? "CANONICAL_SNAPSHOT"
      : overlayTouchesObservation(observation, state) ? "HYPOTHETICAL_OVERLAY"
        : "CANONICAL_SNAPSHOT";
    return {
      observationRef: observation.semanticId,
      status: evaluated.state === "TRUE" ? "SATISFIED" : evaluated.state === "FALSE" ? "FAILED" : "UNKNOWN",
      evidenceClass,
      verification: evaluated.state === "TRUE" ? "PREDICTED_ONLY" : "UNKNOWN",
      strength: observation.strength,
      reasonCodes: evaluated.state === "TRUE"
        ? [...evaluated.reasonCodes, "SPECULATIVE_OBSERVATION_NOT_REAL_VERIFICATION"]
        : evaluated.reasonCodes,
    };
  }
  if (observation.evidence.kind === "effect_verification") {
    const effectRef = observation.evidence.effectRef;
    const predicted = state.effects.some((effect) => effect.planningEffect.semanticId === effectRef);
    return {
      observationRef: observation.semanticId,
      status: "UNKNOWN",
      evidenceClass: predicted ? "PREDICTED_EXTERNAL" : "MISSING",
      verification: "UNKNOWN",
      strength: observation.strength,
      reasonCodes: [predicted ? "REAL_EFFECT_VERIFICATION_UNAVAILABLE_IN_SPECULATION" : "PREDICTED_EFFECT_MISSING"],
    };
  }
  if (observation.evidence.kind === "objective_success") {
    return {
      observationRef: observation.semanticId,
      status: "UNKNOWN",
      evidenceClass: "MISSING",
      verification: "UNKNOWN",
      strength: observation.strength,
      reasonCodes: ["EXISTING_OBJECTIVE_VERIFICATION_REMAINS_AUTHORITATIVE"],
    };
  }
  if (observation.evidence.kind === "matched_event") {
    const matched = matchedWaitPredicted(observation as MatchedEventObservation, state);
    return {
      observationRef: observation.semanticId,
      status: matched ? "SATISFIED" : "UNKNOWN",
      evidenceClass: matched ? "PREDICTED_EXTERNAL" : "MISSING",
      verification: matched ? "PREDICTED_ONLY" : "UNKNOWN",
      strength: observation.strength,
      reasonCodes: [matched ? "EVENT_MATCH_PREDICTED_ONLY" : "REAL_EVENT_NOT_OBSERVED"],
    };
  }
  const effectRef = "effectRef" in observation.evidence ? observation.evidence.effectRef : null;
  const effect = effectRef ? [...state.effects].reverse().find((candidate) => candidate.planningEffect.semanticId === effectRef) : null;
  const satisfied = effect?.outcome === "SUCCESS";
  return {
    observationRef: observation.semanticId,
    status: satisfied ? "SATISFIED" : effect ? "UNKNOWN" : "UNKNOWN",
    evidenceClass: effect ? "PREDICTED_EXTERNAL" : "MISSING",
    verification: satisfied ? "PREDICTED_ONLY" : "UNKNOWN",
    strength: observation.strength,
    reasonCodes: [satisfied ? "RUNTIME_EVIDENCE_PREDICTED_ONLY" : "AUTHORITATIVE_RUNTIME_EVIDENCE_UNAVAILABLE"],
  };
}

function combineCriteria(states: Array<"TRUE" | "FALSE" | "UNKNOWN">): "TRUE" | "FALSE" | "UNKNOWN" {
  if (states.some((state) => state === "FALSE")) return "FALSE";
  if (states.every((state) => state === "TRUE")) return "TRUE";
  return "UNKNOWN";
}

function irreversibility(state: PredicateRuntimeState): BranchOutcome["irreversibility"] {
  if (state.effects.length === 0) return "READ_ONLY";
  const rank: Record<BranchOutcome["irreversibility"], number> = { READ_ONLY: 0, REVERSIBLE: 1, COMPENSATABLE: 2, IRREVERSIBLE: 3, UNKNOWN: 4 };
  return state.effects.map((effect) => effect.reversibility).sort((left, right) => rank[right] - rank[left])[0] ?? "READ_ONLY";
}

function recoveryBurden(recovery: readonly RecoveryPathStep[]): BranchOutcome["recoveryBurden"] {
  if (recovery.length === 0) return "NONE";
  if (recovery.some((step) => step.kind === "MANUAL" || step.status === "PREDICTED_FAILURE")) return "HIGH";
  if (recovery.some((step) => step.kind === "RECONCILIATION" || step.status === "UNKNOWN")) return "MEDIUM";
  return "LOW";
}

function estimates(input: {
  program: OperationalProgram;
  state: PredicateRuntimeState;
  configured?: SpeculativeEstimateInput;
}): Pick<BranchOutcome, "latencyEstimate" | "costEstimate"> {
  const effectCapabilities = input.state.effects.map((effect) => {
    const graph = input.program.body;
    const find = (node: typeof graph): string | null => {
      if (node.kind === "effect") return node.semanticId === effect.planningEffect.semanticId ? node.requiredCapability : null;
      if (node.kind === "sequence") return node.steps.map(find).find(Boolean) ?? null;
      if (node.kind === "parallel") return node.branches.map(find).find(Boolean) ?? null;
      if (node.kind === "branch") return [...node.cases.map((branchCase) => find(branchCase.then)), ...(node.otherwise ? [find(node.otherwise)] : [])].find(Boolean) ?? null;
      if (node.kind === "compensation") return node.effect.semanticId === effect.planningEffect.semanticId ? node.effect.requiredCapability : null;
      return null;
    };
    return find(graph);
  }).filter((capability): capability is string => Boolean(capability));
  const latencyRows = effectCapabilities.map((capability) => input.configured?.latencyByCapability?.[capability]);
  const costRows = effectCapabilities.map((capability) => input.configured?.costByCapability?.[capability]);
  const latencyKnown = latencyRows.length > 0 && latencyRows.every(Boolean);
  const costKnown = costRows.length > 0 && costRows.every(Boolean) && new Set(costRows.map((row) => row?.currency)).size === 1;
  return {
    latencyEstimate: latencyKnown ? {
      valueMs: latencyRows.reduce((sum, row) => sum + row!.valueMs, 0),
      quality: latencyRows.every((row) => row!.quality === "EMPIRICAL") ? "EMPIRICAL" : "CONFIGURED",
      sourceRef: [...new Set(latencyRows.map((row) => row!.sourceRef))].sort().join("+") || null,
    } : { valueMs: null, quality: "UNKNOWN", sourceRef: null },
    costEstimate: costKnown ? {
      amount: costRows.reduce((sum, row) => sum + row!.amount, 0),
      currency: costRows[0]!.currency,
      quality: costRows.every((row) => row!.quality === "EMPIRICAL") ? "EMPIRICAL" : "CONFIGURED",
      sourceRef: [...new Set(costRows.map((row) => row!.sourceRef))].sort().join("+") || null,
    } : { amount: null, currency: null, quality: "UNKNOWN", sourceRef: null },
  };
}

export function evaluateBranch(input: {
  state: PredicateRuntimeState;
  failures: BranchFailureMode[];
  recovery: RecoveryPathStep[];
  estimates?: SpeculativeEstimateInput;
}): { observations: PredictedObservation[]; outcome: BranchOutcome } {
  const observations = input.state.program.observations.map((observation) => evaluatePredictedObservation(observation, input.state));
  const state = { ...input.state, observations };
  const goal = evaluatePredicateState(input.state.program.goal.predicate, state);
  const hardStates = input.state.program.constraints.filter((constraint) => constraint.severity === "HARD").map((constraint) =>
    constraint.evaluation === "VIOLATED" ? "FALSE" as const
      : constraint.evaluation === "SATISFIED" ? "TRUE" as const
        : evaluatePredicateState(constraint.predicate, state).state);
  const hard = combineCriteria(hardStates);
  const criteria = input.state.program.successCondition.criteria.map((criterion): "TRUE" | "FALSE" | "UNKNOWN" => {
    if (criterion.kind === "predicate") return evaluatePredicateState(criterion.predicate, state).state;
    if (criterion.kind === "observation") {
      const observation = observations.find((candidate) => candidate.observationRef === criterion.observationRef);
      return observation?.status === "SATISFIED" ? "TRUE" : observation?.status === "FAILED" ? "FALSE" : "UNKNOWN";
    }
    return "UNKNOWN";
  });
  const success = combineCriteria(criteria);
  const activeFailures = input.failures.filter((candidate) => candidate.residualRisk !== "NONE");
  const partialEffect = state.effects.some((effect) => effect.outcome === "PARTIAL");
  const appliedBeforeFailure = state.effects.some((effect) => effect.changes.length > 0) && activeFailures.length > 0;
  const ambiguous = state.assumptions.some((assumption) => assumption.operationalStatus === "AMBIGUOUS" || assumption.operationalStatus === "UNKNOWN");
  const unresolvedFailure = activeFailures.some((failure) => [
    "AMBIGUOUS_EXTERNAL_RESULT",
    "UNKNOWN_EXTERNAL_OUTCOME",
    "TIMEOUT_UNKNOWN_DELIVERY",
    "PRECONDITION_UNKNOWN",
    "WAIT_CONDITION_UNKNOWN",
    "WAIT_OUTCOME_UNKNOWN",
    "BRANCH_CONDITION_UNKNOWN",
  ].includes(failure.code));
  const outcome: BranchOutcome["outcome"] = hard === "FALSE" || success === "FALSE" || (activeFailures.length > 0 && !partialEffect && !appliedBeforeFailure && !unresolvedFailure)
    ? "PREDICTED_FAILURE"
    : partialEffect || appliedBeforeFailure ? "PREDICTED_PARTIAL"
      : success === "TRUE" && hard !== "UNKNOWN" && !ambiguous ? "PREDICTED_SUCCESS"
        : "UNKNOWN";
  const goalSatisfaction: BranchOutcome["goalSatisfaction"] = goal.state === "TRUE"
    ? { status: success === "TRUE" ? "SATISFIED" : "PARTIAL", ordinal: success === "TRUE" ? 1000 : 750, reasonCodes: goal.reasonCodes }
    : goal.state === "FALSE" ? { status: "UNSATISFIED", ordinal: 0, reasonCodes: goal.reasonCodes }
      : { status: state.effects.length > 0 ? "PARTIAL" : "UNKNOWN", ordinal: state.effects.length > 0 ? 500 : 250, reasonCodes: goal.reasonCodes };
  const verificationStrength: BranchOutcome["verificationStrength"] = observations.length === 0 || observations.some((observation) => observation.status === "UNKNOWN")
    ? "UNKNOWN"
    : observations.some((observation) => observation.status === "FAILED") ? "WEAK_PREDICTED"
      : observations.every((observation) => observation.evidenceClass === "CANONICAL_SNAPSHOT") ? "CANONICAL_PREDICTED"
        : "HYPOTHETICAL_PREDICTED";
  const uncertaintyRemaining = state.variables.filter((variable) => {
    const assumption = state.assumptions.find((candidate) => candidate.variableId === variable.id);
    return !assumption || assumption.operationalStatus === "AMBIGUOUS" || assumption.operationalStatus === "UNKNOWN";
  }).map((variable) => variable.id).sort();
  const irreversible = irreversibility(state);
  const residualDamage = [
    ...(partialEffect ? ["PARTIAL_EFFECT_MAY_REQUIRE_RECONCILIATION"] : []),
    ...(irreversible === "IRREVERSIBLE" && activeFailures.length > 0 ? ["IRREVERSIBLE_EFFECT_RESIDUAL_RISK"] : []),
    ...(activeFailures.some((failure) => failure.residualRisk === "HIGH" || failure.residualRisk === "UNKNOWN") ? ["HIGH_OR_UNKNOWN_RESIDUAL_RISK"] : []),
  ];
  const estimate = estimates({ program: state.program, state, configured: input.estimates });
  return {
    observations,
    outcome: {
      outcome,
      goalSatisfaction,
      hardConstraintStatus: hard === "TRUE" ? "SATISFIED" : hard === "FALSE" ? "VIOLATED" : "UNKNOWN",
      effects: state.effects.map((effect) => ({
        hypotheticalEffectId: effect.hypotheticalEffectId,
        planningEffectRef: effect.planningEffect.semanticId,
        adapterClass: effect.adapterClass,
        outcome: effect.outcome,
      })),
      observations,
      verificationStrength,
      failureModes: [...input.failures],
      recoveryPath: [...input.recovery],
      recoveryBurden: recoveryBurden(input.recovery),
      irreversibility: irreversible,
      humanInterruption: { upperBound: input.recovery.filter((step) => step.kind === "MANUAL").length, basis: "STRUCTURAL" },
      ...estimate,
      uncertaintyRemaining,
      residualDamage,
    },
  };
}
