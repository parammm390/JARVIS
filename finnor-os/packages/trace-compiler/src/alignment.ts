import type {
  AlignmentGroup,
  ExecutionTrace,
  TraceAlignment,
  TraceCompilerOptions,
  TraceNode,
  TraceNodeSemanticKind,
  UnmatchedAlignmentNode,
} from "./contracts";
import { ALIGNMENT_ID_PREFIX, ALIGNMENT_VERSION } from "./contracts";
import { prefixedHash, stableUnique } from "./canonical";
import { procedureRepresentationSafe } from "./redaction";

function kindClass(node: TraceNode): string {
  if (["ACTION", "PROVIDER_OPERATION", "COMPUTER_OPERATION", "RETRY_ATTEMPT"].includes(node.semanticKind)) return "OPERATION";
  if (["OBSERVATION", "VERIFICATION", "SUCCESS_CONDITION"].includes(node.semanticKind)) return node.semanticKind;
  return node.semanticKind;
}

function representativeKind(nodes: TraceNode[]): TraceNodeSemanticKind {
  const priority: TraceNodeSemanticKind[] = [
    "AUTHORITY_GATE", "APPROVAL_GATE", "SUCCESS_CONDITION", "VERIFICATION", "OBSERVATION",
    "COMPENSATION", "RECONCILIATION", "WAIT", "BRANCH_DECISION", "LOOP_ITERATION",
    "RETRY_ATTEMPT", "COMPUTER_OPERATION", "PROVIDER_OPERATION", "ACTION", "QUERY",
    "MODEL_DECISION", "INSTRUCTION", "WORK_TRANSITION", "FAILURE",
  ];
  return priority.find((kind) => nodes.some((node) => node.semanticKind === kind)) ?? nodes[0]!.semanticKind;
}

function looseKey(node: TraceNode): string {
  return [kindClass(node), node.operation.equivalenceClass, node.operation.effectClass ?? "none"].join("|");
}

function semanticKey(node: TraceNode): string {
  const inputTypes = stableUnique(node.inputs.map((value) => value.semanticType));
  const outputTypes = stableUnique(node.outputs.map((value) => value.semanticType));
  const observations = stableUnique(node.observations.map((observation) => `${observation.kind}:${observation.subject}:${observation.externalRealityRequired}`));
  const safetyBoundary = {
    consequential: node.operation.consequential,
    kind: kindClass(node),
    authorityGate: node.semanticKind === "AUTHORITY_GATE" || node.semanticKind === "APPROVAL_GATE",
    externalObservation: node.observations.some((observation) => observation.externalRealityRequired),
    compensation: node.semanticKind === "COMPENSATION",
  };
  return prefixedHash("p6:semantic-alignment-key:sha256:", {
    loose: looseKey(node),
    inputTypes,
    outputTypes,
    observations,
    safetyBoundary,
    waitKind: node.wait?.kind ?? null,
    branchFamily: node.branch?.family ?? null,
    modelPurpose: node.modelDecision?.purpose ?? null,
  });
}

function privateValuesAreSemantic(trace: ExecutionTrace): boolean {
  return trace.nodes.every((node) => [...node.inputs, ...node.outputs]
    .every((value) => procedureRepresentationSafe(value.representation, value.sensitivity)));
}

export interface AlignTraceOptions {
  crossTenantMode?: "FORBID" | "ANONYMIZED";
  alignmentVersion?: string;
}

/**
 * Deterministic structural alignment. Nodes align by semantic operation/effect,
 * typed data interface, observation role, and safety boundary. Array position,
 * provider SDK method names, timestamps, and raw literal similarity are excluded.
 */
export function alignExecutionTraces(traces: ExecutionTrace[], options: AlignTraceOptions = {}): TraceAlignment {
  if (traces.length === 0) throw new Error("At least one trace is required for alignment");
  const ordered = [...traces].sort((left, right) => left.traceId.localeCompare(right.traceId));
  if (new Set(ordered.map((trace) => trace.traceId)).size !== ordered.length) throw new Error("Duplicate trace identities cannot be aligned as independent evidence");
  const operations = stableUnique(ordered.map((trace) => trace.operationIdentity.semanticOperation));
  if (operations.length !== 1) throw new Error(`Trace operation identities differ: ${operations.join(", ")}`);
  const tenants = stableUnique(ordered.map((trace) => trace.tenantId));
  const crossTenant = tenants.length > 1;
  if (crossTenant && options.crossTenantMode !== "ANONYMIZED") throw new Error("Cross-tenant alignment requires explicit semantic anonymization");
  if (crossTenant && !ordered.every(privateValuesAreSemantic)) throw new Error("Cross-tenant alignment contains a private literal");

  const grouped = new Map<string, Array<{ trace: ExecutionTrace; node: TraceNode }>>();
  const loose = new Map<string, Set<string>>();
  for (const trace of ordered) {
    for (const node of trace.nodes) {
      const key = semanticKey(node);
      grouped.set(key, [...(grouped.get(key) ?? []), { trace, node }]);
      const looseNodeKey = looseKey(node);
      const values = loose.get(looseNodeKey) ?? new Set<string>();
      values.add(key);
      loose.set(looseNodeKey, values);
    }
  }

  const groups: AlignmentGroup[] = [...grouped.entries()].map(([key, rows]) => {
    const byTrace = new Map<string, string[]>();
    for (const row of rows) byTrace.set(row.trace.traceId, [...(byTrace.get(row.trace.traceId) ?? []), row.node.nodeId]);
    const members = [...byTrace.entries()].map(([traceId, nodeIds]) => ({
      traceId: traceId as ExecutionTrace["traceId"],
      nodeIds: nodeIds.sort(),
    })).sort((left, right) => left.traceId.localeCompare(right.traceId));
    const nodes = rows.map((row) => row.node);
    return {
      groupId: prefixedHash("p6:alignment-group:sha256:", { key, members }),
      semanticKey: key,
      semanticKind: representativeKind(nodes),
      operation: stableUnique(nodes.map((node) => node.operation.equivalenceClass))[0]!,
      members,
      supportingTraceCount: members.length,
      optional: members.length < ordered.length,
      repeatedWithinTrace: members.some((member) => member.nodeIds.length > 1),
      safetyCritical: nodes.some((node) => node.operation.consequential
        || node.authorityContext.requirementObserved
        || node.observations.some((observation) => observation.externalRealityRequired)
        || ["AUTHORITY_GATE", "APPROVAL_GATE", "COMPENSATION", "VERIFICATION", "SUCCESS_CONDITION"].includes(node.semanticKind)),
    };
  }).sort((left, right) => `${left.operation}:${left.semanticKind}:${left.groupId}`.localeCompare(`${right.operation}:${right.semanticKind}:${right.groupId}`));

  const unmatched: UnmatchedAlignmentNode[] = [];
  for (const group of groups.filter((candidate) => candidate.supportingTraceCount < ordered.length)) {
    const groupRows = grouped.get(group.semanticKey) ?? [];
    const boundaryMismatch = groupRows.some((row) => (loose.get(looseKey(row.node))?.size ?? 0) > 1);
    for (const member of group.members) for (const nodeId of member.nodeIds) unmatched.push({
      traceId: member.traceId,
      nodeId,
      reason: boundaryMismatch ? "SAFETY_BOUNDARY_MISMATCH" : "NO_SEMANTIC_PEER",
    });
  }
  unmatched.sort((left, right) => `${left.traceId}:${left.nodeId}`.localeCompare(`${right.traceId}:${right.nodeId}`));

  const body = {
    tenantScope: crossTenant ? "ANONYMIZED_CROSS_TENANT" as const : "SINGLE_TENANT" as const,
    traceIds: ordered.map((trace) => trace.traceId),
    groups,
    unmatched,
    algorithmVersion: options.alignmentVersion ?? ALIGNMENT_VERSION,
  };
  return {
    version: 1,
    alignmentId: prefixedHash(ALIGNMENT_ID_PREFIX, body),
    ...body,
    deterministic: true,
  };
}

export function alignmentOptionsFromCompiler(options: TraceCompilerOptions): AlignTraceOptions {
  return { alignmentVersion: options.alignmentVersion ?? ALIGNMENT_VERSION };
}
