import type {
  DataflowReconstructionResult,
  TraceEdge,
  TraceNode,
  TraceValue,
  TraceValueBinding,
} from "./contracts";
import { prefixedHash } from "./canonical";

function nodeTime(node: TraceNode): number {
  return Date.parse(node.timing.startedAt);
}

function derivationFor(value: TraceValue): TraceValueBinding["derivation"] {
  if (value.role === "LOOKUP_RESULT") return "LOOKUP";
  if (value.role === "EXTERNAL_OBSERVATION") return "OBSERVATION";
  if (value.role === "DERIVED") return "EXPLICIT_TRANSFORM";
  return "IDENTITY";
}

function mergeDataEdges(edges: TraceEdge[]): TraceEdge[] {
  const grouped = new Map<string, TraceEdge[]>();
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.certainty}`;
    grouped.set(key, [...(grouped.get(key) ?? []), edge]);
  }
  return [...grouped.values()].map((group) => {
    const first = group[0]!;
    const bindings = group.flatMap((edge) => edge.valueBindings)
      .sort((left, right) => `${left.fromValueId}:${left.toValueId}`.localeCompare(`${right.fromValueId}:${right.toValueId}`))
      .filter((binding, index, values) => index === 0
        || binding.fromValueId !== values[index - 1]!.fromValueId
        || binding.toValueId !== values[index - 1]!.toValueId);
    const evidenceIds = [...new Set(group.flatMap((edge) => edge.evidenceIds))].sort();
    return {
      ...first,
      edgeId: prefixedHash("p6:edge:sha256:", { from: first.from, to: first.to, kind: first.kind, certainty: first.certainty, bindings }),
      valueBindings: bindings,
      evidenceIds,
    };
  }).sort((left, right) => `${left.from}:${left.to}:${left.kind}:${left.edgeId}`.localeCompare(`${right.from}:${right.to}:${right.kind}:${right.edgeId}`));
}

/**
 * Reconstructs only equality bindings with one unambiguous prior producer. Similar
 * spelling, edit distance, array position, and coincidental numeric proximity are
 * never evidence of dataflow.
 */
export function reconstructDataflow(nodes: TraceNode[], existingEdges: TraceEdge[]): DataflowReconstructionResult {
  const explicitData = existingEdges.filter((edge) => edge.kind === "DATA");
  const existingTargets = new Set(explicitData.flatMap((edge) => edge.valueBindings.map((binding) => binding.toValueId)));
  const inferred: TraceEdge[] = [];
  const ordered = [...nodes].sort((left, right) => nodeTime(left) - nodeTime(right) || left.nodeId.localeCompare(right.nodeId));

  for (const consumer of ordered) {
    for (const input of consumer.inputs) {
      if (!input.equalityToken || existingTargets.has(input.valueId)) continue;
      const candidates = ordered.flatMap((producer) => {
        if (producer.nodeId === consumer.nodeId || nodeTime(producer) > nodeTime(consumer)) return [];
        return producer.outputs
          .filter((output) => output.equalityToken === input.equalityToken && output.semanticType === input.semanticType)
          .map((output) => ({ producer, output }));
      });
      if (candidates.length !== 1) continue;
      const match = candidates[0]!;
      const binding: TraceValueBinding = {
        fromValueId: match.output.valueId,
        toValueId: input.valueId,
        derivation: derivationFor(input),
        ruleRef: input.provenance.derivationRule
          ? `${input.provenance.derivationRule.id}@${input.provenance.derivationRule.version}`
          : null,
      };
      inferred.push({
        edgeId: prefixedHash("p6:edge:sha256:", { from: match.producer.nodeId, to: consumer.nodeId, kind: "DATA", binding }),
        from: match.producer.nodeId,
        to: consumer.nodeId,
        kind: "DATA",
        valueBindings: [binding],
        certainty: "INFERRED",
        evidenceIds: [...new Set([...match.output.provenance.evidenceIds, ...input.provenance.evidenceIds])].sort(),
      });
    }
  }

  const edges = mergeDataEdges([...existingEdges, ...inferred]);
  return {
    edges,
    explicitBindings: explicitData.reduce((total, edge) => total + edge.valueBindings.length, 0),
    equalityBindings: inferred.length,
    unresolvedDerivedValues: nodes.flatMap((node) => [...node.inputs, ...node.outputs]
      .filter((value) => value.role === "DERIVED" && !value.provenance.complete)
      .map((value) => value.valueId)).sort(),
    deterministic: true,
  };
}

export function traceBoundaryValues(nodes: TraceNode[], edges: TraceEdge[]): { inputs: TraceValue[]; outputs: TraceValue[] } {
  const boundInputs = new Set(edges.flatMap((edge) => edge.kind === "DATA" ? edge.valueBindings.map((binding) => binding.toValueId) : []));
  const consumedOutputs = new Set(edges.flatMap((edge) => edge.kind === "DATA" ? edge.valueBindings.map((binding) => binding.fromValueId) : []));
  const inputs = nodes.flatMap((node) => node.inputs).filter((value) => !boundInputs.has(value.valueId));
  const outputs = nodes.flatMap((node) => node.outputs).filter((value) => !consumedOutputs.has(value.valueId));
  const stable = (values: TraceValue[]) => values.sort((left, right) => `${left.path}:${left.valueId}`.localeCompare(`${right.path}:${right.valueId}`));
  return { inputs: stable(inputs), outputs: stable(outputs) };
}
