import type {
  ExecutionTrace,
  ProcedureCandidate,
  ProcedureSemanticDiff,
  SemanticDiffDimension,
  TraceAlignment,
} from "./contracts";
import { isPositiveRealTrace, isRealTrace } from "./support";
import { stableUnique } from "./canonical";

const DIMENSIONS: SemanticDiffDimension[] = [
  "goal", "parameters", "constants", "dataflow", "operations", "dependencies", "branches", "loops", "retries",
  "waits", "authority", "effects", "observations", "success_conditions", "compensation",
];

function defaultDimensions(): ProcedureSemanticDiff["dimensions"] {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, "PRESERVED"])) as ProcedureSemanticDiff["dimensions"];
}

export function compareCandidateToTraces(
  candidate: ProcedureCandidate,
  traces: ExecutionTrace[],
  alignment: TraceAlignment,
): ProcedureSemanticDiff {
  const dimensions = defaultDimensions();
  const reasons: string[] = [];
  if (traces.some((trace) => trace.outcome === "CORRUPT")) {
    return {
      classification: "FIXTURE_INVALID",
      dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, "UNSUPPORTED"])) as ProcedureSemanticDiff["dimensions"],
      reasonCodes: ["CORRUPT_SOURCE_TRACE"],
      consequentialGateRemovals: 0,
      authorityRequirementRemovals: 0,
      observationRequirementRemovals: 0,
      verificationRequirementRemovals: 0,
      recoveryEdgeRemovals: 0,
    };
  }
  const candidateOperations = new Set(candidate.programStructure.steps.map((step) => step.equivalenceClass));
  const includedGroups = new Set(candidate.programStructure.steps.map((step) => step.sourceAlignmentGroupId));
  const groupByNode = new Map<string, string>();
  for (const group of alignment.groups) for (const member of group.members) for (const nodeId of member.nodeIds) groupByNode.set(nodeId, group.groupId);
  const includedNodes = traces.flatMap((trace) => trace.nodes.filter((node) => includedGroups.has(groupByNode.get(node.nodeId) ?? "")));
  const sourceOperations = new Set(includedNodes.map((node) => node.operation.equivalenceClass));
  const missingOperations = [...sourceOperations].filter((operation) => !candidateOperations.has(operation));
  if (missingOperations.length > 0) {
    dimensions.operations = "MISSING";
    reasons.push("SOURCE_OPERATIONS_MISSING");
  }

  const stepByGroup = new Map(candidate.programStructure.steps.map((step) => [step.sourceAlignmentGroupId, step]));
  const candidateEdges = new Set(candidate.programStructure.edges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.kind}`));
  let missingDependencies = 0;
  let missingDataflow = 0;
  for (const trace of traces) for (const edge of trace.edges) {
    const from = stepByGroup.get(groupByNode.get(edge.from) ?? "")?.stepId;
    const to = stepByGroup.get(groupByNode.get(edge.to) ?? "")?.stepId;
    if (!from || !to || from === to) continue;
    if (!candidateEdges.has(`${from}\u0000${to}\u0000${edge.kind}`)) {
      if (edge.kind === "DATA") missingDataflow += 1;
      else if (["CONTROL", "CAUSAL", "AUTHORITY", "OBSERVATION", "COMPENSATION", "RETRY"].includes(edge.kind)) missingDependencies += 1;
    }
  }
  if (missingDataflow > 0) { dimensions.dataflow = "MISSING"; reasons.push("DATAFLOW_BINDINGS_MISSING"); }
  if (missingDependencies > 0) { dimensions.dependencies = "MISSING"; reasons.push("DEPENDENCIES_MISSING"); }

  const sourceAuthorityNodes = includedNodes.filter((node) => node.authorityContext.requirementObserved
    || node.semanticKind === "AUTHORITY_GATE" || node.semanticKind === "APPROVAL_GATE");
  const candidateAuthoritySteps = new Set(candidate.authorityRequirements.map((requirement) => requirement.stepId));
  const authorityRequirementRemovals = sourceAuthorityNodes.filter((node) => {
    const step = stepByGroup.get(groupByNode.get(node.nodeId) ?? "");
    return !step || !candidateAuthoritySteps.has(step.stepId);
  }).length;
  if (authorityRequirementRemovals > 0) { dimensions.authority = "MISSING"; reasons.push("AUTHORITY_REQUIREMENT_REMOVED"); }
  else if (candidate.authorityRequirements.some((requirement) => requirement.support.coverage.numerator < requirement.support.coverage.denominator)) dimensions.authority = "STRICTER";

  const sourceExternalObservations = includedNodes.flatMap((node) => node.observations
    .filter((observation) => observation.externalRealityRequired).map((observation) => ({ node, observation })));
  const candidateObservationSteps = new Set(candidate.observations.filter((observation) => observation.externalRealityRequired).map((observation) => observation.stepId));
  const observationRequirementRemovals = sourceExternalObservations.filter(({ node }) => {
    const step = stepByGroup.get(groupByNode.get(node.nodeId) ?? "");
    return !step || !candidateObservationSteps.has(step.stepId);
  }).length;
  if (observationRequirementRemovals > 0) { dimensions.observations = "MISSING"; reasons.push("EXTERNAL_OBSERVATION_REMOVED"); }

  const sourceConsequential = includedNodes.filter((node) => node.operation.consequential);
  const candidateConsequentialGroups = new Set(candidate.programStructure.steps.filter((step) => step.consequential).map((step) => step.sourceAlignmentGroupId));
  const consequentialGateRemovals = sourceConsequential.filter((node) => !candidateConsequentialGroups.has(groupByNode.get(node.nodeId) ?? "")).length;
  if (consequentialGateRemovals > 0) { dimensions.effects = "MISSING"; reasons.push("CONSEQUENTIAL_EFFECT_REMOVED"); }

  const sourceRecoveryEdges = traces.flatMap((trace) => trace.edges.filter((edge) => (edge.kind === "COMPENSATION" || edge.kind === "RETRY")
    && includedGroups.has(groupByNode.get(edge.from) ?? "") && includedGroups.has(groupByNode.get(edge.to) ?? "")));
  const candidateRecoveryEdges = new Set(candidate.programStructure.edges.filter((edge) => edge.kind === "COMPENSATION" || edge.kind === "RETRY")
    .map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.kind}`));
  const recoveryEdgeRemovals = sourceRecoveryEdges.filter((edge) => {
    const from = stepByGroup.get(groupByNode.get(edge.from) ?? "")?.stepId;
    const to = stepByGroup.get(groupByNode.get(edge.to) ?? "")?.stepId;
    return from && to && from !== to && !candidateRecoveryEdges.has(`${from}\u0000${to}\u0000${edge.kind}`);
  }).length;
  if (recoveryEdgeRemovals > 0) { dimensions.compensation = "MISSING"; reasons.push("RECOVERY_EDGE_REMOVED"); }

  const branchArms = new Map<string, Set<string>>();
  for (const trace of traces) for (const node of trace.nodes) if (node.branch && includedGroups.has(groupByNode.get(node.nodeId) ?? "")) {
    const arms = branchArms.get(node.branch.family) ?? new Set<string>();
    arms.add(node.branch.arm);
    branchArms.set(node.branch.family, arms);
  }
  const sourceBranchFamilies = new Set([...branchArms].filter(([, arms]) => arms.size >= 2).map(([family]) => family));
  if (sourceBranchFamilies.size > candidate.branches.length && candidate.branches.length === 0 && sourceBranchFamilies.size > 0) dimensions.branches = "UNSUPPORTED";
  const sourceLoopFamilies = new Set(includedNodes.flatMap((node) => node.loop ? [node.loop.family] : []));
  if (sourceLoopFamilies.size > 0 && candidate.loops.length === 0) dimensions.loops = "UNSUPPORTED";
  const sourceRetryFamilies = new Set(includedNodes.flatMap((node) => node.retry && node.retry.attempt > 1 ? [node.retry.family] : []));
  if (sourceRetryFamilies.size > 0 && candidate.retries.length === 0) dimensions.retries = "UNSUPPORTED";
  const sourceWaits = includedNodes.filter((node) => node.wait);
  if (sourceWaits.length > 0 && candidate.waits.length === 0) dimensions.waits = "MISSING";
  const sourceSuccess = includedNodes.filter((node) => node.semanticKind === "SUCCESS_CONDITION" || (node.semanticKind === "VERIFICATION" && node.outcome.verified));
  const candidateSuccessSteps = new Set(candidate.successConditions.map((condition) => condition.stepId));
  const verificationRequirementRemovals = sourceSuccess.filter((node) => {
    const step = stepByGroup.get(groupByNode.get(node.nodeId) ?? "");
    return !step || !candidateSuccessSteps.has(step.stepId);
  }).length;
  if (verificationRequirementRemovals > 0) {
    dimensions.success_conditions = "MISSING";
    reasons.push("VERIFICATION_REQUIREMENT_REMOVED");
  }
  const sourceCompensation = includedNodes.filter((node) => node.semanticKind === "COMPENSATION");
  if (sourceCompensation.length > 0 && candidate.compensation.length === 0) dimensions.compensation = "MISSING";

  const accountedSlots = candidate.parameters.length + candidate.constants.length + candidate.derivedValues.length;
  const sourceSlots = new Set(includedNodes.flatMap((node) => node.inputs.map((value) => `${node.operation.equivalenceClass}:${value.path}:${value.semanticType}`)));
  if (sourceSlots.size > 0 && accountedSlots === 0) dimensions.parameters = "MISSING";
  if (candidate.constants.some((constant) => constant.support.sampleQuality === "SINGLE_TRACE_HYPOTHESIS")) {
    dimensions.constants = "UNSUPPORTED";
    reasons.push("SINGLE_TRACE_CONSTANT_CLAIM");
  }
  if (candidate.goalPattern.operation !== traces[0]?.operationIdentity.semanticOperation) dimensions.goal = "MISSING";

  const safetyRemoval = consequentialGateRemovals + authorityRequirementRemovals + observationRequirementRemovals
    + verificationRequirementRemovals + recoveryEdgeRemovals;
  const unsupported = Object.values(dimensions).includes("UNSUPPORTED");
  const ordinaryMissing = Object.values(dimensions).includes("MISSING");
  const stricter = Object.values(dimensions).includes("STRICTER");
  const noRealPositive = !traces.some(isPositiveRealTrace);
  let classification: ProcedureSemanticDiff["classification"];
  if (safetyRemoval > 0) classification = "OVER_GENERALIZED";
  else if (noRealPositive) classification = "UNSUPPORTED";
  else if (unsupported) classification = "UNSUPPORTED";
  else if (ordinaryMissing) classification = "UNDER_GENERALIZED";
  else if (stricter) classification = "STRICTER_SAFE";
  else classification = "FAITHFUL_GENERALIZATION";
  return {
    classification,
    dimensions,
    reasonCodes: stableUnique(reasons),
    consequentialGateRemovals,
    authorityRequirementRemovals,
    observationRequirementRemovals,
    verificationRequirementRemovals,
    recoveryEdgeRemovals,
  };
}
