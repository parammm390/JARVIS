import type {
  CompletionEvidence,
  EvidenceClass,
  TraceEdge,
  TraceNode,
  TraceValidationIssue,
  TraceValidationResult,
  TraceValidity,
} from "./contracts";

const ORDERED_EDGE_KINDS = new Set<TraceEdge["kind"]>(["CONTROL", "CAUSAL", "OBSERVATION", "AUTHORITY", "RETRY", "COMPENSATION", "TEMPORAL"]);

function graphHasCycle(nodes: TraceNode[], edges: TraceEdge[]): boolean {
  const ids = new Set(nodes.map((node) => node.nodeId));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === "TEMPORAL" && edge.certainty === "MISSING") continue;
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (complete.has(id)) return false;
    active.add(id);
    for (const child of adjacency.get(id) ?? []) if (visit(child)) return true;
    active.delete(id);
    complete.add(id);
    return false;
  };
  return [...ids].sort().some(visit);
}

function classifyCompletion(nodes: TraceNode[], completion: CompletionEvidence): TraceValidity {
  const verifiedTerminal = nodes.some((node) =>
    (node.semanticKind === "VERIFICATION" || node.semanticKind === "SUCCESS_CONDITION")
      && node.outcome.status === "SUCCEEDED"
      && node.outcome.verified);
  const unresolvedConsequential = nodes.some((node) => node.operation.consequential
    && (node.outcome.status === "AMBIGUOUS" || node.outcome.status === "UNKNOWN"
      || (node.outcome.status === "SUCCEEDED" && !node.outcome.verified && node.semanticKind !== "AUTHORITY_GATE" && node.semanticKind !== "APPROVAL_GATE")));
  const anySuccess = nodes.some((node) => node.outcome.status === "SUCCEEDED");
  const anyFailure = nodes.some((node) => node.outcome.status === "FAILED" || node.outcome.status === "BLOCKED");
  const partial = completion.effectVerifications.includes("PARTIALLY_VERIFIED")
    || nodes.some((node) => node.outcome.status === "PARTIAL")
    || (anySuccess && anyFailure);
  const allEffectsVerified = completion.effectVerifications.every((state) => state === "VERIFIED" || state === "NOT_APPLICABLE");
  const workComplete = completion.workStatus === "completed" || completion.workStatus === "succeeded" || completion.workStatus === "verified";
  const objectiveComplete = completion.objectiveVerification === "VERIFIED" || completion.objectiveVerification === "NOT_APPLICABLE";

  if (completion.explicitlyIncomplete) return "INCOMPLETE";
  if (completion.ambiguousExternalOutcome || (completion.providerAcknowledged && !verifiedTerminal && !allEffectsVerified)) return "AMBIGUOUS";
  if (completion.recovered && ((workComplete && objectiveComplete && allEffectsVerified && !unresolvedConsequential) || (verifiedTerminal && !unresolvedConsequential))) return "RECOVERED_SUCCESS";
  if (completion.terminalFailure && !verifiedTerminal && !completion.effectVerifications.includes("PARTIALLY_VERIFIED")) return "FAILURE";
  if (partial) return "PARTIAL_SUCCESS";
  if ((workComplete && objectiveComplete && allEffectsVerified && !unresolvedConsequential) || (verifiedTerminal && !unresolvedConsequential)) {
    return "SUCCESS";
  }
  if (anyFailure && !anySuccess) return "FAILURE";
  return "INCOMPLETE";
}

export function validateNormalizedTrace(
  nodes: TraceNode[],
  edges: TraceEdge[],
  completion: CompletionEvidence,
  evidenceClasses: EvidenceClass[],
  tenantMismatch = false,
): TraceValidationResult {
  const issues: TraceValidationIssue[] = [];
  const nodeIds = nodes.map((node) => node.nodeId);
  const uniqueNodeIds = new Set(nodeIds);
  if (uniqueNodeIds.size !== nodeIds.length) issues.push({ code: "DUPLICATE_NODE_ID", nodeId: null, edgeId: null, consequential: true });
  if (tenantMismatch) issues.push({ code: "CROSS_TENANT_EVENT_IN_TRACE", nodeId: null, edgeId: null, consequential: true });
  for (const edge of edges) {
    if (!uniqueNodeIds.has(edge.from) || !uniqueNodeIds.has(edge.to)) {
      issues.push({ code: "EDGE_ENDPOINT_MISSING", nodeId: null, edgeId: edge.edgeId, consequential: true });
      continue;
    }
    const from = nodes.find((node) => node.nodeId === edge.from)!;
    const to = nodes.find((node) => node.nodeId === edge.to)!;
    if (ORDERED_EDGE_KINDS.has(edge.kind) && Date.parse(from.timing.startedAt) > Date.parse(to.timing.startedAt)) {
      issues.push({ code: "CAUSAL_ORDER_VIOLATION", nodeId: to.nodeId, edgeId: edge.edgeId, consequential: true });
    }
  }
  if (graphHasCycle(nodes, edges)) issues.push({ code: "TRACE_GRAPH_CYCLE", nodeId: null, edgeId: null, consequential: true });
  for (const node of nodes) {
    if (!Number.isFinite(Date.parse(node.timing.startedAt))) issues.push({ code: "INVALID_NODE_TIME", nodeId: node.nodeId, edgeId: null, consequential: true });
    if (node.timing.endedAt && Date.parse(node.timing.endedAt) < Date.parse(node.timing.startedAt)) {
      issues.push({ code: "NEGATIVE_NODE_DURATION", nodeId: node.nodeId, edgeId: null, consequential: true });
    }
    for (const value of [...node.inputs, ...node.outputs]) {
      if (value.role === "DERIVED" && !value.provenance.complete) issues.push({ code: "DERIVED_VALUE_PROVENANCE_INCOMPLETE", nodeId: node.nodeId, edgeId: null, consequential: false });
    }
    if (node.modelDecision && node.modelDecision.hiddenReasoningPersisted !== false) issues.push({ code: "MODEL_CHAIN_OF_THOUGHT_PRESENT", nodeId: node.nodeId, edgeId: null, consequential: true });
    if (node.authorityContext.grantsAuthority !== false) issues.push({ code: "LEARNED_AUTHORITY_GRANT_PRESENT", nodeId: node.nodeId, edgeId: null, consequential: true });
  }

  const corrupt = issues.some((issue) => issue.consequential && [
    "DUPLICATE_NODE_ID", "CROSS_TENANT_EVENT_IN_TRACE", "EDGE_ENDPOINT_MISSING", "CAUSAL_ORDER_VIOLATION",
    "TRACE_GRAPH_CYCLE", "INVALID_NODE_TIME", "NEGATIVE_NODE_DURATION", "MODEL_CHAIN_OF_THOUGHT_PRESENT", "LEARNED_AUTHORITY_GRANT_PRESENT",
  ].includes(issue.code));
  const outcome = corrupt ? "CORRUPT" : classifyCompletion(nodes, completion);
  const realOnly = evidenceClasses.length > 0 && evidenceClasses.every((value) => value === "REAL_EXECUTION");
  const realSuccess = realOnly && (outcome === "SUCCESS" || outcome === "RECOVERED_SUCCESS");
  return {
    outcome,
    issues: issues.sort((left, right) => `${left.code}:${left.nodeId ?? ""}:${left.edgeId ?? ""}`.localeCompare(`${right.code}:${right.nodeId ?? ""}:${right.edgeId ?? ""}`)),
    trainingEligible: realSuccess,
    realSuccess,
  };
}
