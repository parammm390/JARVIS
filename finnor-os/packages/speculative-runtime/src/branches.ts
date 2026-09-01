import type { Proposition } from "@finnor/epistemic-runtime";
import {
  SPECULATIVE_RUNTIME_VERSION,
  type BranchAssumption,
  type SimulationBounds,
  type SimulationIssue,
  type WorldBranch,
  type WorldSnapshot,
  type WorldVariable,
  type WorldVariableFromP3Input,
  type WorldVariableOutcome,
} from "./contracts";
import { assertCanonicalJson, assertIsoTimestamp, assertNonEmpty, compareStable, immutableClone } from "./immutable";
import { branchIdentity, overlayIdentity } from "./identity";

function propositionValue(proposition: Proposition): Array<{ value: WorldVariableOutcome["value"]; evidenceRefs: string[] }> {
  if (proposition.value.kind === "ALTERNATIVES") return proposition.value.alternatives.map((alternative) => ({ value: alternative.value, evidenceRefs: alternative.evidenceRefs }));
  if (proposition.value.kind === "DETERMINISTIC") return [{ value: proposition.value.value, evidenceRefs: proposition.evidenceRefs }];
  return [];
}

function validateLikelihood(outcome: WorldVariableOutcome): void {
  if (outcome.likelihood.kind === "ORDINAL") assertNonEmpty(outcome.likelihood.basisRef, `outcome ${outcome.outcomeId} likelihood basisRef`);
  if (outcome.likelihood.kind === "EMPIRICAL") {
    if (!Number.isSafeInteger(outcome.likelihood.occurrences) || outcome.likelihood.occurrences < 0) throw new TypeError("EMPIRICAL occurrences must be a non-negative integer");
    if (!Number.isSafeInteger(outcome.likelihood.sampleSize) || outcome.likelihood.sampleSize <= 0) throw new TypeError("EMPIRICAL sampleSize must be a positive integer");
    if (outcome.likelihood.occurrences > outcome.likelihood.sampleSize) throw new TypeError("EMPIRICAL occurrences cannot exceed sampleSize");
    assertNonEmpty(outcome.likelihood.datasetRef, `outcome ${outcome.outcomeId} datasetRef`);
    assertIsoTimestamp(outcome.likelihood.measuredAt, `outcome ${outcome.outcomeId} measuredAt`);
  }
}

export function validateWorldVariable(variable: WorldVariable, tenantId?: string): void {
  assertNonEmpty(variable.id, "worldVariable.id");
  assertNonEmpty(variable.tenantId, "worldVariable.tenantId");
  assertNonEmpty(variable.sourcePropositionId, "worldVariable.sourcePropositionId");
  if (tenantId && variable.tenantId !== tenantId) throw new Error(`CROSS_TENANT_WORLD_VARIABLE:${variable.id}`);
  if (variable.provenance.owner !== "P3" || variable.provenance.propositionId !== variable.sourcePropositionId) throw new Error(`WORLD_VARIABLE_NOT_OWNED_BY_P3:${variable.id}`);
  assertIsoTimestamp(variable.provenance.asOf, `worldVariable ${variable.id} provenance.asOf`);
  if (variable.possibleOutcomes.length === 0) throw new Error(`WORLD_VARIABLE_OUTCOMES_REQUIRED:${variable.id}`);
  const outcomes = new Set<string>();
  for (const outcome of variable.possibleOutcomes) {
    assertNonEmpty(outcome.outcomeId, `worldVariable ${variable.id} outcomeId`);
    if (outcomes.has(outcome.outcomeId)) throw new Error(`DUPLICATE_WORLD_VARIABLE_OUTCOME:${variable.id}:${outcome.outcomeId}`);
    outcomes.add(outcome.outcomeId);
    assertCanonicalJson(outcome.value, `worldVariable ${variable.id} outcome ${outcome.outcomeId}`);
    validateLikelihood(outcome);
    if (outcome.recovery?.nextOutcomeId && !variable.possibleOutcomes.some((candidate) => candidate.outcomeId === outcome.recovery!.nextOutcomeId)) {
      throw new Error(`UNKNOWN_RECOVERY_OUTCOME:${variable.id}:${outcome.recovery.nextOutcomeId}`);
    }
  }
}

/** Converts P3 proposition alternatives only; unavailable outcomes must be supplied by an audited caller. */
export function worldVariableFromP3(input: WorldVariableFromP3Input): WorldVariable {
  const proposition = input.state.propositions.find((candidate) => candidate.id === input.propositionId);
  if (!proposition) throw new Error(`P3_PROPOSITION_NOT_FOUND:${input.propositionId}`);
  const supplied = input.outcomes?.map((outcome) => ({ ...outcome, evidenceRefs: [...(outcome.evidenceRefs ?? proposition.evidenceRefs)].sort() }));
  const derived = propositionValue(proposition).map((alternative, index): WorldVariableOutcome => ({
    outcomeId: `alternative-${String(index + 1).padStart(3, "0")}`,
    value: structuredClone(alternative.value),
    operationalStatus: "UNKNOWN",
    risk: "HIGH",
    likelihood: { kind: "UNRANKED" },
    evidenceRefs: [...alternative.evidenceRefs].sort(),
  }));
  const outcomes = supplied ?? derived;
  if (outcomes.length === 0) throw new Error(`P3_OUTCOMES_REQUIRED:${input.propositionId}`);
  const variable: WorldVariable = {
    id: `world-variable:${input.propositionId}`,
    tenantId: input.state.scope.tenantId,
    sourcePropositionId: input.propositionId,
    binding: structuredClone(input.binding),
    possibleOutcomes: outcomes.sort((left, right) => left.outcomeId.localeCompare(right.outcomeId)),
    evidence: [...proposition.evidenceRefs].sort(),
    confidenceQuality: proposition.confidence.level,
    provenance: {
      owner: "P3",
      propositionId: input.propositionId,
      evidenceRefs: [...proposition.evidenceRefs].sort(),
      asOf: input.state.asOf,
    },
  };
  validateWorldVariable(variable);
  return immutableClone(variable);
}

export interface ForkWorldInput {
  snapshot: WorldSnapshot;
  variables?: WorldVariable[];
  assumptions?: BranchAssumption[];
  parent?: WorldBranch;
}

export function forkWorld(input: ForkWorldInput): WorldBranch {
  const variables = [...(input.variables ?? input.parent?.uncertainVariables ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const variable of variables) {
    validateWorldVariable(variable, input.snapshot.tenantId);
    if (Date.parse(variable.provenance.asOf) > Date.parse(input.snapshot.asOf)) throw new Error(`WORLD_VARIABLE_FROM_FUTURE:${variable.id}`);
    for (const candidate of variable.possibleOutcomes) {
      if (candidate.likelihood.kind === "EMPIRICAL" && Date.parse(candidate.likelihood.measuredAt) > Date.parse(input.snapshot.asOf)) {
        throw new Error(`WORLD_VARIABLE_EMPIRICAL_EVIDENCE_FROM_FUTURE:${variable.id}:${candidate.outcomeId}`);
      }
    }
    if (!input.snapshot.epistemicInputs.some((epistemic) => epistemic.propositionId === variable.sourcePropositionId)) {
      throw new Error(`WORLD_VARIABLE_NOT_IN_SNAPSHOT_EPISTEMIC_INPUTS:${variable.id}`);
    }
  }
  if (input.parent && (input.parent.tenantId !== input.snapshot.tenantId || input.parent.baseSnapshotId !== input.snapshot.snapshotId)) {
    throw new Error("PARENT_BRANCH_SNAPSHOT_MISMATCH");
  }
  const assumptions = [...(input.assumptions ?? input.parent?.assumptions ?? [])].sort((left, right) => `${left.variableId}:${left.outcomeId}`.localeCompare(`${right.variableId}:${right.outcomeId}`));
  const variableById = new Map(variables.map((variable) => [variable.id, variable]));
  const seen = new Set<string>();
  for (const assumption of assumptions) {
    if (seen.has(assumption.variableId)) throw new Error(`DUPLICATE_BRANCH_ASSUMPTION:${assumption.variableId}`);
    seen.add(assumption.variableId);
    const variable = variableById.get(assumption.variableId);
    const outcome = variable?.possibleOutcomes.find((candidate) => candidate.outcomeId === assumption.outcomeId);
    if (!outcome
      || compareStable(outcome.value, assumption.value) !== 0
      || outcome.operationalStatus !== assumption.operationalStatus
      || outcome.risk !== assumption.risk
      || compareStable(outcome.recovery ?? null, assumption.recovery) !== 0) {
      throw new Error(`INVALID_BRANCH_ASSUMPTION:${assumption.variableId}:${assumption.outcomeId}`);
    }
  }
  const inheritedEffects = [...(input.parent?.effectOverlay ?? [])];
  const branchMaterial = {
    version: SPECULATIVE_RUNTIME_VERSION,
    tenantId: input.snapshot.tenantId,
    baseSnapshotId: input.snapshot.snapshotId,
    parentBranchId: input.parent?.branchId ?? null,
    assumptions,
    uncertainVariables: variables,
    inheritedOverlayId: overlayIdentity(inheritedEffects),
  };
  return immutableClone({
    version: SPECULATIVE_RUNTIME_VERSION,
    kind: "world_branch" as const,
    branchId: branchIdentity(branchMaterial),
    tenantId: input.snapshot.tenantId,
    baseSnapshotId: input.snapshot.snapshotId,
    parentBranchId: input.parent?.branchId ?? null,
    effectOverlayId: overlayIdentity(inheritedEffects),
    effectOverlay: inheritedEffects,
    uncertainVariables: variables,
    assumptions,
    queryResults: [...(input.parent?.queryResults ?? [])],
    simulatedObservations: [...(input.parent?.simulatedObservations ?? [])],
    branchTrace: [...(input.parent?.branchTrace ?? [])],
    failureModes: [...(input.parent?.failureModes ?? [])],
    recoveryPath: [...(input.parent?.recoveryPath ?? [])],
    outcome: input.parent?.outcome ?? null,
    immutable: true as const,
  });
}

export interface BranchExpansionResult {
  status: "EXPANDED" | "BOUNDED_INCOMPLETE";
  branches: WorldBranch[];
  requiredBranches: number;
  issues: SimulationIssue[];
  highRiskBranchesDiscarded: 0;
}

function boundsValid(bounds: SimulationBounds): boolean {
  return Object.values(bounds).every((value) => Number.isSafeInteger(value) && value > 0);
}

export function expandWorldBranches(input: {
  snapshot: WorldSnapshot;
  variables: WorldVariable[];
  bounds: SimulationBounds;
  parent?: WorldBranch;
}): BranchExpansionResult {
  if (!boundsValid(input.bounds)) throw new TypeError("INVALID_SIMULATION_BOUNDS");
  const variables = [...input.variables].sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set<string>();
  let requiredBranches = 1;
  for (const variable of variables) {
    validateWorldVariable(variable, input.snapshot.tenantId);
    if (ids.has(variable.id)) throw new Error(`DUPLICATE_WORLD_VARIABLE:${variable.id}`);
    ids.add(variable.id);
    requiredBranches *= variable.possibleOutcomes.length;
    if (!Number.isSafeInteger(requiredBranches)) requiredBranches = Number.MAX_SAFE_INTEGER;
  }
  if (variables.length > input.bounds.maxDepth) {
    return {
      status: "BOUNDED_INCOMPLETE",
      branches: [],
      requiredBranches,
      issues: [{ code: "MAX_DEPTH_EXCEEDED", message: "World-variable expansion depth exceeds the configured bound; no branch was silently discarded.", nodeRef: null }],
      highRiskBranchesDiscarded: 0,
    };
  }
  if (requiredBranches > input.bounds.maxBranches) {
    return {
      status: "BOUNDED_INCOMPLETE",
      branches: [],
      requiredBranches,
      issues: [{ code: "MAX_BRANCHES_EXCEEDED", message: `All ${requiredBranches} branches are required but maxBranches is ${input.bounds.maxBranches}; simulation failed closed before pruning.`, nodeRef: null }],
      highRiskBranchesDiscarded: 0,
    };
  }
  const assumptions: BranchAssumption[][] = [[]];
  for (const variable of variables) {
    const next: BranchAssumption[][] = [];
    for (const current of assumptions) for (const outcome of [...variable.possibleOutcomes].sort((left, right) => left.outcomeId.localeCompare(right.outcomeId))) {
      next.push([...current, {
        variableId: variable.id,
        outcomeId: outcome.outcomeId,
        value: structuredClone(outcome.value),
        operationalStatus: outcome.operationalStatus,
        risk: outcome.risk,
        recovery: outcome.recovery ? structuredClone(outcome.recovery) : null,
      }]);
    }
    assumptions.splice(0, assumptions.length, ...next);
  }
  const branchAssumptions = assumptions.length === 0 ? [[]] : assumptions;
  return {
    status: "EXPANDED",
    branches: branchAssumptions.map((selected) => forkWorld({ snapshot: input.snapshot, variables, assumptions: selected, parent: input.parent })),
    requiredBranches,
    issues: [],
    highRiskBranchesDiscarded: 0,
  };
}
