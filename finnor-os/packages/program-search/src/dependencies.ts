import {
  analyzeProgramGraph,
  canonicalSerialize,
  canonicalizeIrFragment,
  composeOperationalProgramEffects,
  graphCycles,
  inferExecutableNodeEffects,
  type AtomicTypedEffect,
  type OperationalProgram,
  type ProgramEffectSummary,
} from "@finnor/operational-ir";
import type {
  DependencyRelation,
  DependencyRelationKind,
  PartialOrderPlan,
} from "./contracts";

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function relationKey(relation: DependencyRelation): string {
  return `${relation.from}\u0000${relation.to}\u0000${relation.relation}\u0000${relation.source}`;
}

function resourceKey(effect: AtomicTypedEffect): string | null {
  if (effect.dimension === "READ" || effect.dimension === "WRITE") {
    const resource = effect.access.resource;
    return stable({
      kind: resource.kind,
      type: resource.type,
      selector: resource.selector,
      entityRef: resource.entityRef ?? null,
      id: resource.id ?? null,
    });
  }
  if (effect.dimension === "EXTERNAL") return stable({ system: effect.mutation.system, resource: effect.mutation.resource });
  if (effect.dimension === "FINANCIAL") return stable(effect.financial.resource);
  if (effect.dimension === "COMPUTER") return stable({ application: effect.mutation.application, resource: effect.mutation.resource });
  return null;
}

function effectsByNode(summary: ProgramEffectSummary): Map<string, AtomicTypedEffect[]> {
  const result = new Map<string, AtomicTypedEffect[]>();
  for (const entry of summary.possible) {
    const values = result.get(entry.effect.nodeId) ?? [];
    values.push(entry.effect);
    result.set(entry.effect.nodeId, values);
  }
  return result;
}

function conflictingResources(left: AtomicTypedEffect[], right: AtomicTypedEffect[]): string[] {
  const conflicts = new Set<string>();
  for (const leftEffect of left) for (const rightEffect of right) {
    const leftResource = resourceKey(leftEffect);
    const rightResource = resourceKey(rightEffect);
    if (!leftResource || leftResource !== rightResource) continue;
    const leftWrites = leftEffect.dimension === "WRITE" || leftEffect.dimension === "EXTERNAL"
      || leftEffect.dimension === "FINANCIAL" || leftEffect.dimension === "COMPUTER";
    const rightWrites = rightEffect.dimension === "WRITE" || rightEffect.dimension === "EXTERNAL"
      || rightEffect.dimension === "FINANCIAL" || rightEffect.dimension === "COMPUTER";
    if (leftWrites || rightWrites) conflicts.add(leftResource);
  }
  return [...conflicts].sort();
}

function addRelation(
  map: Map<string, DependencyRelation>,
  relation: DependencyRelation,
): void {
  map.set(relationKey(relation), relation);
}

function topologicalLayers(
  nodeIds: string[],
  relations: DependencyRelation[],
): { layers: string[][]; cyclic: boolean } {
  const relevant = relations.filter((relation) =>
    relation.relation === "MUST_PRECEDE"
    || relation.relation === "ENABLES"
    || relation.relation === "COMPENSATES");
  const incoming = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const relation of relevant) {
    if (!incoming.has(relation.from) || !incoming.has(relation.to)) continue;
    outgoing.get(relation.from)!.push(relation.to);
    incoming.set(relation.to, incoming.get(relation.to)! + 1);
  }
  for (const values of outgoing.values()) values.sort();
  const remaining = new Set(nodeIds);
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const layer = [...remaining].filter((id) => incoming.get(id) === 0).sort();
    if (layer.length === 0) return { layers, cyclic: true };
    layers.push(layer);
    for (const id of layer) {
      remaining.delete(id);
      for (const next of outgoing.get(id) ?? []) incoming.set(next, incoming.get(next)! - 1);
    }
  }
  return { layers, cyclic: false };
}

function hasRelation(
  relations: DependencyRelation[],
  left: string,
  right: string,
  kinds: DependencyRelationKind[],
): boolean {
  return relations.some((relation) => kinds.includes(relation.relation)
    && ((relation.from === left && relation.to === right) || (relation.from === right && relation.to === left)));
}

/**
 * Derives causal relations separately from AST array order. Sequence contributes
 * MAY_PRECEDE unless an explicit dependency, effect contract, or compensation
 * proves a mandatory relation.
 */
export function derivePartialOrder(
  program: OperationalProgram,
  providedSummary?: ProgramEffectSummary,
): PartialOrderPlan {
  const graph = analyzeProgramGraph(program.body);
  const summary = providedSummary ?? composeOperationalProgramEffects(program);
  const relationMap = new Map<string, DependencyRelation>();

  for (const edge of graph.edges) {
    if (edge.source === "sequence") {
      addRelation(relationMap, {
        from: edge.from,
        to: edge.to,
        relation: "MAY_PRECEDE",
        source: "SEQUENCE",
        proofRefs: [`sequence:${edge.from}->${edge.to}`],
      });
    } else if (edge.source === "compensation") {
      addRelation(relationMap, {
        from: edge.from,
        to: edge.to,
        relation: "COMPENSATES",
        source: "COMPENSATION",
        proofRefs: [`compensation:${edge.from}->${edge.to}`],
      });
    } else {
      addRelation(relationMap, {
        from: edge.from,
        to: edge.to,
        relation: "MUST_PRECEDE",
        source: "EXPLICIT",
        proofRefs: [`dependsOn:${edge.to}:${edge.from}`],
      });
    }
  }

  const declarations = new Map([...graph.nodes.values()].map((entry) => [
    entry.semanticId,
    inferExecutableNodeEffects(entry.node, program).declaration,
  ]));
  const nodeIds = [...graph.nodes.keys()].sort();
  for (const from of nodeIds) for (const to of nodeIds) {
    if (from === to) continue;
    const ensures = declarations.get(from)?.contract.ensures ?? [];
    const requires = declarations.get(to)?.contract.requires ?? [];
    const matched = ensures.some((ensure) => requires.some((requirement) => stable(ensure) === stable(requirement)));
    if (matched) addRelation(relationMap, {
      from,
      to,
      relation: "ENABLES",
      source: "EFFECT_CONTRACT",
      proofRefs: [`effect-contract:${from}:ensures:${to}:requires`],
    });
  }

  for (const entry of summary.possible) {
    if (entry.effect.dimension !== "OBSERVATION") continue;
    addRelation(relationMap, {
      from: entry.effect.nodeId,
      to: entry.effect.observationRef,
      relation: "OBSERVES",
      source: "OBSERVATION",
      proofRefs: [`effect-observation:${entry.effect.effectId}`],
    });
  }

  const byNode = effectsByNode(summary);
  for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
      const left = nodeIds[leftIndex]!;
      const right = nodeIds[rightIndex]!;
      const conflicts = conflictingResources(byNode.get(left) ?? [], byNode.get(right) ?? []);
      if (conflicts.length > 0) {
        addRelation(relationMap, {
          from: left,
          to: right,
          relation: "CONFLICTS",
          source: "RESOURCE_EFFECT",
          proofRefs: conflicts.map((_, index) => `resource-conflict:${left}:${right}:${index + 1}`),
        });
      }
    }
  }

  const provisional = [...relationMap.values()].sort((left, right) => relationKey(left).localeCompare(relationKey(right)));
  for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
      const left = nodeIds[leftIndex]!;
      const right = nodeIds[rightIndex]!;
      if (!hasRelation(provisional, left, right, ["MUST_PRECEDE", "ENABLES", "COMPENSATES", "CONFLICTS"])) {
        addRelation(relationMap, {
          from: left,
          to: right,
          relation: "INDEPENDENT",
          source: "EFFECT_CONTRACT",
          proofRefs: [`no-causal-or-resource-edge:${left}:${right}`],
        });
      }
    }
  }

  const relations = [...relationMap.values()].sort((left, right) => relationKey(left).localeCompare(relationKey(right)));
  const topology = topologicalLayers(nodeIds, relations);
  const reasonCodes = [
    ...(graphCycles(graph).length > 0 || topology.cyclic ? ["DEPENDENCY_CYCLE"] : []),
    ...summary.conflicts.map((conflict) => conflict.code),
  ].sort();
  return {
    nodeIds,
    relations,
    topologicalLayers: topology.layers,
    legal: reasonCodes.length === 0,
    reasonCodes,
  };
}

export function nodesIndependent(plan: PartialOrderPlan, left: string, right: string): boolean {
  return plan.relations.some((relation) => relation.relation === "INDEPENDENT"
    && ((relation.from === left && relation.to === right) || (relation.from === right && relation.to === left)));
}
