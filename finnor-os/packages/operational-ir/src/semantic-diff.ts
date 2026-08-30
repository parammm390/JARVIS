import { canonicalizeIrFragment, canonicalSerialize } from "./canonical";
import type { Effect, EntityRef, OperationalProgram, ProgramNode } from "./contracts";
import { analyzeProgramGraph } from "./graph";

export const SEMANTIC_DIFF_CLASSIFICATIONS = [
  "EQUIVALENT",
  "EXPECTED_IMPROVEMENT",
  "REGRESSION",
  "LEGACY_UNSUPPORTED",
  "IR_UNSUPPORTED",
  "FIXTURE_INVALID",
] as const;
export type SemanticDiffClassification = (typeof SEMANTIC_DIFF_CLASSIFICATIONS)[number];

export interface SemanticScopeSnapshot {
  included: string[];
  excluded: string[];
  bounded: boolean;
  cohortQueryRef: string | null;
}

/** Normalized semantic surface. No raw JSON-object comparison, runtime id, provider
 * receipt, BusinessEffect hash, idempotency key, or Work id appears here. */
export interface SemanticSnapshot {
  executionModel: OperationalProgram["executionModel"];
  canonicalTargets: string[];
  scope: SemanticScopeSnapshot;
  goal: string;
  effectIntents: string[];
  dependencies: string[];
  hardConstraints: string[];
  requiredCapabilities: string[];
  expectedObservations: string[];
  successCondition: string;
  compensationSemantics: string[];
  consequentialClassification: "CONSEQUENTIAL" | "NON_CONSEQUENTIAL" | "MIXED";
}

export interface SemanticFieldDiff {
  field: keyof SemanticSnapshot | "scope.included" | "scope.excluded" | "scope.bounded" | "scope.cohortQueryRef";
  relation: "EQUAL" | "IR_SUPERSET" | "DIFFERENT";
  explanation: string;
  legacy: unknown;
  ir: unknown;
}

export interface SemanticDiffResult {
  classification: SemanticDiffClassification;
  equivalent: boolean;
  differences: SemanticFieldDiff[];
  reasonCodes: string[];
}

export interface SemanticComparisonInput {
  fixtureValid?: boolean;
  legacyStatus?: "SUPPORTED" | "UNSUPPORTED";
  irStatus?: "SUPPORTED" | "UNSUPPORTED";
  legacy?: SemanticSnapshot;
  ir?: SemanticSnapshot;
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function entityKey(entity: EntityRef | undefined, fallback: string): string {
  if (!entity) return `missing:${fallback}`;
  if (entity.resolution.status === "resolved") {
    const canonical = entity.resolution.canonical;
    return `${canonical.kind}:${canonical.type}:${canonical.id}`;
  }
  return `${entity.resolution.status}:${entity.entityType}:${entity.semanticId}`;
}

function effectSnapshot(effect: Effect, entityById: Map<string, EntityRef>): string {
  return canonicalSerialize(canonicalizeIrFragment({
    operation: effect.operation,
    arguments: effect.arguments,
    targets: effect.targets.map((target) => ({
      identity: entityKey(entityById.get(target.entityRef), target.entityRef),
      payloadPath: target.payloadPath,
    })),
    intendedState: effect.intendedState,
    consequential: effect.consequential,
  }));
}

function compensationNodes(node: ProgramNode): Array<Extract<ProgramNode, { kind: "compensation" }>> {
  if (node.kind === "compensation") return [node];
  if (node.kind === "sequence") return node.steps.flatMap(compensationNodes);
  if (node.kind === "parallel") return node.branches.flatMap(compensationNodes);
  if (node.kind === "branch") return [
    ...node.cases.flatMap((branchCase) => compensationNodes(branchCase.then)),
    ...(node.otherwise ? compensationNodes(node.otherwise) : []),
  ];
  return [];
}

export function semanticSnapshotFromOperationalProgram(program: OperationalProgram): SemanticSnapshot {
  const graph = analyzeProgramGraph(program.body);
  const entityById = new Map(program.entities.map((entity) => [entity.semanticId, entity]));
  const effects = [...graph.nodes.values()].filter((node): node is typeof node & { node: Effect } => node.kind === "effect");
  const ordinaryEffects = effects.filter((node) => !node.compensationForEffectId);
  const targetKeys = ordinaryEffects.flatMap(({ node }) => node.targets.map((target) => entityKey(entityById.get(target.entityRef), target.entityRef)));
  const scopeKey = (ref: string) => entityKey(entityById.get(ref), ref);
  const consequential = ordinaryEffects.map(({ node }) => node.consequential);
  const consequentialClassification = consequential.length === 0 || consequential.every((value) => !value)
    ? "NON_CONSEQUENTIAL"
    : consequential.every(Boolean) ? "CONSEQUENTIAL" : "MIXED";
  return {
    executionModel: program.executionModel,
    canonicalTargets: sorted(targetKeys),
    scope: {
      included: sorted(program.scope.includeEntityRefs.map(scopeKey)),
      excluded: sorted(program.scope.excludeEntityRefs.map(scopeKey)),
      bounded: program.scope.bounded,
      cohortQueryRef: program.scope.cohortQueryRef ?? null,
    },
    goal: canonicalSerialize(canonicalizeIrFragment({ statement: program.goal.statement, predicate: program.goal.predicate, subjects: program.goal.subjectRefs.map(scopeKey) })),
    effectIntents: sorted(ordinaryEffects.map(({ node }) => effectSnapshot(node, entityById))),
    dependencies: sorted(graph.edges
      .filter((edge) => graph.nodes.has(edge.from) && graph.nodes.has(edge.to))
      .map((edge) => `${edge.from}->${edge.to}`)),
    hardConstraints: sorted(program.constraints.filter((constraint) => constraint.severity === "HARD").map((constraint) => canonicalSerialize(canonicalizeIrFragment({
      category: constraint.category,
      description: constraint.description,
      predicate: constraint.predicate,
      evaluation: constraint.evaluation,
      entities: constraint.entityRefs.map(scopeKey),
    })))),
    requiredCapabilities: sorted(ordinaryEffects.map(({ node }) => node.requiredCapability)),
    expectedObservations: sorted(program.observations.map((observation) => canonicalSerialize(canonicalizeIrFragment({
      subject: observation.subject,
      strength: observation.strength,
      verificationFloor: observation.verificationFloor,
      evidence: observation.evidence,
    })))),
    successCondition: canonicalSerialize(canonicalizeIrFragment({
      statement: program.successCondition.statement,
      mode: program.successCondition.mode,
      criteria: program.successCondition.criteria,
    })),
    compensationSemantics: sorted(compensationNodes(program.body).map((compensation) => canonicalSerialize(canonicalizeIrFragment({
      forEffectId: compensation.forEffectId,
      trigger: compensation.trigger,
      effect: effectSnapshot(compensation.effect, entityById),
    })))),
    consequentialClassification,
  };
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function isSuperset(candidate: string[], baseline: string[]): boolean {
  const values = new Set(candidate);
  return baseline.every((value) => values.has(value));
}

export function compareSemanticSnapshots(input: SemanticComparisonInput): SemanticDiffResult {
  if (input.fixtureValid === false) return { classification: "FIXTURE_INVALID", equivalent: false, differences: [], reasonCodes: ["fixture_invalid"] };
  if (input.legacyStatus === "UNSUPPORTED") return { classification: "LEGACY_UNSUPPORTED", equivalent: false, differences: [], reasonCodes: ["legacy_representation_unsupported"] };
  if (input.irStatus === "UNSUPPORTED") return { classification: "IR_UNSUPPORTED", equivalent: false, differences: [], reasonCodes: ["ir_lowering_unsupported"] };
  if (!input.legacy || !input.ir) return { classification: "FIXTURE_INVALID", equivalent: false, differences: [], reasonCodes: ["missing_semantic_snapshot"] };

  const legacy = input.legacy;
  const ir = input.ir;
  const differences: SemanticFieldDiff[] = [];
  const exactField = (field: Exclude<keyof SemanticSnapshot, "scope" | "hardConstraints" | "expectedObservations">) => {
    if (!equal(legacy[field], ir[field])) differences.push({ field, relation: "DIFFERENT", explanation: `${field} changed`, legacy: legacy[field], ir: ir[field] });
  };
  exactField("executionModel");
  exactField("canonicalTargets");
  exactField("goal");
  exactField("effectIntents");
  exactField("dependencies");
  exactField("requiredCapabilities");
  exactField("successCondition");
  exactField("compensationSemantics");
  exactField("consequentialClassification");
  if (!equal(legacy.scope.included, ir.scope.included)) differences.push({ field: "scope.included", relation: "DIFFERENT", explanation: "included scope changed", legacy: legacy.scope.included, ir: ir.scope.included });
  if (!equal(legacy.scope.bounded, ir.scope.bounded)) differences.push({ field: "scope.bounded", relation: "DIFFERENT", explanation: "scope boundedness changed", legacy: legacy.scope.bounded, ir: ir.scope.bounded });
  if (!equal(legacy.scope.cohortQueryRef, ir.scope.cohortQueryRef)) differences.push({ field: "scope.cohortQueryRef", relation: "DIFFERENT", explanation: "cohort query scope changed", legacy: legacy.scope.cohortQueryRef, ir: ir.scope.cohortQueryRef });

  const allowedImprovementFields = new Set<string>();
  if (!equal(legacy.scope.excluded, ir.scope.excluded)) {
    const improvement = isSuperset(ir.scope.excluded, legacy.scope.excluded);
    differences.push({ field: "scope.excluded", relation: improvement ? "IR_SUPERSET" : "DIFFERENT", explanation: improvement ? "IR adds explicit exclusions without widening scope" : "scope exclusions changed incompatibly", legacy: legacy.scope.excluded, ir: ir.scope.excluded });
    if (improvement) allowedImprovementFields.add("scope.excluded");
  }
  if (!equal(legacy.hardConstraints, ir.hardConstraints)) {
    const improvement = isSuperset(ir.hardConstraints, legacy.hardConstraints);
    differences.push({ field: "hardConstraints", relation: improvement ? "IR_SUPERSET" : "DIFFERENT", explanation: improvement ? "IR retains every HARD constraint and adds restrictions" : "a HARD constraint changed or was weakened", legacy: legacy.hardConstraints, ir: ir.hardConstraints });
    if (improvement) allowedImprovementFields.add("hardConstraints");
  }
  if (!equal(legacy.expectedObservations, ir.expectedObservations)) {
    const improvement = isSuperset(ir.expectedObservations, legacy.expectedObservations);
    differences.push({ field: "expectedObservations", relation: improvement ? "IR_SUPERSET" : "DIFFERENT", explanation: improvement ? "IR retains existing verification and adds evidence" : "expected observation/verification semantics changed or weakened", legacy: legacy.expectedObservations, ir: ir.expectedObservations });
    if (improvement) allowedImprovementFields.add("expectedObservations");
  }

  if (differences.length === 0) return { classification: "EQUIVALENT", equivalent: true, differences, reasonCodes: ["normalized_semantics_equal"] };
  const onlyImprovements = differences.every((difference) => difference.relation === "IR_SUPERSET" && allowedImprovementFields.has(String(difference.field)));
  if (onlyImprovements) {
    return { classification: "EXPECTED_IMPROVEMENT", equivalent: false, differences, reasonCodes: differences.map((difference) => `strengthened:${String(difference.field)}`) };
  }
  return {
    classification: "REGRESSION",
    equivalent: false,
    differences,
    reasonCodes: differences.filter((difference) => difference.relation === "DIFFERENT").map((difference) => `semantic_mismatch:${String(difference.field)}`),
  };
}
