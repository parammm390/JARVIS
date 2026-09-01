import type {
  CompileProcedureResult,
  ExecutionTrace,
  ProcedureCandidate,
  TraceAlignment,
  TraceCompilerOptions,
  TraceValidationResult,
  SourceIdentityMappings,
} from "./contracts";
import {
  ANTI_UNIFIER_VERSION,
  CANDIDATE_ID_PREFIX,
  PROCEDURE_CANDIDATE_VERSION,
  TRACE_COMPILER_VERSION,
} from "./contracts";
import { alignExecutionTraces, type AlignTraceOptions } from "./alignment";
import { mergeSourceIdentities, prefixedHash, stableUnique } from "./canonical";
import { buildProcedureStructure, inferControlAndSafety, inferenceContext, inferValues } from "./inference";
import { compareCandidateToTraces } from "./semantic-diff";
import { isPositiveRealTrace, isRealTrace, primaryEvidenceClass, supportMetrics } from "./support";

const NEGATIVE_STRUCTURAL_EVIDENCE_KINDS = new Set([
  "AUTHORITY_GATE",
  "APPROVAL_GATE",
  "OBSERVATION",
  "VERIFICATION",
  "SUCCESS_CONDITION",
  "RECONCILIATION",
  "COMPENSATION",
]);

function bodyGroupIds(traces: ExecutionTrace[], alignment: TraceAlignment): Set<string> {
  const positiveIds = new Set(traces.filter(isPositiveRealTrace).map((trace) => trace.traceId));
  if (positiveIds.size === 0) return new Set(alignment.groups.map((group) => group.groupId));
  return new Set(alignment.groups.filter((group) => group.members.some((member) => positiveIds.has(member.traceId))
    || NEGATIVE_STRUCTURAL_EVIDENCE_KINDS.has(group.semanticKind)).map((group) => group.groupId));
}

function restrictControlToBody(control: ReturnType<typeof inferControlAndSafety>, includedStepIds: ReadonlySet<string>) {
  const branches = control.branches.flatMap((branch) => {
    const arms = branch.arms.map((arm) => ({ ...arm, stepIds: arm.stepIds.filter((stepId) => includedStepIds.has(stepId)) }))
      .filter((arm) => arm.stepIds.length > 0);
    return arms.length >= 2 ? [{ ...branch, arms }] : [];
  });
  return {
    ...control,
    branches,
    loops: control.loops.map((loop) => ({ ...loop, bodyStepIds: loop.bodyStepIds.filter((stepId) => includedStepIds.has(stepId)) }))
      .filter((loop) => loop.bodyStepIds.length > 0),
    waits: control.waits.filter((item) => includedStepIds.has(item.stepId)),
    observations: control.observations.filter((item) => includedStepIds.has(item.stepId)),
    authorityRequirements: control.authorityRequirements.filter((item) => includedStepIds.has(item.stepId)),
    modelDecisions: control.modelDecisions.filter((item) => includedStepIds.has(item.stepId)),
    compensation: control.compensation.filter((item) => includedStepIds.has(item.stepId))
      .map((item) => ({ ...item, compensatesStepIds: item.compensatesStepIds.filter((stepId) => includedStepIds.has(stepId)) })),
    successConditions: control.successConditions.filter((item) => includedStepIds.has(item.stepId)),
  };
}

function traceValidation(trace: ExecutionTrace): TraceValidationResult {
  const consequentialCodes = new Set(["DUPLICATE_NODE_ID", "CROSS_TENANT_EVENT_IN_TRACE", "EDGE_ENDPOINT_MISSING", "CAUSAL_ORDER_VIOLATION", "TRACE_GRAPH_CYCLE"]);
  const issues = trace.provenance.uncertainty.map((code) => ({ code, nodeId: null, edgeId: null, consequential: consequentialCodes.has(code) }));
  const realSuccess = isPositiveRealTrace(trace);
  return { outcome: trace.outcome, issues, trainingEligible: realSuccess, realSuccess };
}

function plannedExecutionDivergences(traces: ExecutionTrace[]) {
  return traces.flatMap((trace) => {
    const planned = trace.operationIdentity.plannerIrSemanticHash;
    if (!planned) return [];
    const explicitlyDiverged = trace.provenance.uncertainty.includes("PLANNER_EXECUTION_DIVERGENCE")
      || (trace.provenance.sourceIdentities.operationalIrSemanticHashes.length > 0
        && !trace.provenance.sourceIdentities.operationalIrSemanticHashes.includes(planned));
    return explicitlyDiverged ? [{
      traceId: trace.traceId,
      plannedIrSemanticHash: planned,
      actualOperations: stableUnique(trace.nodes.map((node) => node.operation.equivalenceClass)),
    }] : [];
  }).sort((left, right) => left.traceId.localeCompare(right.traceId));
}

function opaqueSourceIdentityReferences(source: SourceIdentityMappings): SourceIdentityMappings {
  const opaque = (domain: string, value: string) => prefixedHash("p6:source-identity-ref:sha256:", { domain, value });
  return {
    workIds: source.workIds.map((value) => opaque("work", value)).sort(),
    businessEffectIds: source.businessEffectIds.map((value) => opaque("business_effect", value)).sort(),
    businessEffectSemanticHashes: source.businessEffectSemanticHashes.map((value) => opaque("business_effect_semantic_hash", value)).sort(),
    providerOperationIds: source.providerOperationIds.map((value) => opaque("provider_operation", value)).sort(),
    idempotencyKeys: source.idempotencyKeys.map((value) => opaque("idempotency_key", value)).sort(),
    operationalIrSemanticHashes: source.operationalIrSemanticHashes.map((value) => opaque("operational_ir", value)).sort(),
    p5SimulationTraceIds: source.p5SimulationTraceIds.map((value) => opaque("p5_simulation_trace", value)).sort(),
    commandIds: source.commandIds.map((value) => opaque("command", value)).sort(),
    workflowRunIds: source.workflowRunIds.map((value) => opaque("workflow_run", value)).sort(),
    workflowStepIds: source.workflowStepIds.map((value) => opaque("workflow_step", value)).sort(),
    decisionReceiptIds: source.decisionReceiptIds.map((value) => opaque("decision_receipt", value)).sort(),
    computerRunIds: source.computerRunIds.map((value) => opaque("computer_run", value)).sort(),
    queryExecutionIds: source.queryExecutionIds.map((value) => opaque("query_execution", value)).sort(),
    instructionIds: source.instructionIds.map((value) => opaque("instruction", value)).sort(),
    authorityDecisionIds: source.authorityDecisionIds.map((value) => opaque("authority_decision", value)).sort(),
    other: source.other.map((value) => ({ domain: "opaque_source", id: opaque(value.domain, value.id) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function candidateUncertainty(candidate: Omit<ProcedureCandidate, "candidateId" | "uncertainty">, traces: ExecutionTrace[], alignment: TraceAlignment): string[] {
  return stableUnique([
    ...(candidate.support.sampleQuality === "SINGLE_TRACE_HYPOTHESIS" ? ["SINGLE_TRACE_HYPOTHESIS"] : []),
    ...(candidate.support.contradictingTraceCount > 0 ? ["CONTRADICTORY_TRACE_EVIDENCE"] : []),
    ...(candidate.support.realExecution.supporting === 0 ? ["NO_REAL_SUCCESS_SUPPORT"] : []),
    ...(alignment.unmatched.some((row) => row.reason === "SAFETY_BOUNDARY_MISMATCH") ? ["SAFETY_BOUNDARY_DIFFERENCE_PRESERVED_CONSERVATIVELY"] : []),
    ...(candidate.retries.some((retry) => retry.classification === "UNKNOWN") ? ["UNSAFE_OR_UNRESOLVED_RETRY_NOT_AUTOMATED"] : []),
    ...(candidate.derivedValues.some((value) => !value.provenanceComplete) ? ["DERIVED_VALUE_PROVENANCE_INCOMPLETE"] : []),
    ...traces.flatMap((trace) => trace.provenance.uncertainty),
  ]);
}

export interface AntiUnifyOptions extends TraceCompilerOptions {
  crossTenantMode?: AlignTraceOptions["crossTenantMode"];
}

/** Computes a conservative least-general hypothesis. It returns data only. There is
 * intentionally no execute(), authorize(), persist(), planner-input, or certification
 * function in the package. */
export function antiUnifyExecutionTraces(traces: ExecutionTrace[], options: AntiUnifyOptions): CompileProcedureResult {
  if (traces.length === 0) throw new Error("At least one trace is required to induce a procedure");
  const ordered = [...traces].sort((left, right) => left.traceId.localeCompare(right.traceId));
  const alignment = alignExecutionTraces(ordered, {
    crossTenantMode: options.crossTenantMode,
    alignmentVersion: options.alignmentVersion,
  });
  const context = inferenceContext(ordered, alignment);
  const positiveReal = ordered.filter(isPositiveRealTrace);
  const negativeReal = ordered.filter((trace) => isRealTrace(trace) && !isPositiveRealTrace(trace));
  const simulated = ordered.filter((trace) => primaryEvidenceClass(trace) === "SIMULATED_EXECUTION");
  const replay = ordered.filter((trace) => primaryEvidenceClass(trace) === "REPLAY_FIXTURE");
  const includedGroupIds = bodyGroupIds(ordered, alignment);
  const includedStepIds = new Set(alignment.groups.filter((group) => includedGroupIds.has(group.groupId))
    .map((group) => prefixedHash("p6:procedure-step:sha256:", { alignmentId: alignment.alignmentId, groupId: group.groupId })));
  const values = inferValues(context, includedGroupIds);
  const control = restrictControlToBody(inferControlAndSafety(context), includedStepIds);
  const programStructure = buildProcedureStructure(context, values, control, includedGroupIds);
  const supporting = positiveReal.length > 0 ? positiveReal : replay.length > 0 ? replay : simulated;
  const sourceIdentities = mergeSourceIdentities(...ordered.map((trace) => trace.provenance.sourceIdentities));
  const sourceIdentityRefs = opaqueSourceIdentityReferences(sourceIdentities);
  const unsupportedKinds = new Set(["INSTRUCTION", "WORK_TRANSITION", "MODEL_DECISION", "FAILURE"]);
  const candidateWithoutIdentityAndUncertainty: Omit<ProcedureCandidate, "candidateId" | "uncertainty"> = {
    version: PROCEDURE_CANDIDATE_VERSION,
    artifactKind: "PROCEDURE_CANDIDATE",
    executionStatus: "NON_EXECUTABLE_HYPOTHESIS",
    certificationStatus: "UNCERTIFIED_P6_HYPOTHESIS",
    goalPattern: {
      semanticGoal: `GoalPattern(${stableUnique(ordered.map((trace) => trace.operationIdentity.semanticOperation)).join("|")})`,
      operation: ordered[0]!.operationIdentity.semanticOperation,
    },
    parameters: values.parameters,
    constants: values.constants,
    derivedValues: values.derivedValues,
    programStructure,
    predicates: control.predicates,
    branches: control.branches,
    loops: control.loops,
    retries: control.retries,
    waits: control.waits,
    observations: control.observations,
    authorityRequirements: control.authorityRequirements,
    modelDecisions: control.modelDecisions,
    compensation: control.compensation,
    successConditions: control.successConditions,
    evidence: {
      positiveRealTraceIds: positiveReal.map((trace) => trace.traceId),
      negativeRealTraceIds: negativeReal.map((trace) => trace.traceId),
      simulatedStructuralTraceIds: simulated.map((trace) => trace.traceId),
      replayFixtureTraceIds: replay.map((trace) => trace.traceId),
      alignmentId: alignment.alignmentId,
      sourceIdentities: sourceIdentityRefs,
      plannedExecutionDivergences: plannedExecutionDivergences(ordered),
      negativeOnlyExcludedOperations: alignment.groups.filter((group) => !includedGroupIds.has(group.groupId)
        && group.members.every((member) => negativeReal.some((trace) => trace.traceId === member.traceId)))
        .map((group) => ({
          operation: group.operation,
          semanticKind: group.semanticKind,
          traceIds: stableUnique(group.members.map((member) => member.traceId)),
          reason: "NEGATIVE_ONLY_NOT_POSITIVE_PROCEDURE_BODY" as const,
        }))
        .sort((left, right) => `${left.operation}:${left.semanticKind}`.localeCompare(`${right.operation}:${right.semanticKind}`)),
    },
    support: supportMetrics(ordered, supporting.map((trace) => trace.traceId), negativeReal.map((trace) => trace.traceId)),
    provenance: {
      compilerVersion: TRACE_COMPILER_VERSION,
      normalizerVersion: options.normalizerVersion ?? ordered[0]!.provenance.compiler.normalizerVersion,
      alignmentVersion: options.alignmentVersion ?? alignment.algorithmVersion,
      antiUnifierVersion: options.antiUnifierVersion ?? ANTI_UNIFIER_VERSION,
      seed: options.seed,
      fixedClock: options.fixedClock,
      crossTenantAnonymized: alignment.tenantScope === "ANONYMIZED_CROSS_TENANT",
      rawPrivateValuesPersisted: false,
      sourceIdentityValuesOpaque: true,
      realAndSyntheticSupportSeparated: true,
    },
    operationalIrCompatibility: {
      convertibleStepIds: programStructure.steps.filter((step) => !unsupportedKinds.has(step.semanticKind)).map((step) => step.stepId).sort(),
      unsupportedStepIds: programStructure.steps.filter((step) => unsupportedKinds.has(step.semanticKind)).map((step) => step.stepId).sort(),
      automaticPlannerInput: false,
    },
  };
  const uncertainty = candidateUncertainty(candidateWithoutIdentityAndUncertainty, ordered, alignment);
  const candidateBody = { ...candidateWithoutIdentityAndUncertainty, uncertainty };
  const candidate: ProcedureCandidate = {
    ...candidateBody,
    candidateId: prefixedHash(CANDIDATE_ID_PREFIX, candidateBody),
  };
  const allSourceIds = new Set([
    ...sourceIdentities.workIds,
    ...sourceIdentities.businessEffectIds,
    ...sourceIdentities.businessEffectSemanticHashes,
    ...sourceIdentities.providerOperationIds,
    ...sourceIdentities.idempotencyKeys,
    ...sourceIdentities.operationalIrSemanticHashes,
    ...sourceIdentities.p5SimulationTraceIds,
  ]);
  if (allSourceIds.has(candidate.candidateId)) throw new Error("P6 candidate identity collided with an authoritative source identity");
  const semanticDiff = compareCandidateToTraces(candidate, ordered, alignment);
  return {
    candidate,
    alignment,
    semanticDiff,
    traceValidation: ordered.map((trace) => ({ traceId: trace.traceId, validation: traceValidation(trace) })),
  };
}
