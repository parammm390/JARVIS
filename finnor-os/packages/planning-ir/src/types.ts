export const PLANNING_IR_SCHEMA_VERSION = "1.0.0" as const;
export const PLANNING_IR_COMPILER_VERSION = "phase1-admissibility-1" as const;
export const IR_HASH_NAMESPACE = "finnor.planning-ir.semantic/v1" as const;

export type PlanningExecutionModel = "ATOMIC_EFFECT" | "OBJECTIVE";

export interface IrProvenance {
  source: "instruction_planner" | "objective_controller" | "deterministic_fixture" | "compatibility_adapter";
  sourceRef?: string;
  instructionId?: string;
  workId?: string;
  objectiveStepId?: string;
  plannerAttemptId?: string;
  traceId?: string;
  createdAt?: string;
}

export interface CanonicalEntityRef {
  kind: "party" | "property" | "asset" | "work" | "entity" | "resource";
  entityType: string;
  entityId: string;
  field?: string;
  relationship?: string;
  provenance?: string;
}

export interface IntentSpec {
  requestedOutcome: string;
  executionModel: PlanningExecutionModel;
  groundedEntities: CanonicalEntityRef[];
  scope: {
    included: CanonicalEntityRef[];
    excluded: CanonicalEntityRef[];
    textExclusions: string[];
  };
  unresolvedAmbiguity: Array<{
    code: string;
    description: string;
    candidates: CanonicalEntityRef[];
  }>;
  provenance: IrProvenance;
}

export type GoalPredicateOperator = "exists" | "not_exists" | "eq" | "not_eq" | "gte" | "lte" | "contains" | "array_contains" | "completed";

export interface GoalSpec {
  statement: string;
  desiredState: Array<{
    subject: CanonicalEntityRef | { kind: "business_state"; key: string };
    path: Array<string | number>;
    operator: GoalPredicateOperator;
    expected?: unknown;
  }>;
  completionMode: "all";
  objectiveCompatibility: "reuse_existing_objective_semantics";
}

export type ConstraintKind = "entity_relationship" | "temporal" | "capability" | "precondition" | "user_restriction" | "policy_authority" | "cost_risk_exposure" | "observation_verifiability" | "preference";
export type ConstraintStatus = "satisfied" | "violated" | "unresolved";

export interface ConstraintSpec {
  id: string;
  strength: "HARD" | "SOFT";
  kind: ConstraintKind;
  description: string;
  status: ConstraintStatus;
  subjectRefs: CanonicalEntityRef[];
  values: Record<string, unknown>;
}

/** Planner-supplied status is an assertion for explanation/diffing only. The
 * admissibility boundary independently derives this truth before lowering. */
export interface ConstraintTruthEvaluation {
  constraintId: string;
  truth: ConstraintStatus;
  source: "clock" | "capability_registry" | "canonical_state" | "canonical_relationship" | "policy_authority" | "runtime_scope" | "unsupported";
  evidence: string[];
  reason: string;
  evaluatedAt: string;
  sourceVersions: Record<string, string>;
}

export interface ConstraintSet {
  hard: ConstraintSpec[];
  soft: ConstraintSpec[];
}

interface PlanNodeBase {
  id: string;
  dependsOn: string[];
  causalPrerequisites: string[];
  requiredCapabilities: string[];
}

export type PlanNode =
  | (PlanNodeBase & { kind: "query"; request: Record<string, unknown> })
  | (PlanNodeBase & { kind: "observe"; observationId: string })
  | (PlanNodeBase & { kind: "wait"; condition: string; deadlineAt?: string; eventRef?: Record<string, unknown> })
  | (PlanNodeBase & { kind: "effect"; effectId: string });

export interface PlanGraph {
  nodes: PlanNode[];
  completion: {
    mode: "all";
    observationIds: string[];
  };
}

export interface EffectSpec {
  id: string;
  actionType: string;
  effectIntent: string;
  payload: Record<string, unknown>;
  targetRefs: CanonicalEntityRef[];
  requiredCapability: string;
  risk: "low" | "medium" | "high";
  exposure: { amount: number; currency: string } | null;
  proposalOnly: true;
}

export type ObservationKind = "canonical_state" | "provider_delivery" | "computer_state" | "workflow_completion" | "recorded_result" | "canonical_query";

export interface ObservationSpec {
  id: string;
  effectId?: string;
  kind: ObservationKind;
  predicate: Record<string, unknown>;
  requiredEvidence: string[];
  acknowledgementSufficient: false;
  verificationFloor: "at_least_existing";
}

export interface PlanningIrMetadata {
  irSchemaVersion: typeof PLANNING_IR_SCHEMA_VERSION;
  compilerVersion: string;
  provenance: IrProvenance;
  irSemanticHash: string;
}

export interface PlanningIrArtifact {
  metadata: PlanningIrMetadata;
  intent: IntentSpec;
  goal: GoalSpec;
  constraints: ConstraintSet;
  plan: PlanGraph;
  effects: EffectSpec[];
  observations: ObservationSpec[];
}

/** Native planner output before trusted runtime metadata is attached. Tenant
 * identity is intentionally absent and can only come from runtime context. */
export interface PlanningIrCandidate {
  intent: Omit<IntentSpec, "provenance">;
  goal: GoalSpec;
  constraints: ConstraintSet;
  plan: PlanGraph;
  effects: EffectSpec[];
  observations: ObservationSpec[];
}

export type PlanningIrInput = Omit<PlanningIrArtifact, "metadata"> & {
  metadata?: never;
};

export type SemanticDiffClassification = "EQUIVALENT" | "EXPECTED_IMPROVEMENT" | "REGRESSION" | "LEGACY_UNSUPPORTED" | "IR_UNSUPPORTED" | "FIXTURE_INVALID";

export interface PlanningSemanticSnapshot {
  executionModel: PlanningExecutionModel;
  groundedTargets: CanonicalEntityRef[];
  scope: IntentSpec["scope"];
  intendedOutcome: string;
  effects: Array<{
    actionType: string;
    payload: Record<string, unknown>;
    requiredCapability: string;
    dependsOn: string[];
    observation: ObservationKind;
    authorityRisk?: "low" | "medium" | "high";
  }>;
  hardConstraints: ConstraintSpec[];
  completionPredicates: ObservationSpec[];
  supported: boolean;
  valid: boolean;
}

export interface PlanningSemanticDiff {
  classification: SemanticDiffClassification;
  differences: Array<{ field: string; legacy: unknown; ir: unknown }>;
  comparedFields: string[];
}
