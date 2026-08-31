import { canonicalSerialize, canonicalizeIrFragment } from "./canonical";
import type { Compensation, OperationalProgram, Predicate, ProgramNode } from "./contracts";
import { inferExecutableNodeEffects, type EffectInferenceResult } from "./effect-inference";
import type {
  AtomicTypedEffect,
  AuthorizedRequirementManifest,
  CompositionConflict,
  ConditionalTypedEffect,
  EffectDeclaration,
  EffectResource,
  ProgramEffectSummary,
} from "./effects";

interface BranchCondition {
  branchId: string;
  caseId: string;
  when: Predicate | "OTHERWISE";
}

interface CompositionFragment {
  possible: ConditionalTypedEffect[];
  guaranteed: AtomicTypedEffect[];
  flows: ProgramEffectSummary["informationFlows"];
  authority: ProgramEffectSummary["authorityRequirements"];
  compensationLinks: ProgramEffectSummary["compensationLinks"];
  conflicts: CompositionConflict[];
  unsupportedNodeIds: string[];
  runtimeOnlyNodeIds: string[];
}

type AtomicTypedEffectInput = AtomicTypedEffect extends infer Candidate
  ? Candidate extends AtomicTypedEffect ? Omit<Candidate, "effectId" | "nodeId"> : never
  : never;

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function uniqueSorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)));
}

function atomicEffects(nodeId: string, declaration: EffectDeclaration, waitObservationRef?: string): AtomicTypedEffect[] {
  const effects: AtomicTypedEffect[] = [];
  const push = (effect: AtomicTypedEffectInput) => {
    const dimensionIndex = effects.filter((candidate) => candidate.dimension === effect.dimension).length + 1;
    effects.push({ ...effect, nodeId, effectId: `${nodeId}:${effect.dimension.toLowerCase()}:${dimensionIndex}` } as AtomicTypedEffect);
  };
  for (const access of declaration.contract.reads) {
    push({ dimension: "READ", access });
    if (access.information.classification === "PII") push({ dimension: "PII", access, handling: "READ" });
  }
  for (const access of [...declaration.contract.writes, ...declaration.contract.modifies]) {
    push({ dimension: "WRITE", access });
    if (access.information.classification === "PII") push({ dimension: "PII", access, handling: "WRITE" });
  }
  for (const flow of declaration.informationFlows) {
    if (flow.information.classification === "PII" && flow.destination.kind !== "INTERNAL_CANONICAL") {
      push({
        dimension: "PII",
        access: { resource: flow.source, information: flow.information, fields: flow.information.fields },
        handling: "REVEAL",
      });
    }
  }
  for (const communication of declaration.communications) push({ dimension: "COMMUNICATION", communication });
  for (const financial of declaration.financial) push({ dimension: "FINANCIAL", financial });
  for (const mutation of declaration.externalMutations) push({ dimension: "EXTERNAL", mutation });
  for (const mutation of declaration.computerMutations) push({ dimension: "COMPUTER", mutation });
  for (const requirement of declaration.authorityRequirements) push({ dimension: "AUTHORITY", requirement });
  push({
    dimension: "REVERSIBILITY",
    classification: declaration.reversibility.classification,
    ...(declaration.reversibility.compensationEffectId ? { compensationEffectId: declaration.reversibility.compensationEffectId } : {}),
  });
  for (const observationRef of uniqueSorted(
    [...declaration.contract.observes, ...(waitObservationRef ? [waitObservationRef] : [])],
    (value) => value,
  )) push({ dimension: "OBSERVATION", observationRef });
  return effects;
}

function emptyFragment(): CompositionFragment {
  return {
    possible: [], guaranteed: [], flows: [], authority: [], compensationLinks: [], conflicts: [],
    unsupportedNodeIds: [], runtimeOnlyNodeIds: [],
  };
}

function mergeFragments(fragments: CompositionFragment[]): CompositionFragment {
  return {
    possible: uniqueSorted(fragments.flatMap((fragment) => fragment.possible), (value) => stable(value)),
    guaranteed: uniqueSorted(fragments.flatMap((fragment) => fragment.guaranteed), (value) => stable(value)),
    flows: uniqueSorted(fragments.flatMap((fragment) => fragment.flows), (value) => stable(value)),
    authority: uniqueSorted(fragments.flatMap((fragment) => fragment.authority), (value) => stable(value)),
    compensationLinks: uniqueSorted(fragments.flatMap((fragment) => fragment.compensationLinks), (value) => stable(value)),
    conflicts: uniqueSorted(fragments.flatMap((fragment) => fragment.conflicts), (value) => stable(value)),
    unsupportedNodeIds: uniqueSorted(fragments.flatMap((fragment) => fragment.unsupportedNodeIds), (value) => value),
    runtimeOnlyNodeIds: uniqueSorted(fragments.flatMap((fragment) => fragment.runtimeOnlyNodeIds), (value) => value),
  };
}

function leafFragment(
  node: Extract<ProgramNode, { kind: "query" | "effect" | "wait" }>,
  inference: EffectInferenceResult,
  conditions: BranchCondition[],
  compensationForEffectId?: string,
): CompositionFragment {
  if (!inference.declaration) {
    return {
      ...emptyFragment(),
      unsupportedNodeIds: inference.support === "UNSUPPORTED" ? [node.semanticId] : [],
      runtimeOnlyNodeIds: inference.support === "RUNTIME_ONLY" ? [node.semanticId] : [],
    };
  }
  const effects = atomicEffects(node.semanticId, inference.declaration, node.kind === "wait" ? node.semanticId : undefined);
  const conditional = conditions.length > 0 || compensationForEffectId !== undefined;
  return {
    ...emptyFragment(),
    possible: effects.map((effect) => ({
      effect,
      conditions: [...conditions],
      ...(compensationForEffectId ? { compensationForEffectId } : {}),
    })),
    guaranteed: conditional ? [] : effects,
    flows: inference.declaration.informationFlows.map((flow) => ({ ...flow, nodeId: node.semanticId })),
    authority: [...inference.declaration.authorityRequirements],
  };
}

function sameResource(left: EffectResource, right: EffectResource): boolean {
  if (left.kind !== right.kind || left.type !== right.type || left.selector !== right.selector) return false;
  if (left.entityRef || right.entityRef) return left.entityRef === right.entityRef;
  if (left.id || right.id) return left.id === right.id;
  return left.selector === "NEW" ? left.type === right.type : true;
}

function writeResources(fragment: CompositionFragment): Array<{ nodeId: string; resource: EffectResource }> {
  return fragment.possible.flatMap(({ effect }) => effect.dimension === "WRITE"
    ? [{ nodeId: effect.nodeId, resource: effect.access.resource }]
    : []);
}

function externalResources(fragment: CompositionFragment): Array<{ nodeId: string; resource: EffectResource; system: string }> {
  return fragment.possible.flatMap(({ effect }) => effect.dimension === "EXTERNAL"
    ? [{ nodeId: effect.nodeId, resource: effect.mutation.resource, system: effect.mutation.system }]
    : []);
}

function financialResources(fragment: CompositionFragment): Array<{ nodeId: string; resource: EffectResource }> {
  return fragment.possible.flatMap(({ effect }) => effect.dimension === "FINANCIAL"
    ? [{ nodeId: effect.nodeId, resource: effect.financial.resource }]
    : []);
}

function parallelConflicts(parallelNodeId: string, branches: CompositionFragment[]): CompositionConflict[] {
  const conflicts: CompositionConflict[] = [];
  const endpoints = (leftNodeId: string, rightNodeId: string) => leftNodeId.localeCompare(rightNodeId) <= 0
    ? { leftNodeId, rightNodeId }
    : { leftNodeId: rightNodeId, rightNodeId: leftNodeId };
  for (let leftIndex = 0; leftIndex < branches.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < branches.length; rightIndex += 1) {
      const left = branches[leftIndex]!;
      const right = branches[rightIndex]!;
      for (const leftWrite of writeResources(left)) for (const rightWrite of writeResources(right)) {
        if (sameResource(leftWrite.resource, rightWrite.resource)) conflicts.push({
          code: "PARALLEL_WRITE_CONFLICT",
          parallelNodeId,
          ...endpoints(leftWrite.nodeId, rightWrite.nodeId),
          resource: leftWrite.resource,
        });
      }
      for (const leftExternal of externalResources(left)) for (const rightExternal of externalResources(right)) {
        if (leftExternal.system === rightExternal.system && sameResource(leftExternal.resource, rightExternal.resource)) conflicts.push({
          code: "PARALLEL_EXTERNAL_CONFLICT",
          parallelNodeId,
          ...endpoints(leftExternal.nodeId, rightExternal.nodeId),
          resource: leftExternal.resource,
        });
      }
      for (const leftFinancial of financialResources(left)) for (const rightFinancial of financialResources(right)) {
        if (sameResource(leftFinancial.resource, rightFinancial.resource)) conflicts.push({
          code: "PARALLEL_FINANCIAL_CONFLICT",
          parallelNodeId,
          ...endpoints(leftFinancial.nodeId, rightFinancial.nodeId),
          resource: leftFinancial.resource,
        });
      }
    }
  }
  return uniqueSorted(conflicts, (value) => stable(value));
}

function intersectionEffects(alternatives: CompositionFragment[]): AtomicTypedEffect[] {
  if (alternatives.length === 0) return [];
  const counts = new Map<string, { count: number; effect: AtomicTypedEffect }>();
  for (const alternative of alternatives) {
    const seen = new Set<string>();
    for (const effect of alternative.guaranteed) {
      const semantic = stable({ ...effect, effectId: undefined, nodeId: undefined });
      if (seen.has(semantic)) continue;
      seen.add(semantic);
      const current = counts.get(semantic);
      counts.set(semantic, { count: (current?.count ?? 0) + 1, effect });
    }
  }
  return [...counts.values()].filter((value) => value.count === alternatives.length).map((value) => value.effect)
    .sort((left, right) => stable(left).localeCompare(stable(right)));
}

function compensationFragment(
  node: Compensation,
  program: OperationalProgram,
  conditions: BranchCondition[],
): CompositionFragment {
  const inferred = inferExecutableNodeEffects(node.effect, program);
  const fragment = leafFragment(node.effect, inferred, conditions, node.forEffectId);
  fragment.compensationLinks.push({
    compensationNodeId: node.semanticId,
    originalEffectId: node.forEffectId,
    compensationEffectId: node.effect.semanticId,
    trigger: node.trigger,
  });
  return fragment;
}

function composeNode(node: ProgramNode, program: OperationalProgram, conditions: BranchCondition[] = []): CompositionFragment {
  if (node.kind === "query" || node.kind === "effect" || node.kind === "wait") {
    return leafFragment(node, inferExecutableNodeEffects(node, program), conditions);
  }
  if (node.kind === "compensation") return compensationFragment(node, program, conditions);
  if (node.kind === "sequence") return mergeFragments(node.steps.map((step) => composeNode(step, program, conditions)));
  if (node.kind === "parallel") {
    const branches = node.branches.map((branch) => composeNode(branch, program, conditions));
    const merged = mergeFragments(branches);
    merged.conflicts = uniqueSorted([...merged.conflicts, ...parallelConflicts(node.semanticId, branches)], (value) => stable(value));
    return merged;
  }
  const alternatives = node.cases.map((branchCase) => composeNode(branchCase.then, program, [
    ...conditions,
    { branchId: node.semanticId, caseId: branchCase.caseId, when: branchCase.when },
  ]));
  if (node.otherwise) alternatives.push(composeNode(node.otherwise, program, [
    ...conditions,
    { branchId: node.semanticId, caseId: "otherwise", when: "OTHERWISE" },
  ]));
  const merged = mergeFragments(alternatives);
  // A FIRST_MATCH branch guarantees only the semantic intersection of all exhaustive
  // alternatives. Without otherwise, no branch is guaranteed to run.
  merged.guaranteed = node.otherwise ? intersectionEffects(alternatives) : [];
  return merged;
}

export function composeOperationalProgramEffects(program: OperationalProgram): ProgramEffectSummary {
  const composed = composeNode(program.body, program);
  const dimensions = uniqueSorted(composed.possible.map((entry) => entry.effect.dimension), (value) => value);
  return {
    version: 1,
    dimensions,
    possible: uniqueSorted(composed.possible, (value) => stable(value)),
    guaranteed: uniqueSorted(composed.guaranteed, (value) => stable(value)),
    authorityRequirements: uniqueSorted(composed.authority, (value) => stable(value)),
    informationFlows: uniqueSorted(composed.flows, (value) => stable(value)),
    compensationLinks: uniqueSorted(composed.compensationLinks, (value) => stable(value)),
    conflicts: uniqueSorted(composed.conflicts, (value) => stable(value)),
    unsupportedNodeIds: uniqueSorted(composed.unsupportedNodeIds, (value) => value),
    runtimeOnlyNodeIds: uniqueSorted(composed.runtimeOnlyNodeIds, (value) => value),
  };
}

export function authorizedRequirementManifest(
  program: OperationalProgram,
  summary = composeOperationalProgramEffects(program),
): AuthorizedRequirementManifest {
  return {
    version: 1,
    programSemanticId: program.semanticId,
    requirements: summary.authorityRequirements,
    runtimeAuthorityReevaluationRequired: true,
    businessEffectCompilationRequired: true,
    executionPreconditionRevalidationRequired: true,
  };
}
