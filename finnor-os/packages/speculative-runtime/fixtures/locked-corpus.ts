import casesJson from "./locked-cases.json";
import {
  inferExecutableNodeEffects,
  lowerOperationalProgram,
  sealOperationalProgram,
  type OperationalProgram,
  type Predicate,
} from "@finnor/operational-ir";
import {
  financialWriteProgram,
  internalCanonicalWriteProgram,
  parallelConflictingWritesProgram,
  validCompensationProgram,
} from "../../operational-ir/fixtures/p2-programs";
import {
  HOUSEHOLD_REF,
  effectObservation,
  parallelProgram,
  queryProgram,
  reseal,
  sequenceProgram,
} from "../../operational-ir/fixtures/programs";
import {
  ZERO_REAL_SIDE_EFFECTS,
  expandWorldBranches,
  forkWorld,
  simulationToCausalReplayNodes,
  simulateOperationalProgram,
  type SimulateOperationalProgramInput,
  type WorldVariable,
  type WorldVariableOutcome,
} from "../src/index";
import {
  P5_TEST_NOW,
  P5_TEST_TENANT,
  effectWorldVariable,
  outcome,
  simulationInput,
  snapshotForProgram,
} from "../src/test-support";

export interface P5LockedCase {
  id: string;
  category: string;
  evidence: string;
}

export interface P5LockedCaseResult extends P5LockedCase {
  passed: true;
  actual: string;
}

export const P5_LOCKED_CASES = casesJson as P5LockedCase[];

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`P5_LOCKED_CASE_FAILED:${code}`);
}

function predicateVariable(input: {
  id: string;
  subjectRef: string;
  path: Array<string | number>;
  outcomes?: WorldVariableOutcome[];
  tenantId?: string;
}): WorldVariable {
  const propositionId = `p3:${input.id}`;
  return {
    id: input.id,
    tenantId: input.tenantId ?? P5_TEST_TENANT,
    sourcePropositionId: propositionId,
    binding: { kind: "PREDICATE", subjectRef: input.subjectRef, path: input.path },
    possibleOutcomes: input.outcomes ?? [
      outcome("false", "SUCCESS", { value: false, risk: "LOW" }),
      outcome("true", "SUCCESS", { value: true, risk: "LOW" }),
    ],
    evidence: [propositionId],
    confidenceQuality: "LOW",
    provenance: { owner: "P3", propositionId, evidenceRefs: [propositionId], asOf: P5_TEST_NOW },
  };
}

async function simulate(input: {
  program: OperationalProgram;
  variables?: WorldVariable[];
  observations?: Parameters<typeof snapshotForProgram>[0]["observations"];
  bounds?: Parameters<typeof simulationInput>[0]["bounds"];
  stateOverrides?: Parameters<typeof snapshotForProgram>[0]["stateOverrides"];
}) {
  const snapshot = await snapshotForProgram({
    program: input.program,
    variables: input.variables,
    observations: input.observations,
    stateOverrides: input.stateOverrides,
  });
  return {
    snapshot,
    result: await simulateOperationalProgram(simulationInput({
      program: input.program,
      snapshot,
      variables: input.variables,
      bounds: input.bounds,
    })),
  };
}

function exactQueryObservation(program: OperationalProgram) {
  assert(program.body.kind === "query", "query-fixture");
  return {
    id: program.body.semanticId,
    tenantId: P5_TEST_TENANT,
    subject: { kind: "query" as const, ref: program.body.semanticId },
    state: "OBSERVED" as const,
    value: { status: "ok", result: { customer: "bounded-fixture" } },
    observedAt: P5_TEST_NOW,
    evidenceRefs: ["fixture:canonical-query"],
    provenance: { owner: "fixture:query-plane", sourceRef: "fixture:canonical-query" },
  };
}

function conflictingParallelProgram(): OperationalProgram {
  return reseal(parallelConflictingWritesProgram(), (draft) => {
    if (draft.body.kind !== "parallel" || draft.body.branches[1]?.kind !== "effect") throw new Error("fixture drift");
    const predicate = draft.body.branches[1].intendedState;
    if (predicate.kind !== "assertion") throw new Error("fixture drift");
    predicate.expected = false;
  });
}

function stalePreconditionProgram(): OperationalProgram {
  const base = internalCanonicalWriteProgram();
  if (base.body.kind !== "effect") throw new Error("fixture drift");
  const inferred = inferExecutableNodeEffects(base.body, base);
  if (!inferred.declaration) throw new Error("fixture declaration unavailable");
  const declaration = structuredClone(inferred.declaration);
  declaration.source = "IR_DECLARED";
  declaration.contract.requires.push({
    kind: "assertion",
    subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId },
    path: ["status"],
    operator: "eq",
    expected: "closed",
  });
  return reseal(base, (draft) => {
    if (draft.body.kind !== "effect") throw new Error("fixture drift");
    draft.semanticId = "program.p5-stale-precondition";
    draft.body.effectDeclaration = declaration;
  });
}

function canonicalObservationProgram(expected: boolean): OperationalProgram {
  return reseal(internalCanonicalWriteProgram(), (draft) => {
    if (draft.body.kind !== "effect") throw new Error("fixture drift");
    const assertion: Predicate = {
      kind: "assertion",
      subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId },
      path: ["tasks", "confirmationFollowup", "exists"],
      operator: "eq",
      expected,
    };
    draft.observations = [{
      kind: "observation",
      semanticId: "observation.p5-canonical-state",
      subject: { kind: "goal", ref: draft.goal.semanticId },
      description: "The bounded canonical state plus branch overlay predicts the requested state.",
      strength: "REQUIRED",
      verificationFloor: "EXISTING_OR_STRONGER",
      evidence: { kind: "canonical_state", entityRef: HOUSEHOLD_REF.semanticId, assertion },
    }];
    draft.body.expectedObservationRefs = ["observation.p5-canonical-state"];
    draft.successCondition.criteria = [{ kind: "observation", observationRef: "observation.p5-canonical-state" }];
  });
}

function nestedBranchProgram(): OperationalProgram {
  const base = canonicalObservationProgram(true);
  if (base.body.kind !== "effect") throw new Error("fixture drift");
  const first = structuredClone(base.body);
  const second = { ...structuredClone(base.body), semanticId: "effect.p5-nested-second", expectedObservationRefs: ["observation.p5-canonical-state"] };
  const third = { ...structuredClone(base.body), semanticId: "effect.p5-nested-third", expectedObservationRefs: ["observation.p5-canonical-state"] };
  const outerPredicate: Predicate = { kind: "assertion", subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId }, path: ["routing", "outer"], operator: "eq", expected: true };
  const innerPredicate: Predicate = { kind: "assertion", subject: { kind: "entity", ref: HOUSEHOLD_REF.semanticId }, path: ["routing", "inner"], operator: "eq", expected: true };
  return reseal(base, (draft) => {
    draft.semanticId = "program.p5-nested-branches";
    draft.executionModel = "OBJECTIVE";
    draft.body = {
      kind: "branch",
      semanticId: "branch.p5-outer",
      evaluation: "FIRST_MATCH",
      cases: [{
        caseId: "outer-true",
        when: outerPredicate,
        then: {
          kind: "branch",
          semanticId: "branch.p5-inner",
          evaluation: "FIRST_MATCH",
          cases: [{ caseId: "inner-true", when: innerPredicate, then: first }],
          otherwise: second,
        },
      }],
      otherwise: third,
    };
    if (draft.budget) {
      draft.budget.maxSteps = 5;
      draft.budget.maxEffects = 3;
    }
  });
}

function unsupportedMultiQuery(): OperationalProgram {
  const base = queryProgram();
  const { irSemanticHash: _hash, ...draft } = base;
  return sealOperationalProgram({
    ...draft,
    executionModel: "OBJECTIVE",
    body: { kind: "sequence", semanticId: "sequence.p5-unsupported-lowering", steps: [base.body, { ...base.body, semanticId: "query.p5-second" }] },
    budget: { ...base.budget!, maxSteps: 2, maxQueries: 2 },
  });
}

async function runCase(id: string): Promise<string> {
  if (id === "p5_simple_read_only_world") {
    const program = queryProgram();
    const { result } = await simulate({ program, observations: [exactQueryObservation(program)] });
    assert(result.status === "COMPLETE" && result.branches[0]?.outcome?.outcome === "PREDICTED_SUCCESS", id);
    assert(result.branches[0]?.effectOverlay.length === 0 && result.sideEffects.realDbMutations === 0, id);
    return "PREDICTED_CANONICAL_READ";
  }
  if (id === "p5_one_canonical_write") {
    const { result } = await simulate({ program: internalCanonicalWriteProgram() });
    const effect = result.branches[0]?.effectOverlay[0];
    assert(effect?.adapterClass === "CANONICAL_WRITE" && effect.authoritative === false && effect.realBusinessEffectId === null && effect.changes.length === 1, id);
    return "HYPOTHETICAL_OVERLAY_ONLY";
  }
  if (id === "p5_sequential_effects" || id === "p5_parallel_independent_effects") {
    const program = id === "p5_sequential_effects" ? sequenceProgram() : parallelProgram();
    const graph = program.body;
    assert(graph.kind === (id === "p5_sequential_effects" ? "sequence" : "parallel"), "sequence-parallel-fixture");
    const first = graph.kind === "sequence" ? graph.steps[0] : graph.branches[0];
    assert(first?.kind === "effect", "sequence-parallel-first-effect");
    const variable = effectWorldVariable({ effectRef: first.semanticId, outcomes: [outcome("success", "SUCCESS")] });
    const { result } = await simulate({ program, variables: [variable] });
    assert(result.status === "COMPLETE" && result.branches[0]?.effectOverlay.length === 2, id);
    if (id === "p5_parallel_independent_effects") assert(result.branches[0]?.branchTrace.some((entry) => entry.kind === "PARALLEL_MERGED" && entry.status === "MERGED"), id);
    return id === "p5_sequential_effects" ? "ORDERED_EFFECT_OVERLAYS" : "PARALLEL_OVERLAYS_MERGED";
  }
  if (id === "p5_conflicting_parallel_effects") {
    const { result } = await simulate({ program: conflictingParallelProgram() });
    assert(result.branches[0]?.failureModes.some((failure) => failure.code === "PARALLEL_WRITE_CONFLICT") && result.branches[0]?.effectOverlay.length === 2, id);
    return "PARALLEL_CONFLICT_EXPOSED";
  }
  if (id === "p5_branch_success_failure") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("failure", "FAILURE"), outcome("success", "SUCCESS")] });
    const { result } = await simulate({ program, variables: [variable] });
    const statuses = new Set(result.branchOutcomes.map((branch) => branch.outcome));
    assert(statuses.has("PREDICTED_FAILURE") && statuses.has("UNKNOWN"), id);
    return "SUCCESS_AND_FAILURE_BRANCHES";
  }
  if (id === "p5_uncertain_provider_outcome") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("ambiguous", "AMBIGUOUS"), outcome("failure", "FAILURE"), outcome("success", "SUCCESS")] });
    const { result } = await simulate({ program, variables: [variable] });
    assert(result.stats.requiredBranches === 3 && result.stats.simulatedBranches === 3 && result.branches.every((branch) => branch.assumptions.length === 1), id);
    return "P3_ALTERNATIVES_EXPANDED";
  }
  if (id === "p5_partial_execution") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("partial", "PARTIAL")] });
    const { result } = await simulate({ program, variables: [variable] });
    const branch = result.branches[0];
    assert(branch?.outcome?.outcome === "PREDICTED_PARTIAL" && branch.effectOverlay[0]?.changes.length === 0, id);
    return "PARTIAL_WITHOUT_STATE_OVERCLAIM";
  }
  if (id === "p5_ambiguous_external_result" || id === "p5_reconciliation") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("ambiguous", "AMBIGUOUS")] });
    const { result } = await simulate({ program, variables: [variable] });
    const branch = result.branches[0];
    assert(branch?.outcome?.outcome === "UNKNOWN" && branch.recoveryPath.some((step) => step.kind === "RECONCILIATION" && step.status === "REQUIRED"), id);
    return id === "p5_ambiguous_external_result" ? "AMBIGUOUS_REMAINS_UNKNOWN" : "RECONCILIATION_REQUIRED";
  }
  if (id === "p5_retry") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [
      outcome("retry", "RETRYABLE_FAILURE", { recovery: { kind: "RETRY", nextOutcomeId: "success", reasonCode: "retry-once" } }),
      outcome("success", "SUCCESS"),
    ] });
    const { result } = await simulate({ program, variables: [variable] });
    const retryBranch = result.branches.find((branch) => branch.assumptions[0]?.outcomeId === "retry");
    assert(retryBranch?.recoveryPath.some((step) => step.kind === "RETRY" && step.status === "PREDICTED_SUCCESS")
      && retryBranch.effectOverlay.length === 2
      && retryBranch.failureModes.some((failure) => failure.code === "RETRYABLE_FAILURE" && failure.residualRisk === "NONE"), id);
    return "BOUNDED_RETRY_PATH";
  }
  if (id === "p5_compensation") {
    const program = validCompensationProgram();
    assert(program.body.kind === "sequence" && program.body.steps[0]?.kind === "effect", "compensation-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.steps[0].semanticId, outcomes: [outcome("failure", "FAILURE")] });
    const { result } = await simulate({ program, variables: [variable] });
    assert(result.branches[0]?.recoveryPath.some((step) => step.kind === "COMPENSATION" && step.status === "PREDICTED_SUCCESS"), id);
    return "COMPENSATION_PREDICTED";
  }
  if (id === "p5_irreversible_action") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("success", "SUCCESS")] });
    const { result } = await simulate({ program, variables: [variable] });
    assert(result.branches[0]?.outcome?.irreversibility === "IRREVERSIBLE", id);
    return "IRREVERSIBILITY_EXPLICIT";
  }
  if (id === "p5_stale_precondition") {
    const { result } = await simulate({ program: stalePreconditionProgram() });
    const branch = result.branches[0];
    assert(branch?.failureModes.some((failure) => failure.code === "STALE_PRECONDITION") && branch.effectOverlay.length === 0, id);
    return "STALE_BLOCKED_BEFORE_EFFECT";
  }
  if (id === "p5_observation_failure") {
    const { result } = await simulate({ program: canonicalObservationProgram(false) });
    assert(result.branches[0]?.simulatedObservations[0]?.status === "FAILED" && result.branches[0]?.outcome?.outcome === "PREDICTED_FAILURE", id);
    return "PREDICTED_FAILURE";
  }
  if (id === "p5_predicted_success_verification_unknown") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, outcomes: [outcome("success", "SUCCESS")] });
    const { result } = await simulate({ program, variables: [variable] });
    const branch = result.branches[0];
    assert(branch?.effectOverlay[0]?.outcome === "SUCCESS" && branch.simulatedObservations.every((observation) => observation.verification === "UNKNOWN") && branch.outcome?.outcome === "UNKNOWN", id);
    return "NO_FALSE_VERIFICATION";
  }
  if (id === "p5_multiple_world_forks") {
    const program = internalCanonicalWriteProgram();
    const variable = predicateVariable({ id: "world-variable:fork-route", subjectRef: HOUSEHOLD_REF.semanticId, path: ["route"] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const parent = forkWorld({ snapshot, variables: [variable] });
    const before = structuredClone(parent);
    const branches = variable.possibleOutcomes.map((candidate) => forkWorld({
      snapshot,
      parent,
      assumptions: [{
        variableId: variable.id,
        outcomeId: candidate.outcomeId,
        value: candidate.value,
        operationalStatus: candidate.operationalStatus,
        risk: candidate.risk,
        recovery: candidate.recovery ?? null,
      }],
    }));
    assert(new Set(branches.map((branch) => branch.branchId)).size === 2 && branches.every((branch) => branch.parentBranchId === parent.branchId) && JSON.stringify(parent) === JSON.stringify(before), id);
    return "PARENT_UNMUTATED";
  }
  if (id === "p5_nested_branches") {
    const program = nestedBranchProgram();
    const variables = [
      predicateVariable({ id: "world-variable:outer", subjectRef: HOUSEHOLD_REF.semanticId, path: ["routing", "outer"] }),
      predicateVariable({ id: "world-variable:inner", subjectRef: HOUSEHOLD_REF.semanticId, path: ["routing", "inner"] }),
    ];
    const { result } = await simulate({ program, variables });
    assert(result.status === "COMPLETE" && result.branches.length === 4 && result.stats.maxDepthObserved >= 2, id);
    return "NESTED_BRANCHES_BOUNDED";
  }
  if (id === "p5_branch_budget_exhaustion") {
    const program = internalCanonicalWriteProgram();
    const outcomes = [outcome("a", "SUCCESS"), outcome("b", "FAILURE"), outcome("c", "AMBIGUOUS")];
    const variables = [
      predicateVariable({ id: "world-variable:budget-a", subjectRef: HOUSEHOLD_REF.semanticId, path: ["budget", "a"], outcomes }),
      predicateVariable({ id: "world-variable:budget-b", subjectRef: HOUSEHOLD_REF.semanticId, path: ["budget", "b"], outcomes }),
    ];
    const snapshot = await snapshotForProgram({ program, variables });
    const expansion = expandWorldBranches({ snapshot, variables, bounds: { ...simulationInput({ program, snapshot }).bounds, maxBranches: 4 } });
    assert(expansion.status === "BOUNDED_INCOMPLETE" && expansion.requiredBranches === 9 && expansion.branches.length === 0 && expansion.highRiskBranchesDiscarded === 0, id);
    return "BOUNDED_INCOMPLETE_NO_PRUNING";
  }
  if (id === "p5_deterministic_replay") {
    const program = canonicalObservationProgram(true);
    const snapshot = await snapshotForProgram({ program });
    const input = simulationInput({ program, snapshot });
    const first = await simulateOperationalProgram(input);
    const second = await simulateOperationalProgram(structuredClone(input));
    assert(JSON.stringify(second) === JSON.stringify(first) && first.replayIdentity === second.replayIdentity && first.traceId === second.traceId, id);
    assert(simulationToCausalReplayNodes(first, { recordedAt: P5_TEST_NOW }).length >= 2, id);
    return "BYTE_STABLE_REPLAY_IDENTITY";
  }
  if (id === "p5_snapshot_isolation") {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const before = JSON.stringify(snapshot);
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot }));
    assert(JSON.stringify(snapshot) === before && Object.isFrozen(snapshot) && result.branches[0]?.effectOverlay.length === 1, id);
    return "SNAPSHOT_IMMUTABLE";
  }
  if (id === "p5_cross_tenant_protection") {
    const program = financialWriteProgram();
    assert(program.body.kind === "effect", "financial-fixture");
    const variable = effectWorldVariable({ effectRef: program.body.semanticId, tenantId: "90000000-0000-4000-8000-000000000001", outcomes: [outcome("success", "SUCCESS")] });
    const snapshot = await snapshotForProgram({ program, variables: [variable] });
    const result = await simulateOperationalProgram(simulationInput({ program, snapshot, variables: [variable] }));
    assert(result.status === "FAILED" && result.issues.some((issue) => issue.code === "CROSS_TENANT_WORLD_VARIABLE"), id);
    return "CROSS_TENANT_BLOCKED";
  }
  if (id === "p5_p2_rejection" || id === "p5_p3_unresolved") {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    const result = await simulateOperationalProgram(simulationInput({
      program,
      snapshot,
      ...(id === "p5_p2_rejection" ? { p2Status: "REJECTED" } : { p3Status: "UNRESOLVED" }),
    }));
    assert(result.status === (id === "p5_p2_rejection" ? "P2_BLOCKED" : "P3_BLOCKED") && result.branches.length === 0, id);
    return id === "p5_p2_rejection" ? "P2_BLOCKED" : "P3_BLOCKED";
  }
  if (id === "p5_p4_unsupported_lowering") {
    const lowering = lowerOperationalProgram(unsupportedMultiQuery());
    assert(lowering.status === "UNSUPPORTED", id);
    return "LOWERING_GATE_PRECEDES_P5";
  }
  if (id === "p5_real_side_effect_escape_attempt") {
    const program = internalCanonicalWriteProgram();
    const snapshot = await snapshotForProgram({ program });
    let escapeCalls = 0;
    const polluted = {
      ...simulationInput({ program, snapshot }),
      db: () => { escapeCalls += 1; },
      provider: () => { escapeCalls += 1; },
      computer: () => { escapeCalls += 1; },
      authority: () => { escapeCalls += 1; },
    } as SimulateOperationalProgramInput & Record<string, unknown>;
    const result = await simulateOperationalProgram(polluted);
    assert(escapeCalls === 0 && JSON.stringify(result.sideEffects) === JSON.stringify(ZERO_REAL_SIDE_EFFECTS), id);
    return "ESCAPE_CALLBACK_UNREACHABLE";
  }
  throw new Error(`P5_LOCKED_CASE_UNIMPLEMENTED:${id}`);
}

export async function runP5LockedCorpus(): Promise<P5LockedCaseResult[]> {
  assert(P5_LOCKED_CASES.length === 26, "CORPUS_COUNT");
  const results: P5LockedCaseResult[] = [];
  for (const fixture of P5_LOCKED_CASES) {
    const actual = await runCase(fixture.id);
    assert(actual === fixture.evidence, `${fixture.id}:EVIDENCE_MISMATCH`);
    results.push({ ...fixture, passed: true, actual });
  }
  return results;
}
