import {
  canonicalSerialize,
  canonicalizeIrFragment,
  composeOperationalProgramEffects,
  sealOperationalProgram,
  validateOperationalProgram,
  type AtomicTypedEffect,
  type OperationalProgram,
  type ProgramEffectSummary,
  type ProgramNode,
} from "@finnor/operational-ir";
import type {
  RewriteSafetyClass,
  SearchCapability,
} from "./contracts";
import { derivePartialOrder, nodesIndependent } from "./dependencies";

export interface RewriteRuleDescriptor {
  id: string;
  version: "1";
  pattern: string;
  replacement: string;
  preconditions: string[];
  effectRequirements: string[];
  proofClass: RewriteSafetyClass;
  equivalenceClass: string;
  costImpact: string;
}

export const GUARDED_REWRITE_RULES: readonly RewriteRuleDescriptor[] = [
  {
    id: "flatten_nested_sequence",
    version: "1",
    pattern: "Sequence(..., Sequence(children), ...)",
    replacement: "Sequence(..., children, ...)",
    preconditions: ["nested node is Sequence", "semantic step order remains exact"],
    effectRequirements: ["P2 effect footprint equal", "mandatory partial-order edges preserved"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "STRUCTURAL_ASSOCIATIVITY",
    costImpact: "removes one structural search/runtime node",
  },
  {
    id: "remove_semantic_noop_container",
    version: "1",
    pattern: "Sequence(x) or Parallel(x)",
    replacement: "x",
    preconditions: ["container has exactly one child"],
    effectRequirements: ["P2 effect footprint equal"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "IDENTITY_CONTAINER",
    costImpact: "removes one semantic no-op container",
  },
  {
    id: "canonicalize_constraint_order",
    version: "1",
    pattern: "OperationalProgram.constraints in non-canonical order",
    replacement: "constraints sorted by canonical semantic value",
    preconditions: ["constraint multiset unchanged"],
    effectRequirements: ["hard and soft constraint semantics equal"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "SET_CANONICALIZATION",
    costImpact: "no execution cost change",
  },
  {
    id: "reorder_independent_operations",
    version: "1",
    pattern: "Sequence(..., independent B, independent A, ...)",
    replacement: "Sequence(..., A, B, ...)",
    preconditions: ["pair is proven INDEPENDENT", "canonical node order improves"],
    effectRequirements: ["no resource conflict", "P2 effect footprint equal", "mandatory partial-order edges preserved"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "COMMUTING_INDEPENDENT_OPERATIONS",
    costImpact: "canonical ordering only",
  },
  {
    id: "parallelize_independent_operations",
    version: "1",
    pattern: "Sequence(independent children)",
    replacement: "Parallel(children)",
    preconditions: ["every child pair is proven INDEPENDENT"],
    effectRequirements: ["P2 composition has no conflict", "mandatory partial-order edges preserved"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "INDEPENDENT_PARTIAL_ORDER",
    costImpact: "may lower expected latency without changing effects",
  },
  {
    id: "batch_compatible_operations",
    version: "1",
    pattern: "Sequence of capability-declared batch-compatible Effects",
    replacement: "audited replacement Effect supplied by capability owner",
    preconditions: ["same operation", "item count within bound", "audited batch proof present"],
    effectRequirements: ["write/read/authority/observation safety footprint equal or stricter", "P2 re-admissibility"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "AUDITED_BATCH_EQUIVALENCE",
    costImpact: "may reduce provider calls and latency",
  },
  {
    id: "substitute_equivalent_capability",
    version: "1",
    pattern: "Effect using a capability with an audited equivalent replacement",
    replacement: "audited replacement Effect supplied by capability owner",
    preconditions: ["equivalence proof present", "replacement required knowledge resolved"],
    effectRequirements: ["write/read/authority/observation safety footprint equal or stricter", "P2 re-admissibility"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "AUDITED_CAPABILITY_EQUIVALENCE",
    costImpact: "uses replacement capability cost profile",
  },
  {
    id: "introduce_legal_compensation_path",
    version: "1",
    pattern: "Consequential Effect with an audited, exactly linked compensation alternative",
    replacement: "Sequence(original, Compensation(audited effect))",
    preconditions: ["original is consequential and not READ_ONLY", "compensation contract names the exact original effect", "audited compensation proof present"],
    effectRequirements: ["original guaranteed effects retained", "all added effects are conditional compensation effects", "P2 re-admissibility"],
    proofClass: "STRICTER_SAFE",
    equivalenceClass: "RECOVERY_STRENGTHENING",
    costImpact: "adds conditional recovery burden while improving recoverability",
  },
  {
    id: "normalize_branch_structure",
    version: "1",
    pattern: "FIRST_MATCH branch whose every case and otherwise are identical",
    replacement: "common branch body",
    preconditions: ["otherwise exists", "all outcomes are semantically identical"],
    effectRequirements: ["P2 effect footprint equal"],
    proofClass: "SEMANTIC_EQUIVALENCE",
    equivalenceClass: "BRANCH_IDEMPOTENCE",
    costImpact: "removes redundant predicate evaluation",
  },
] as const;

export interface GuardedRewrite {
  rule: RewriteRuleDescriptor;
  program: OperationalProgram;
  safetyClass: RewriteSafetyClass;
  effectRelation: "EQUIVALENT" | "STRICTER";
  proofRefs: string[];
  requiredPropositionIds: string[];
}

function stable(value: unknown): string {
  return canonicalSerialize(canonicalizeIrFragment(value));
}

function reseal(program: OperationalProgram, body: ProgramNode, constraints = program.constraints): OperationalProgram {
  const { irSemanticHash: _hash, ...draft } = program;
  return sealOperationalProgram({ ...draft, body, constraints });
}

function replaceFirst(
  node: ProgramNode,
  match: (candidate: ProgramNode) => ProgramNode | null,
): ProgramNode | null {
  const direct = match(node);
  if (direct) return direct;
  if (node.kind === "sequence") {
    for (let index = 0; index < node.steps.length; index += 1) {
      const replacement = replaceFirst(node.steps[index]!, match);
      if (replacement) return { ...node, steps: node.steps.map((step, child) => child === index ? replacement : step) };
    }
  } else if (node.kind === "parallel") {
    for (let index = 0; index < node.branches.length; index += 1) {
      const replacement = replaceFirst(node.branches[index]!, match);
      if (replacement) return { ...node, branches: node.branches.map((branch, child) => child === index ? replacement : branch) };
    }
  } else if (node.kind === "branch") {
    for (let index = 0; index < node.cases.length; index += 1) {
      const replacement = replaceFirst(node.cases[index]!.then, match);
      if (replacement) return { ...node, cases: node.cases.map((entry, child) => child === index ? { ...entry, then: replacement } : entry) };
    }
    if (node.otherwise) {
      const replacement = replaceFirst(node.otherwise, match);
      if (replacement) return { ...node, otherwise: replacement };
    }
  }
  return null;
}

function normalizeAuthority(
  requirement: ProgramEffectSummary["authorityRequirements"][number],
  capabilities: readonly SearchCapability[],
): unknown {
  const { requirementId: _requirementId, ...semantic } = requirement;
  if (requirement.kind !== "REQUIRES_CAPABILITY") return semantic;
  const equivalenceClass = capabilities.find((capability) => capability.capability === requirement.capability)?.equivalenceClass;
  return equivalenceClass ? { ...semantic, capability: `equivalence-class:${equivalenceClass}` } : semantic;
}

function safetyFootprint(summary: ProgramEffectSummary, capabilities: readonly SearchCapability[]): unknown {
  const effect = (value: AtomicTypedEffect) => {
    const row = { ...value } as Record<string, unknown>;
    delete row.effectId;
    delete row.nodeId;
    return row;
  };
  return canonicalizeIrFragment({
    dimensions: summary.dimensions,
    possible: summary.possible.map((entry) => effect(entry.effect)),
    guaranteed: summary.guaranteed.map(effect),
    authorityRequirements: summary.authorityRequirements.map((requirement) => normalizeAuthority(requirement, capabilities)),
    informationFlows: summary.informationFlows.map(({ nodeId: _nodeId, ...flow }) => flow),
    conflicts: summary.conflicts,
    unsupported: summary.unsupportedNodeIds.length,
    runtimeOnly: summary.runtimeOnlyNodeIds.length,
  });
}

function setContainsAll(left: unknown[], right: unknown[]): boolean {
  const leftSet = new Set(left.map(stable));
  return right.every((value) => leftSet.has(stable(value)));
}

function multisetContainsAll(left: unknown[], right: unknown[]): boolean {
  const counts = new Map<string, number>();
  for (const value of left) {
    const key = stable(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const value of right) {
    const key = stable(value);
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1);
  }
  return true;
}

function effectsEqualOrStricter(
  before: ProgramEffectSummary,
  after: ProgramEffectSummary,
  capabilities: readonly SearchCapability[],
): "EQUIVALENT" | "STRICTER" | "WEAKER" {
  if (stable(safetyFootprint(before, capabilities)) === stable(safetyFootprint(after, capabilities))) return "EQUIVALENT";
  const beforeWrites = before.possible.flatMap(({ effect }) => effect.dimension === "WRITE" ? [effect.access] : []);
  const afterWrites = after.possible.flatMap(({ effect }) => effect.dimension === "WRITE" ? [effect.access] : []);
  const beforeExternal = before.possible.flatMap(({ effect }) => ["EXTERNAL", "FINANCIAL", "COMPUTER"].includes(effect.dimension) ? [effect] : []);
  const afterExternal = after.possible.flatMap(({ effect }) => ["EXTERNAL", "FINANCIAL", "COMPUTER"].includes(effect.dimension) ? [effect] : []);
  const sameMutationFloor = multisetContainsAll(afterWrites, beforeWrites) && multisetContainsAll(beforeWrites, afterWrites)
    && multisetContainsAll(afterExternal, beforeExternal) && multisetContainsAll(beforeExternal, afterExternal);
  const authorityNotWeaker = setContainsAll(
    after.authorityRequirements.map((requirement) => normalizeAuthority(requirement, capabilities)),
    before.authorityRequirements.map((requirement) => normalizeAuthority(requirement, capabilities)),
  );
  const beforeObservations = before.possible.flatMap(({ effect }) => effect.dimension === "OBSERVATION" ? [effect.observationRef] : []);
  const afterObservations = after.possible.flatMap(({ effect }) => effect.dimension === "OBSERVATION" ? [effect.observationRef] : []);
  return sameMutationFloor && authorityNotWeaker && setContainsAll(afterObservations, beforeObservations) ? "STRICTER" : "WEAKER";
}

function mandatoryEdges(program: OperationalProgram, summary: ProgramEffectSummary): string[] {
  return derivePartialOrder(program, summary).relations
    .filter((relation) => ["MUST_PRECEDE", "ENABLES", "COMPENSATES"].includes(relation.relation))
    .map((relation) => `${relation.from}|${relation.to}|${relation.relation}`)
    .sort();
}

function guard(
  before: OperationalProgram,
  after: OperationalProgram,
  rule: RewriteRuleDescriptor,
  proofRefs: string[],
  capabilities: readonly SearchCapability[],
): Omit<GuardedRewrite, "rule" | "program" | "proofRefs" | "requiredPropositionIds"> | null {
  const validation = validateOperationalProgram(after);
  if (!validation.valid) return null;
  if (stable(before.goal) !== stable(after.goal)
      || stable(before.constraints.filter((constraint) => constraint.severity === "HARD")) !== stable(after.constraints.filter((constraint) => constraint.severity === "HARD"))
      || stable(before.scope) !== stable(after.scope)
      || stable(before.observations) !== stable(after.observations)
      || stable(before.successCondition) !== stable(after.successCondition)) return null;
  const beforeSummary = composeOperationalProgramEffects(before);
  const afterSummary = composeOperationalProgramEffects(after);
  const relation = effectsEqualOrStricter(beforeSummary, afterSummary, capabilities);
  if (relation === "WEAKER") return null;
  if (!setContainsAll(mandatoryEdges(after, afterSummary), mandatoryEdges(before, beforeSummary))) return null;
  if (afterSummary.conflicts.length > 0) return null;
  if (rule.proofClass === "SEMANTIC_EQUIVALENCE" && relation !== "EQUIVALENT" && proofRefs.length === 0) return null;
  return {
    safetyClass: relation === "EQUIVALENT" ? "SEMANTIC_EQUIVALENCE" : "STRICTER_SAFE",
    effectRelation: relation,
  };
}

function descriptor(id: string): RewriteRuleDescriptor {
  return GUARDED_REWRITE_RULES.find((rule) => rule.id === id)!;
}

function structuralRewrites(program: OperationalProgram, capabilities: readonly SearchCapability[]): GuardedRewrite[] {
  const candidates: Array<{ rule: RewriteRuleDescriptor; body: ProgramNode; proofRefs: string[] }> = [];
  const flattened = replaceFirst(program.body, (node) => {
    if (node.kind !== "sequence" || !node.steps.some((step) => step.kind === "sequence")) return null;
    return { ...node, steps: node.steps.flatMap((step) => step.kind === "sequence" ? step.steps : [step]) };
  });
  if (flattened) candidates.push({ rule: descriptor("flatten_nested_sequence"), body: flattened, proofRefs: ["sequence-associativity"] });

  const noOp = replaceFirst(program.body, (node) => {
    if (node.kind === "sequence" && node.steps.length === 1) return node.steps[0]!;
    if (node.kind === "parallel" && node.branches.length === 1) return node.branches[0]!;
    return null;
  });
  if (noOp) candidates.push({ rule: descriptor("remove_semantic_noop_container"), body: noOp, proofRefs: ["single-child-container-identity"] });

  const ordered = replaceFirst(program.body, (node) => {
    if (node.kind !== "sequence" || node.steps.length < 2) return null;
    const partialOrder = derivePartialOrder(program);
    for (let index = 0; index < node.steps.length - 1; index += 1) {
      const left = node.steps[index]!;
      const right = node.steps[index + 1]!;
      if (left.semanticId.localeCompare(right.semanticId) <= 0 || !nodesIndependent(partialOrder, left.semanticId, right.semanticId)) continue;
      const steps = [...node.steps];
      [steps[index], steps[index + 1]] = [right, left];
      return { ...node, steps };
    }
    return null;
  });
  if (ordered) candidates.push({ rule: descriptor("reorder_independent_operations"), body: ordered, proofRefs: ["partial-order-independence"] });

  const parallel = replaceFirst(program.body, (node) => {
    if (node.kind !== "sequence" || node.steps.length < 2) return null;
    const partialOrder = derivePartialOrder(program);
    for (let left = 0; left < node.steps.length; left += 1) for (let right = left + 1; right < node.steps.length; right += 1) {
      if (!nodesIndependent(partialOrder, node.steps[left]!.semanticId, node.steps[right]!.semanticId)) return null;
    }
    return { kind: "parallel", semanticId: node.semanticId, branches: node.steps };
  });
  if (parallel) candidates.push({ rule: descriptor("parallelize_independent_operations"), body: parallel, proofRefs: ["pairwise-partial-order-independence"] });

  const branch = replaceFirst(program.body, (node) => {
    if (node.kind !== "branch" || !node.otherwise || node.cases.length === 0) return null;
    const common = stable(node.otherwise);
    return node.cases.every((entry) => stable(entry.then) === common) ? node.otherwise : null;
  });
  if (branch) candidates.push({ rule: descriptor("normalize_branch_structure"), body: branch, proofRefs: ["first-match-exhaustive-identical-outcomes"] });

  return candidates.flatMap((candidate) => {
    const after = reseal(program, candidate.body);
    const guarded = guard(program, after, candidate.rule, candidate.proofRefs, capabilities);
    return guarded ? [{ ...guarded, rule: candidate.rule, program: after, proofRefs: candidate.proofRefs, requiredPropositionIds: [] }] : [];
  });
}

function capabilityRewrites(program: OperationalProgram, capabilities: readonly SearchCapability[]): GuardedRewrite[] {
  const results: GuardedRewrite[] = [];
  for (const capability of [...capabilities].sort((left, right) => left.capability.localeCompare(right.capability))) {
    if (capability.substitution) {
      const replaced = capabilities.find((candidate) => candidate.capability === capability.substitution!.replacesCapability);
      const replacement = capability.substitution.replacementEffect;
      const body = capability.available === true
        && replacement.requiredCapability === capability.capability
        && capability.equivalenceClass
        && capability.equivalenceClass === replaced?.equivalenceClass
        ? replaceFirst(program.body, (node) => node.kind === "effect" && node.requiredCapability === capability.substitution!.replacesCapability
          ? replacement : null)
        : null;
      if (body) {
        const after = reseal(program, body);
        const rule = descriptor("substitute_equivalent_capability");
        const guarded = guard(program, after, rule, [capability.substitution.proofRef], capabilities);
        if (guarded) results.push({ ...guarded, rule, program: after, proofRefs: [capability.substitution.proofRef], requiredPropositionIds: capability.requiredPropositionIds ?? [] });
      }
    }
    if (capability.batch) {
      const body = replaceFirst(program.body, (node) => {
        if (node.kind !== "sequence" || node.steps.length < 2 || node.steps.length > capability.batch!.maxItems) return null;
        if (capability.available !== true
            || capability.batch!.replacementEffect.requiredCapability !== capability.capability
            || !node.steps.every((step) => step.kind === "effect"
              && step.requiredCapability === capability.capability
              && step.operation === capability.batch!.compatibleOperation)) return null;
        return capability.batch!.replacementEffect;
      });
      if (body) {
        const after = reseal(program, body);
        const rule = descriptor("batch_compatible_operations");
        const guarded = guard(program, after, rule, [capability.batch.proofRef], capabilities);
        if (guarded) results.push({ ...guarded, rule, program: after, proofRefs: [capability.batch.proofRef], requiredPropositionIds: capability.requiredPropositionIds ?? [] });
      }
    }
    if (capability.compensation) {
      if (capability.available !== true
          || capability.compensation.effect.requiredCapability !== capability.capability
          || !capability.compensation.proofRef.trim()) continue;
      const original = [...derivePartialOrder(program).nodeIds].map((id) => {
        const find = (node: ProgramNode): Extract<ProgramNode, { kind: "effect" }> | null => {
          if (node.kind === "effect" && node.semanticId === id) return node;
          if (node.kind === "sequence") for (const child of node.steps) { const found = find(child); if (found) return found; }
          if (node.kind === "parallel") for (const child of node.branches) { const found = find(child); if (found) return found; }
          if (node.kind === "branch") {
            for (const child of node.cases) { const found = find(child.then); if (found) return found; }
            if (node.otherwise) return find(node.otherwise);
          }
          return null;
        };
        return find(program.body);
      }).find((effect) => effect?.operation === capability.compensation!.forOperation);
      const originalReversibility = original?.effectDeclaration?.reversibility.classification;
      if (original
          && original.consequential
          && originalReversibility !== "READ_ONLY"
          && capability.compensation.effect.semanticId !== original.semanticId
          && capability.compensation.effect.effectDeclaration?.contract.compensates === original.semanticId) {
        const compensationEffect = capability.compensation.effect;
        const beforeSummary = composeOperationalProgramEffects(program);
        if (beforeSummary.compensationLinks.some((link) => link.originalEffectId === original.semanticId)) continue;
        const compensation: ProgramNode = {
          kind: "compensation",
          semanticId: `compensation.${original.semanticId}`,
          forEffectId: original.semanticId,
          trigger: "ON_FAILURE",
          effect: compensationEffect,
          // forEffectId is the causal edge. Repeating it in dependsOn causes the
          // P1 graph's explicit-edge deduper to erase the stronger COMPENSATES
          // relation from P4's partial-order evidence.
          dependsOn: [],
        };
        const body: ProgramNode = program.body.kind === "sequence"
          ? { ...program.body, steps: [...program.body.steps, compensation] }
          : { kind: "sequence", semanticId: `sequence.recovery.${program.body.semanticId}`, steps: [program.body, compensation] };
        const after = reseal(program, body);
        const rule = descriptor("introduce_legal_compensation_path");
        const afterSummary = composeOperationalProgramEffects(after);
        const retainedGuaranteed = multisetContainsAll(afterSummary.guaranteed, beforeSummary.guaranteed)
          && multisetContainsAll(beforeSummary.guaranteed, afterSummary.guaranteed);
        const retainedPossible = multisetContainsAll(
          afterSummary.possible.filter((entry) => entry.compensationForEffectId === undefined),
          beforeSummary.possible,
        );
        const addedEffectsAreConditionalRecovery = afterSummary.possible
          .filter((entry) => !beforeSummary.possible.some((before) => stable(before) === stable(entry)))
          .every((entry) => entry.compensationForEffectId === original.semanticId);
        const strengthened = afterSummary.compensationLinks.some((link) => link.originalEffectId === original.semanticId && link.compensationEffectId === compensationEffect.semanticId)
          && stable(program.goal) === stable(after.goal)
          && stable(program.constraints.filter((constraint) => constraint.severity === "HARD")) === stable(after.constraints.filter((constraint) => constraint.severity === "HARD"))
          && stable(program.scope) === stable(after.scope)
          && stable(program.observations) === stable(after.observations)
          && stable(program.successCondition) === stable(after.successCondition)
          && retainedGuaranteed
          && retainedPossible
          && addedEffectsAreConditionalRecovery
          && beforeSummary.conflicts.length === 0 && afterSummary.conflicts.length === 0;
        if (strengthened && validateOperationalProgram(after).valid) results.push({
          rule,
          program: after,
          safetyClass: "STRICTER_SAFE",
          effectRelation: "STRICTER",
          proofRefs: [capability.compensation.proofRef],
          requiredPropositionIds: capability.requiredPropositionIds ?? [],
        });
      }
    }
  }
  return results;
}

export function generateGuardedRewrites(
  program: OperationalProgram,
  capabilities: readonly SearchCapability[],
): GuardedRewrite[] {
  const constraints = [...program.constraints].sort((left, right) => stable(left).localeCompare(stable(right)));
  const canonicalConstraintRewrite = stable(constraints) === stable(program.constraints)
    ? []
    : (() => {
        const after = reseal(program, program.body, constraints);
        const rule = descriptor("canonicalize_constraint_order");
        const guarded = guard(program, after, rule, ["constraint-set-canonicalization"], capabilities);
        return guarded ? [{ ...guarded, rule, program: after, proofRefs: ["constraint-set-canonicalization"], requiredPropositionIds: [] }] : [];
      })();
  const rewrites = [...canonicalConstraintRewrite, ...structuralRewrites(program, capabilities), ...capabilityRewrites(program, capabilities)];
  const unique = new Map(rewrites.map((rewrite) => [`${rewrite.rule.id}\u0000${rewrite.program.irSemanticHash}`, rewrite]));
  return [...unique.values()].sort((left, right) => `${left.rule.id}\u0000${left.program.irSemanticHash}`.localeCompare(`${right.rule.id}\u0000${right.program.irSemanticHash}`));
}

export function rewriteInventory(): RewriteRuleDescriptor[] {
  return GUARDED_REWRITE_RULES.map((rule) => ({ ...rule, preconditions: [...rule.preconditions], effectRequirements: [...rule.effectRequirements] }));
}
