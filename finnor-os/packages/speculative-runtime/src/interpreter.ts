import {
  analyzeProgramGraph,
  canonicalSerialize,
  canonicalizeIrFragment,
  validateOperationalProgram,
  type Compensation,
  type Effect,
  type JsonObject,
  type JsonValue,
  type OperationalProgram,
  type ProgramNode,
} from "@finnor/operational-ir";
import {
  SPECULATIVE_RUNTIME_VERSION,
  type BranchFailureMode,
  type HypotheticalEffect,
  type PredictedObservation,
  type RecoveryPathStep,
  type SimulateOperationalProgramInput,
  type SimulatedQueryResult,
  type SimulationIssue,
  type SimulationResult,
  type SimulationStats,
  type SimulationTraceEntry,
  type SpeculativeSideEffectCounters,
  type WorldBranch,
  type WorldVariable,
} from "./contracts";
import { classifyEffectAdapter, predictHypotheticalEffect } from "./adapters";
import { expandWorldBranches } from "./branches";
import { evaluateBranch } from "./evaluation";
import { immutableClone } from "./immutable";
import { branchIdentity, canonicalBytes, overlayIdentity, replayIdentity, traceIdentity } from "./identity";
import { evaluatePredicateState, type PredicateRuntimeState } from "./predicates";
import { validateWorldSnapshot } from "./snapshot";

export const ZERO_REAL_SIDE_EFFECTS: SpeculativeSideEffectCounters = Object.freeze({
  realDbMutations: 0,
  realProviderCalls: 0,
  realComputerMutations: 0,
  realAuthorityDecisions: 0,
  realApprovalRequests: 0,
  realWorkTransitions: 0,
  realOutboxWrites: 0,
  realExternalWebhooks: 0,
  realPaymentMutations: 0,
});

const OWNERSHIP: SimulationResult["ownership"] = Object.freeze({
  predictsWorlds: "P5",
  selectsPrograms: "P4",
  epistemicOwner: "P3",
  staticAdmissibilityOwner: "P2",
  authoritativeExecution: "EXISTING_GOVERNED_RUNTIME",
});

interface MutableBranch {
  seed: WorldBranch;
  effects: HypotheticalEffect[];
  queries: SimulatedQueryResult[];
  observations: PredictedObservation[];
  trace: SimulationTraceEntry[];
  failures: BranchFailureMode[];
  recovery: RecoveryPathStep[];
  stopped: boolean;
}

class SimulationStop extends Error {
  constructor(
    readonly category: "BUDGET" | "UNSUPPORTED" | "FAILED",
    readonly code: string,
    readonly nodeRef: string | null,
    message: string,
  ) {
    super(message);
  }
}

interface InterpreterContext {
  input: SimulateOperationalProgramInput;
  stats: SimulationStats;
  compensations: Map<string, Compensation[]>;
}

function initialStats(requiredBranches = 0): SimulationStats {
  return {
    requiredBranches,
    simulatedBranches: 0,
    steps: 0,
    effects: 0,
    deterministicTimeUnits: 0,
    estimatedMemoryBytes: 0,
    maxDepthObserved: 0,
    budgetExhausted: false,
    budgetReasonCodes: [],
    highRiskBranchesDiscarded: 0,
  };
}

function worldState(ctx: InterpreterContext, branch: MutableBranch): PredicateRuntimeState {
  return {
    snapshot: ctx.input.snapshot,
    program: ctx.input.program,
    variables: branch.seed.uncertainVariables,
    assumptions: branch.seed.assumptions,
    effects: branch.effects,
    queryResults: branch.queries,
    observations: branch.observations,
  };
}

function trace(branch: MutableBranch, entry: Omit<SimulationTraceEntry, "sequence">): void {
  branch.trace.push({ sequence: branch.trace.length + 1, ...entry });
}

function budget(ctx: InterpreterContext, depth: number, nodeRef: string | null, effect = false): void {
  ctx.stats.steps += 1;
  ctx.stats.deterministicTimeUnits += 1;
  ctx.stats.maxDepthObserved = Math.max(ctx.stats.maxDepthObserved, depth);
  if (effect) ctx.stats.effects += 1;
  const stop = (code: string, message: string): never => {
    ctx.stats.budgetExhausted = true;
    if (!ctx.stats.budgetReasonCodes.includes(code)) ctx.stats.budgetReasonCodes.push(code);
    throw new SimulationStop("BUDGET", code, nodeRef, message);
  };
  if (depth > ctx.input.bounds.maxDepth) stop("MAX_DEPTH_EXCEEDED", "Program nesting exceeds maxDepth.");
  if (ctx.stats.steps > ctx.input.bounds.maxSimulationSteps) stop("MAX_SIMULATION_STEPS_EXCEEDED", "Simulation step bound exhausted.");
  if (ctx.stats.effects > ctx.input.bounds.maxEffects) stop("MAX_EFFECTS_EXCEEDED", "Hypothetical effect bound exhausted.");
  if (ctx.stats.deterministicTimeUnits > ctx.input.bounds.maxSimulationMs) {
    stop("MAX_SIMULATION_MS_EXCEEDED", "Simulation time bound exhausted.");
  }
}

function collectCompensations(node: ProgramNode, output = new Map<string, Compensation[]>()): Map<string, Compensation[]> {
  if (node.kind === "compensation") {
    output.set(node.forEffectId, [...(output.get(node.forEffectId) ?? []), node].sort((left, right) => left.semanticId.localeCompare(right.semanticId)));
  } else if (node.kind === "sequence") for (const child of node.steps) collectCompensations(child, output);
  else if (node.kind === "parallel") for (const child of node.branches) collectCompensations(child, output);
  else if (node.kind === "branch") {
    for (const branchCase of node.cases) collectCompensations(branchCase.then, output);
    if (node.otherwise) collectCompensations(node.otherwise, output);
  }
  return output;
}

function variableForEffect(branch: MutableBranch, effectRef: string): WorldVariable | null {
  return branch.seed.uncertainVariables.find((variable) => variable.binding.kind === "EFFECT_OUTCOME" && variable.binding.effectRef === effectRef) ?? null;
}

function variableForWait(branch: MutableBranch, waitRef: string): WorldVariable | null {
  return branch.seed.uncertainVariables.find((variable) => variable.binding.kind === "WAIT_EVENT" && variable.binding.waitRef === waitRef) ?? null;
}

function failure(input: Partial<BranchFailureMode> & Pick<BranchFailureMode, "code">): BranchFailureMode {
  return {
    code: input.code,
    nodeRef: input.nodeRef ?? null,
    recoverable: input.recoverable ?? false,
    consequential: input.consequential ?? false,
    residualRisk: input.residualRisk ?? "UNKNOWN",
  };
}

function effectReversibility(effect: Effect, program: OperationalProgram): HypotheticalEffect["reversibility"] {
  return classifyEffectAdapter(effect, program).declaration?.reversibility.classification ?? "UNKNOWN";
}

function assumptionOutcome(branch: MutableBranch, variable: WorldVariable | null) {
  if (!variable) return null;
  const assumption = branch.seed.assumptions.find((candidate) => candidate.variableId === variable.id);
  const outcome = assumption ? variable.possibleOutcomes.find((candidate) => candidate.outcomeId === assumption.outcomeId) : null;
  return assumption && outcome ? { assumption, outcome } : null;
}

function addPredictedEffect(ctx: InterpreterContext, branch: MutableBranch, effect: Effect, outcome: HypotheticalEffect["outcome"]): HypotheticalEffect {
  budget(ctx, 1, effect.semanticId, true);
  const predicted = predictHypotheticalEffect({
    effect,
    program: ctx.input.program,
    state: worldState(ctx, branch),
    outcome,
    ordinal: branch.effects.length + 1,
  });
  if (predicted.status !== "PREDICTED" || !predicted.effect) {
    throw new SimulationStop("UNSUPPORTED", predicted.reasonCodes[0] ?? "UNSUPPORTED_EFFECT_SEMANTICS", effect.semanticId, `Unsupported Effect semantics: ${predicted.reasonCodes.join(",")}`);
  }
  branch.effects.push(predicted.effect);
  trace(branch, {
    kind: "EFFECT_PREDICTED",
    nodeRef: effect.semanticId,
    status: outcome,
    reasonCodes: predicted.reasonCodes,
    evidence: {
      hypotheticalEffectId: predicted.effect.hypotheticalEffectId,
      adapterClass: predicted.effect.adapterClass,
      changeCount: predicted.effect.changes.length,
      authoritative: false,
    },
  });
  return predicted.effect;
}

function preconditions(ctx: InterpreterContext, branch: MutableBranch, effect: Effect): "SATISFIED" | "VIOLATED" | "UNKNOWN" {
  const classification = classifyEffectAdapter(effect, ctx.input.program);
  if (!classification.declaration) return "UNKNOWN";
  const results = classification.declaration.contract.requires.map((predicate) => evaluatePredicateState(predicate, worldState(ctx, branch)).state);
  if (results.some((result) => result === "FALSE")) return "VIOLATED";
  if (results.every((result) => result === "TRUE")) return "SATISFIED";
  return results.length === 0 ? "SATISFIED" : "UNKNOWN";
}

async function runCompensation(ctx: InterpreterContext, branch: MutableBranch, original: Effect, trigger: Compensation["trigger"], depth: number): Promise<void> {
  const candidates = ctx.compensations.get(original.semanticId)?.filter((compensation) => compensation.trigger === trigger) ?? [];
  if (candidates.length === 0) return;
  for (const compensation of candidates) {
    trace(branch, { kind: "RECOVERY_REGISTERED", nodeRef: compensation.semanticId, status: compensation.trigger, reasonCodes: ["P2_COMPENSATION_LINK"], evidence: { forEffectId: original.semanticId } });
    const classification = classifyEffectAdapter(compensation.effect, ctx.input.program);
    const variable = variableForEffect(branch, compensation.effect.semanticId);
    const selected = assumptionOutcome(branch, variable);
    const outcome = selected?.assumption.operationalStatus ?? (classification.adapterClass === "CANONICAL_WRITE" ? "SUCCESS" : "UNKNOWN");
    const predicted = addPredictedEffect(ctx, branch, compensation.effect, outcome);
    const succeeded = predicted.outcome === "SUCCESS";
    branch.recovery.push({
      kind: "COMPENSATION",
      status: succeeded ? "PREDICTED_SUCCESS" : predicted.outcome === "FAILURE" ? "PREDICTED_FAILURE" : "UNKNOWN",
      effectRef: compensation.effect.semanticId,
      reasonCodes: [succeeded ? "COMPENSATION_PREDICTED" : "COMPENSATION_OUTCOME_UNVERIFIED"],
    });
    trace(branch, { kind: "RECOVERY_PREDICTED", nodeRef: compensation.semanticId, status: succeeded ? "PREDICTED_SUCCESS" : "UNKNOWN", reasonCodes: branch.recovery.at(-1)!.reasonCodes, evidence: { kind: "COMPENSATION" } });
    if (!succeeded) branch.stopped = true;
    budget(ctx, depth, compensation.semanticId);
  }
}

async function executeEffect(ctx: InterpreterContext, branch: MutableBranch, effect: Effect, depth: number): Promise<void> {
  const classification = classifyEffectAdapter(effect, ctx.input.program);
  if (classification.status !== "SUPPORTED" || !classification.adapterClass) {
    trace(branch, { kind: "UNSUPPORTED_SEMANTICS", nodeRef: effect.semanticId, status: "UNSUPPORTED", reasonCodes: classification.reasonCodes, evidence: {} });
    throw new SimulationStop("UNSUPPORTED", classification.reasonCodes[0] ?? "UNSUPPORTED_EFFECT_SEMANTICS", effect.semanticId, "No fail-closed speculative adapter supports this P2 effect declaration.");
  }
  const precondition = preconditions(ctx, branch, effect);
  if (precondition !== "SATISFIED") {
    const code = precondition === "VIOLATED" ? "STALE_PRECONDITION" : "PRECONDITION_UNKNOWN";
    branch.failures.push(failure({ code, nodeRef: effect.semanticId, recoverable: true, consequential: effect.consequential, residualRisk: precondition === "VIOLATED" ? "LOW" : "UNKNOWN" }));
    branch.recovery.push({ kind: "MANUAL", status: "REQUIRED", effectRef: effect.semanticId, reasonCodes: [precondition === "VIOLATED" ? "BLOCK_AND_RECOMPILE" : "VERIFY_ASSUMPTIONS_BEFORE_COMMIT"] });
    trace(branch, { kind: "EFFECT_PREDICTED", nodeRef: effect.semanticId, status: code, reasonCodes: [code], evidence: { applied: false } });
    branch.stopped = true;
    return;
  }
  const variable = variableForEffect(branch, effect.semanticId);
  const selected = assumptionOutcome(branch, variable);
  const external = classification.adapterClass !== "CANONICAL_WRITE";
  const outcome = selected?.assumption.operationalStatus ?? (external ? "UNKNOWN" : "SUCCESS");
  const predicted = addPredictedEffect(ctx, branch, effect, outcome);
  if (outcome === "SUCCESS") return;
  const irreversible = effectReversibility(effect, ctx.input.program) === "IRREVERSIBLE";
  if (outcome === "RETRYABLE_FAILURE") {
    const recovery = selected?.outcome.recovery;
    const retryOutcome = recovery?.kind === "RETRY" && recovery.nextOutcomeId && variable
      ? variable.possibleOutcomes.find((candidate) => candidate.outcomeId === recovery.nextOutcomeId)
      : null;
    if (retryOutcome) {
      const retried = addPredictedEffect(ctx, branch, effect, retryOutcome.operationalStatus);
      const succeeded = retried.outcome === "SUCCESS";
      branch.recovery.push({ kind: "RETRY", status: succeeded ? "PREDICTED_SUCCESS" : "PREDICTED_FAILURE", effectRef: effect.semanticId, reasonCodes: [succeeded ? "BOUNDED_RETRY_PREDICTED_SUCCESS" : "BOUNDED_RETRY_PREDICTED_FAILURE"] });
      trace(branch, { kind: "RECOVERY_PREDICTED", nodeRef: effect.semanticId, status: branch.recovery.at(-1)!.status, reasonCodes: branch.recovery.at(-1)!.reasonCodes, evidence: { kind: "RETRY", nextOutcomeId: retryOutcome.outcomeId } });
      if (succeeded) {
        branch.failures.push(failure({ code: "RETRYABLE_FAILURE", nodeRef: effect.semanticId, recoverable: true, consequential: effect.consequential, residualRisk: "NONE" }));
        return;
      }
    } else {
      branch.recovery.push({ kind: "RETRY", status: "REQUIRED", effectRef: effect.semanticId, reasonCodes: ["RETRY_OUTCOME_NOT_MODELED_BY_P3"] });
    }
    branch.failures.push(failure({ code: "RETRYABLE_FAILURE", nodeRef: effect.semanticId, recoverable: true, consequential: effect.consequential, residualRisk: "MEDIUM" }));
    branch.stopped = true;
    return;
  }
  if (outcome === "PARTIAL") {
    branch.failures.push(failure({ code: "PARTIAL_EXECUTION", nodeRef: effect.semanticId, recoverable: true, consequential: effect.consequential, residualRisk: irreversible ? "HIGH" : "MEDIUM" }));
    await runCompensation(ctx, branch, effect, "ON_PARTIAL_FAILURE", depth + 1);
    if (!branch.recovery.some((step) => step.effectRef === effect.semanticId || step.kind === "COMPENSATION")) {
      branch.recovery.push({ kind: "RECONCILIATION", status: "REQUIRED", effectRef: effect.semanticId, reasonCodes: ["PARTIAL_EFFECT_REQUIRES_RECONCILIATION"] });
    }
    branch.stopped = true;
    return;
  }
  if (outcome === "AMBIGUOUS" || outcome === "UNKNOWN" || outcome === "TIMEOUT") {
    const code = outcome === "TIMEOUT" ? "TIMEOUT_UNKNOWN_DELIVERY" : outcome === "AMBIGUOUS" ? "AMBIGUOUS_EXTERNAL_RESULT" : "UNKNOWN_EXTERNAL_OUTCOME";
    branch.failures.push(failure({ code, nodeRef: effect.semanticId, recoverable: true, consequential: effect.consequential, residualRisk: irreversible ? "HIGH" : "UNKNOWN" }));
    branch.recovery.push({ kind: "RECONCILIATION", status: "REQUIRED", effectRef: effect.semanticId, reasonCodes: ["RECONCILE_BEFORE_RETRY"] });
    branch.stopped = true;
    return;
  }
  branch.failures.push(failure({ code: outcome, nodeRef: effect.semanticId, recoverable: !irreversible, consequential: effect.consequential, residualRisk: irreversible ? "HIGH" : "LOW" }));
  await runCompensation(ctx, branch, effect, "ON_FAILURE", depth + 1);
  branch.stopped = true;
}

function executeQuery(ctx: InterpreterContext, branch: MutableBranch, node: Extract<ProgramNode, { kind: "query" }>): void {
  const observed = ctx.input.snapshot.relevantObservations.find((observation) => observation.id === node.semanticId || (observation.subject.kind === "query" && observation.subject.ref === node.semanticId));
  let values: JsonObject;
  let status: SimulatedQueryResult["status"];
  let evidenceRefs: string[];
  if (observed?.state === "OBSERVED") {
    const raw = observed.value;
    values = raw && typeof raw === "object" && !Array.isArray(raw) ? structuredClone(raw as JsonObject) : { value: structuredClone(raw) };
    if (!("result" in values)) values.result = structuredClone(raw);
    if (!("status" in values)) values.status = "ok";
    status = "PREDICTED";
    evidenceRefs = [...observed.evidenceRefs].sort();
  } else if (observed?.state === "MISSING") {
    values = { status: "failed", result: null };
    status = "FAILED";
    evidenceRefs = [...observed.evidenceRefs].sort();
  } else {
    const refs = [...ctx.input.snapshot.canonicalState, ...ctx.input.snapshot.workState].map((record) => record.ref);
    values = { status: "unknown", result: null, boundedRecordCount: refs.length };
    status = "UNKNOWN";
    evidenceRefs = [];
  }
  const recordRefs = node.entityRefs.flatMap((semanticRef) => {
    const entity = ctx.input.program.entities.find((candidate) => candidate.semanticId === semanticRef);
    return entity?.resolution.status === "resolved" ? [{ kind: entity.resolution.canonical.kind, type: entity.resolution.canonical.type, id: entity.resolution.canonical.id }] : [];
  });
  branch.queries.push({ queryRef: node.semanticId, status, values, recordRefs, evidenceRefs });
  trace(branch, { kind: "QUERY_PREDICTED", nodeRef: node.semanticId, status, reasonCodes: [observed ? "BOUNDED_SNAPSHOT_OBSERVATION" : "QUERY_RESULT_UNKNOWN"], evidence: { evidenceRefs, recordCount: recordRefs.length } });
}

function executeWait(ctx: InterpreterContext, branch: MutableBranch, node: Extract<ProgramNode, { kind: "wait" }>): void {
  const variable = variableForWait(branch, node.semanticId);
  const selected = assumptionOutcome(branch, variable);
  if (selected) {
    const status = selected.assumption.operationalStatus;
    trace(branch, { kind: "WAIT_PREDICTED", nodeRef: node.semanticId, status, reasonCodes: ["P3_WAIT_OUTCOME_ASSUMPTION"], evidence: { variableId: variable!.id, outcomeId: selected.assumption.outcomeId } });
    if (status === "SUCCESS") return;
    const code = status === "TIMEOUT" ? "WAIT_TIMEOUT" : status === "FAILURE" ? "WAIT_FAILURE" : "WAIT_OUTCOME_UNKNOWN";
    branch.failures.push(failure({ code, nodeRef: node.semanticId, recoverable: true, residualRisk: "LOW" }));
    if (status !== "FAILURE") branch.recovery.push({ kind: "RECONCILIATION", status: "REQUIRED", effectRef: null, reasonCodes: ["WAIT_EVENT_REQUIRES_REAL_OBSERVATION"] });
    branch.stopped = true;
    return;
  }
  const evaluated = evaluatePredicateState(node.condition, worldState(ctx, branch));
  const deadlinePassed = node.deadlineAt ? Date.parse(node.deadlineAt) <= Date.parse(ctx.input.snapshot.asOf) : false;
  trace(branch, { kind: "WAIT_PREDICTED", nodeRef: node.semanticId, status: evaluated.state, reasonCodes: evaluated.reasonCodes, evidence: { deadlinePassed } });
  if (evaluated.state === "TRUE") return;
  branch.failures.push(failure({ code: deadlinePassed ? "WAIT_TIMEOUT" : "WAIT_CONDITION_UNKNOWN", nodeRef: node.semanticId, recoverable: true, residualRisk: "LOW" }));
  branch.stopped = true;
}

function cloneMutable(branch: MutableBranch): MutableBranch {
  return {
    seed: branch.seed,
    effects: structuredClone(branch.effects),
    queries: structuredClone(branch.queries),
    observations: structuredClone(branch.observations),
    trace: structuredClone(branch.trace),
    failures: structuredClone(branch.failures),
    recovery: structuredClone(branch.recovery),
    stopped: branch.stopped,
  };
}

function changeKey(effect: HypotheticalEffect, index: number): string {
  const change = effect.changes[index]!;
  return `${change.target.kind}:${change.target.type}:${change.target.id}:${canonicalSerialize(change.path)}`;
}

async function executeParallel(ctx: InterpreterContext, branch: MutableBranch, node: Extract<ProgramNode, { kind: "parallel" }>, depth: number): Promise<void> {
  const baseline = { effects: branch.effects.length, queries: branch.queries.length, trace: branch.trace.length, failures: branch.failures.length, recovery: branch.recovery.length };
  const children = [...node.branches].sort((left, right) => canonicalSerialize(canonicalizeIrFragment(left)).localeCompare(canonicalSerialize(canonicalizeIrFragment(right))));
  const results: MutableBranch[] = [];
  for (const child of children) {
    const childBranch = cloneMutable(branch);
    await executeNode(ctx, childBranch, child, depth + 1);
    results.push(childBranch);
  }
  const writes = new Map<string, JsonValue>();
  for (const result of results) for (const effect of result.effects.slice(baseline.effects)) for (let index = 0; index < effect.changes.length; index += 1) {
    const key = changeKey(effect, index);
    const after = effect.changes[index]!.after;
    const existing = writes.get(key);
    if (existing !== undefined && canonicalSerialize(existing) !== canonicalSerialize(after)) {
      for (const childResult of results) {
        branch.effects.push(...childResult.effects.slice(baseline.effects));
        branch.queries.push(...childResult.queries.slice(baseline.queries));
        branch.trace.push(...childResult.trace.slice(baseline.trace));
        branch.failures.push(...childResult.failures.slice(baseline.failures));
        branch.recovery.push(...childResult.recovery.slice(baseline.recovery));
      }
      branch.failures.push(failure({ code: "PARALLEL_WRITE_CONFLICT", nodeRef: node.semanticId, consequential: true, residualRisk: "HIGH" }));
      trace(branch, { kind: "PARALLEL_MERGED", nodeRef: node.semanticId, status: "CONFLICT", reasonCodes: ["PARALLEL_WRITE_CONFLICT"], evidence: { childCount: children.length } });
      branch.stopped = true;
      return;
    }
    writes.set(key, after);
  }
  for (const result of results) {
    branch.effects.push(...result.effects.slice(baseline.effects));
    branch.queries.push(...result.queries.slice(baseline.queries));
    branch.trace.push(...result.trace.slice(baseline.trace));
    branch.failures.push(...result.failures.slice(baseline.failures));
    branch.recovery.push(...result.recovery.slice(baseline.recovery));
    branch.stopped ||= result.stopped;
  }
  trace(branch, { kind: "PARALLEL_MERGED", nodeRef: node.semanticId, status: branch.stopped ? "PARTIAL" : "MERGED", reasonCodes: ["PAIRWISE_OVERLAY_CONFLICT_CHECKED"], evidence: { childCount: children.length, writeCount: writes.size } });
}

async function executeNode(ctx: InterpreterContext, branch: MutableBranch, node: ProgramNode, depth: number): Promise<void> {
  budget(ctx, depth, node.semanticId);
  trace(branch, { kind: "NODE_ENTERED", nodeRef: node.semanticId, status: node.kind, reasonCodes: [], evidence: {} });
  if (branch.stopped) return;
  if (node.kind === "query") { executeQuery(ctx, branch, node); return; }
  if (node.kind === "effect") { await executeEffect(ctx, branch, node, depth); return; }
  if (node.kind === "wait") { executeWait(ctx, branch, node); return; }
  if (node.kind === "compensation") {
    trace(branch, { kind: "RECOVERY_REGISTERED", nodeRef: node.semanticId, status: node.trigger, reasonCodes: ["COMPENSATION_DECLARATION_NOT_EAGERLY_EXECUTED"], evidence: { forEffectId: node.forEffectId } });
    return;
  }
  if (node.kind === "sequence") {
    for (const child of node.steps) {
      await executeNode(ctx, branch, child, depth + 1);
      if (branch.stopped) break;
    }
    return;
  }
  if (node.kind === "parallel") { await executeParallel(ctx, branch, node, depth); return; }
  for (const branchCase of node.cases) {
    const evaluated = evaluatePredicateState(branchCase.when, worldState(ctx, branch));
    if (evaluated.state === "UNKNOWN") {
      branch.failures.push(failure({ code: "BRANCH_CONDITION_UNKNOWN", nodeRef: node.semanticId, recoverable: true, residualRisk: "UNKNOWN" }));
      trace(branch, { kind: "BRANCH_CASE_SELECTED", nodeRef: node.semanticId, status: "UNKNOWN", reasonCodes: evaluated.reasonCodes, evidence: { caseId: branchCase.caseId } });
      branch.stopped = true;
      return;
    }
    if (evaluated.state === "TRUE") {
      trace(branch, { kind: "BRANCH_CASE_SELECTED", nodeRef: node.semanticId, status: "SELECTED", reasonCodes: evaluated.reasonCodes, evidence: { caseId: branchCase.caseId } });
      await executeNode(ctx, branch, branchCase.then, depth + 1);
      return;
    }
  }
  if (node.otherwise) {
    trace(branch, { kind: "BRANCH_CASE_SELECTED", nodeRef: node.semanticId, status: "OTHERWISE", reasonCodes: ["NO_CASE_MATCHED"], evidence: {} });
    await executeNode(ctx, branch, node.otherwise, depth + 1);
    return;
  }
  branch.failures.push(failure({ code: "NO_BRANCH_CASE_MATCHED", nodeRef: node.semanticId, recoverable: false, residualRisk: "LOW" }));
  branch.stopped = true;
}

function finalizeBranch(ctx: InterpreterContext, branch: MutableBranch): WorldBranch {
  const evaluated = evaluateBranch({ state: worldState(ctx, branch), failures: branch.failures, recovery: branch.recovery, estimates: ctx.input.estimates });
  branch.observations = evaluated.observations;
  for (const observation of evaluated.observations) trace(branch, { kind: "OBSERVATION_PREDICTED", nodeRef: observation.observationRef, status: observation.status, reasonCodes: observation.reasonCodes, evidence: { evidenceClass: observation.evidenceClass, verification: observation.verification } });
  trace(branch, { kind: "SUCCESS_EVALUATED", nodeRef: ctx.input.program.successCondition.semanticId, status: evaluated.outcome.outcome, reasonCodes: evaluated.outcome.goalSatisfaction.reasonCodes, evidence: { hardConstraintStatus: evaluated.outcome.hardConstraintStatus, verificationStrength: evaluated.outcome.verificationStrength } });
  const resequenced = branch.trace.map((entry, index) => ({ ...entry, sequence: index + 1 }));
  const overlayId = overlayIdentity(branch.effects);
  const branchMaterial = {
    tenantId: branch.seed.tenantId,
    baseSnapshotId: branch.seed.baseSnapshotId,
    parentBranchId: branch.seed.parentBranchId,
    assumptions: branch.seed.assumptions,
    overlayId,
    queryResults: branch.queries,
    observations: branch.observations,
    outcome: evaluated.outcome,
    uncertainVariables: branch.seed.uncertainVariables,
  };
  const result: WorldBranch = {
    version: SPECULATIVE_RUNTIME_VERSION,
    kind: "world_branch",
    branchId: branchIdentity(branchMaterial),
    tenantId: branch.seed.tenantId,
    baseSnapshotId: branch.seed.baseSnapshotId,
    parentBranchId: branch.seed.parentBranchId,
    effectOverlayId: overlayId,
    effectOverlay: branch.effects,
    uncertainVariables: branch.seed.uncertainVariables,
    assumptions: branch.seed.assumptions,
    queryResults: branch.queries,
    simulatedObservations: branch.observations,
    branchTrace: resequenced,
    failureModes: branch.failures,
    recoveryPath: branch.recovery,
    outcome: evaluated.outcome,
    immutable: true,
  };
  return immutableClone(result);
}

function baseResult(input: SimulateOperationalProgramInput, status: SimulationResult["status"], stats: SimulationStats, issues: SimulationIssue[], branches: WorldBranch[]): SimulationResult {
  const replayMaterial = {
    identityVersion: "p5-world-runtime-v1",
    snapshotId: input.snapshot.snapshotId,
    programIrSemanticHash: input.program.irSemanticHash,
    p4CandidateHash: input.gates.p4CandidateHash,
    branchAssumptions: branches.map((branch) => branch.assumptions),
    variables: [...input.worldVariables].sort((left, right) => left.id.localeCompare(right.id)),
    bounds: input.bounds,
    estimates: input.estimates ?? null,
    status,
  };
  const traceMaterial = branches.map((branch) => ({ branchId: branch.branchId, trace: branch.branchTrace }));
  const programNodes = [...analyzeProgramGraph(input.program.body).nodes.values()]
    .map(({ semanticId, node }) => ({
      semanticId,
      kind: node.kind,
      operation: node.kind === "effect" ? node.operation : null,
      requiredCapability: node.kind === "effect"
        ? node.requiredCapability
        : node.kind === "query" ? `query:${node.request.intent}` : null,
    }))
    .sort((left, right) => left.semanticId.localeCompare(right.semanticId));
  return immutableClone({
    version: SPECULATIVE_RUNTIME_VERSION,
    status,
    tenantId: input.snapshot.tenantId,
    snapshotId: input.snapshot.snapshotId,
    programIrSemanticHash: input.program.irSemanticHash,
    p4CandidateHash: input.gates.p4CandidateHash,
    snapshotProvenance: {
      asOf: input.snapshot.asOf,
      sourceId: input.snapshot.provenance.sourceId,
      sourceRefs: [...input.snapshot.provenance.sourceRefs],
      materializationHash: input.snapshot.provenance.materializationHash,
    },
    programEvidence: {
      semanticId: input.program.semanticId,
      executionModel: input.program.executionModel,
      nodes: programNodes,
    },
    replayIdentity: replayIdentity(replayMaterial),
    traceId: traceIdentity(traceMaterial),
    branches,
    branchOutcomes: branches.flatMap((branch) => branch.outcome ? [branch.outcome] : []),
    bounds: { ...input.bounds },
    stats,
    issues,
    sideEffects: ZERO_REAL_SIDE_EFFECTS,
    ownership: OWNERSHIP,
  });
}

/**
 * Deterministic speculative interpreter for the one OperationalProgram language.
 * It accepts no DB/provider/computer/Authority/Work callback and therefore cannot
 * route an operation outside in-memory branches.
 */
export async function simulateOperationalProgram(input: SimulateOperationalProgramInput): Promise<SimulationResult> {
  const stats = initialStats();
  if (input.gates.p4SelectionAuthority !== "P4" || !input.gates.p4CandidateHash.startsWith("p4:program:sha256:")) {
    return baseResult(input, "FAILED", stats, [{ code: "INVALID_P4_CANDIDATE_GATE", message: "P4 candidate identity and selection ownership are required.", nodeRef: null }], []);
  }
  if (input.gates.p2Status !== "ADMISSIBLE") {
    return baseResult(input, "P2_BLOCKED", stats, [{ code: `P2_${input.gates.p2Status}`, message: "P5 cannot override P2 admissibility.", nodeRef: null }], []);
  }
  if (input.gates.p3Status !== "RESOLVED") {
    return baseResult(input, "P3_BLOCKED", stats, [{ code: "P3_MANDATORY_UNCERTAINTY_UNRESOLVED", message: "P5 cannot ignore P3 mandatory unknowns.", nodeRef: null }], []);
  }
  try {
    validateWorldSnapshot(input.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "World snapshot validation failed closed.";
    const code = message.startsWith("CROSS_TENANT") ? "CROSS_TENANT_WORLD_ACCESS" : "INVALID_WORLD_SNAPSHOT";
    return baseResult(input, "FAILED", stats, [{ code, message, nodeRef: null }], []);
  }
  if (input.worldVariables.some((variable) => variable.tenantId !== input.snapshot.tenantId)) {
    return baseResult(input, "FAILED", stats, [{ code: "CROSS_TENANT_WORLD_VARIABLE", message: "World variables must match the snapshot tenant.", nodeRef: null }], []);
  }
  if (input.snapshot.provenance.programIrSemanticHash !== input.program.irSemanticHash) {
    return baseResult(input, "FAILED", stats, [{ code: "SNAPSHOT_PROGRAM_MISMATCH", message: "Snapshot materialization is not bound to this OperationalProgram.", nodeRef: null }], []);
  }
  if (!Object.values(input.bounds).every((value) => Number.isSafeInteger(value) && value > 0)) {
    return baseResult(input, "FAILED", stats, [{ code: "INVALID_SIMULATION_BOUNDS", message: "Every simulation bound must be a positive safe integer.", nodeRef: null }], []);
  }
  const validation = validateOperationalProgram(input.program);
  if (!validation.valid || !validation.program) {
    return baseResult(input, "UNSUPPORTED", stats, validation.errors.map((issue) => ({ code: issue.code, message: issue.message, nodeRef: null })), []);
  }
  const baseMemoryBytes = canonicalBytes({
    snapshot: input.snapshot,
    program: canonicalizeIrFragment(input.program),
    worldVariables: input.worldVariables,
    bounds: input.bounds,
    estimates: input.estimates ?? null,
  });
  if (baseMemoryBytes > input.bounds.maxMemory) {
    stats.estimatedMemoryBytes = baseMemoryBytes;
    stats.budgetExhausted = true;
    stats.budgetReasonCodes = ["MAX_MEMORY_EXCEEDED"];
    return baseResult(input, "BOUNDED_INCOMPLETE", stats, [{ code: "MAX_MEMORY_EXCEEDED", message: "Snapshot, program reference, variables, and bounds exceed maxMemory before branch expansion.", nodeRef: null }], []);
  }
  stats.estimatedMemoryBytes = baseMemoryBytes;
  let expansion: ReturnType<typeof expandWorldBranches>;
  try {
    expansion = expandWorldBranches({ snapshot: input.snapshot, variables: input.worldVariables, bounds: input.bounds });
  } catch (error) {
    const code = error instanceof TypeError && error.message === "INVALID_SIMULATION_BOUNDS"
      ? "INVALID_SIMULATION_BOUNDS"
      : error instanceof Error && error.message.startsWith("CROSS_TENANT")
        ? "CROSS_TENANT_WORLD_ACCESS"
        : "INVALID_WORLD_VARIABLE";
    return baseResult(input, "FAILED", stats, [{ code, message: error instanceof Error ? error.message : "World branch expansion failed closed.", nodeRef: null }], []);
  }
  stats.requiredBranches = expansion.requiredBranches;
  if (expansion.status !== "EXPANDED") {
    stats.budgetExhausted = true;
    stats.budgetReasonCodes = expansion.issues.map((issue) => issue.code);
    return baseResult(input, "BOUNDED_INCOMPLETE", stats, expansion.issues, []);
  }
  const ctx: InterpreterContext = { input, stats, compensations: collectCompensations(input.program.body) };
  const branches: WorldBranch[] = [];
  const issues: SimulationIssue[] = [];
  let status: SimulationResult["status"] = "COMPLETE";
  for (const seed of expansion.branches) {
    const branch: MutableBranch = {
      seed,
      effects: [...seed.effectOverlay],
      queries: [...seed.queryResults],
      observations: [...seed.simulatedObservations],
      trace: [],
      failures: [...seed.failureModes],
      recovery: [...seed.recoveryPath],
      stopped: false,
    };
    trace(branch, { kind: "BRANCH_STARTED", nodeRef: input.program.semanticId, status: "STARTED", reasonCodes: ["IMMUTABLE_WORLD_FORK"], evidence: { seedBranchId: seed.branchId, snapshotId: seed.baseSnapshotId } });
    for (const assumption of seed.assumptions) trace(branch, { kind: "ASSUMPTION_APPLIED", nodeRef: null, status: assumption.operationalStatus, reasonCodes: ["P3_WORLD_VARIABLE_OUTCOME"], evidence: { variableId: assumption.variableId, outcomeId: assumption.outcomeId, risk: assumption.risk } });
    try {
      await executeNode(ctx, branch, input.program.body, 1);
      const finalized = finalizeBranch(ctx, branch);
      const bytes = canonicalBytes(finalized);
      if (stats.estimatedMemoryBytes + bytes > input.bounds.maxMemory) throw new SimulationStop("BUDGET", "MAX_MEMORY_EXCEEDED", null, "Finalized branch exceeds maxMemory.");
      stats.estimatedMemoryBytes += bytes;
      branches.push(finalized);
      stats.simulatedBranches += 1;
    } catch (error) {
      const stop = error instanceof SimulationStop ? error : new SimulationStop("FAILED", "SIMULATION_INTERNAL_FAILURE", null, (error as Error).message);
      issues.push({ code: stop.code, message: stop.message, nodeRef: stop.nodeRef });
      trace(branch, { kind: stop.category === "BUDGET" ? "BUDGET_STOP" : "UNSUPPORTED_SEMANTICS", nodeRef: stop.nodeRef, status: stop.category, reasonCodes: [stop.code], evidence: {} });
      if (stop.category === "BUDGET") {
        stats.budgetExhausted = true;
        if (!stats.budgetReasonCodes.includes(stop.code)) stats.budgetReasonCodes.push(stop.code);
      }
      status = stop.category === "BUDGET" ? "BOUNDED_INCOMPLETE" : stop.category === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED";
      break;
    }
  }
  if (branches.length !== expansion.requiredBranches && status === "COMPLETE") {
    status = "FAILED";
    issues.push({ code: "BRANCH_COVERAGE_INCOMPLETE", message: "Not every required branch was simulated.", nodeRef: null });
  }
  return baseResult(input, status, stats, issues, branches);
}
