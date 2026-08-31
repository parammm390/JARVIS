import type { ObjectiveSuccessCondition, OperationalQueryRequest } from "@finnor/shared-types";
import type { EffectDeclaration } from "./effects";

/**
 * Operational IR is planning intent only. None of these identifiers is a
 * BusinessEffect id, Work id, provider operation id, or idempotency key.
 */
export const IR_SCHEMA_VERSION = "1.0.0" as const;
export const IR_HASH_ALGORITHM = "sha256" as const;
export const IR_HASH_PREFIX = `ir:${IR_HASH_ALGORITHM}:` as const;

export type IrSemanticHash = `${typeof IR_HASH_PREFIX}${string}`;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

export type InstructionExecutionModel =
  | "QUERY"
  | "CONVERSATION"
  | "ATOMIC_EFFECT"
  | "OBJECTIVE"
  | "KNOWN_ACTION_COMPATIBILITY";

export type ProvenanceRepresentation =
  | "human_intent"
  | "instruction_route_decision"
  | "planner_candidate"
  | "domain_action"
  | "objective_decision"
  | "operational_query"
  | "business_effect_inspection"
  | "deterministic_fixture";

export interface ProvenanceRef {
  kind:
    | "instruction"
    | "work"
    | "work_input"
    | "planner_attempt"
    | "domain_action"
    | "objective_loop"
    | "objective_step"
    | "query"
    | "fixture";
  id: string;
}

/** Runtime provenance is required for auditability but deliberately excluded from
 * the IR semantic hash. Tenant identity is not a legal provenance field. */
export interface Provenance {
  representation: ProvenanceRepresentation;
  sourceRefs: ProvenanceRef[];
  compiledAt: string;
  traceId?: string;
  notes?: string[];
}

/** Explicitly non-semantic runtime material. This entire object is excluded from
 * semantic hashing, which is how generated artifact ids and trace formatting are
 * prevented from becoming business identities. */
export interface NonSemanticMetadata {
  artifactId?: string;
  runtimeTimestamp?: string;
  traceIds?: string[];
  labels?: string[];
}

export interface PredicateSubject {
  kind: "program" | "entity" | "query" | "effect" | "observation";
  /** Required for every subject except program. */
  ref?: string;
}

export type PredicateOperator =
  | "exists"
  | "not_exists"
  | "eq"
  | "not_eq"
  | "gte"
  | "lte"
  | "contains"
  | "array_contains";

export type Predicate =
  | {
      kind: "assertion";
      subject: PredicateSubject;
      path: Array<string | number>;
      operator: PredicateOperator;
      expected?: JsonValue;
    }
  | { kind: "all" | "any"; predicates: Predicate[] }
  | { kind: "not"; predicate: Predicate };

export interface Goal {
  kind: "goal";
  semanticId: string;
  /** Desired business state, never merely an action name. */
  statement: string;
  predicate: Predicate;
  subjectRefs: string[];
}

export type ConstraintSeverity = "HARD" | "SOFT";
export type ConstraintCategory =
  | "entity"
  | "relationship"
  | "temporal"
  | "capability"
  | "user_restriction"
  | "cost"
  | "risk_exposure"
  | "dependency"
  | "completion_requirement";
export type ConstraintEvaluation = "UNKNOWN" | "SATISFIED" | "VIOLATED";

export interface Constraint {
  kind: "constraint";
  semanticId: string;
  severity: ConstraintSeverity;
  category: ConstraintCategory;
  description: string;
  predicate: Predicate;
  evaluation: ConstraintEvaluation;
  entityRefs: string[];
}

export interface CanonicalEntityIdentity {
  kind: "entity" | "party" | "resource";
  type: string;
  id: string;
}

export type EntityResolution =
  | {
      status: "resolved";
      canonical: CanonicalEntityIdentity;
      source: "canonical";
    }
  | {
      status: "unresolved";
      expression: string;
      reason: string;
    }
  | {
      status: "ambiguous";
      expression: string;
      candidates: CanonicalEntityIdentity[];
      reason: string;
    };

/** No tenant field exists here. Resolution is always interpreted inside trusted
 * TenantContext by an adapter/lowerer boundary. */
export interface EntityRef {
  kind: "entity_ref";
  semanticId: string;
  entityType: string;
  resolution: EntityResolution;
}

export interface Query {
  kind: "query";
  semanticId: string;
  /** Refers to the existing Operational Query Plane request contract. */
  request: OperationalQueryRequest;
  purpose: string;
  entityRefs: string[];
  dependsOn: string[];
  /** Optional on certified P1 compatibility IR; mandatory for P2 declaration-only
   * semantics when no audited query catalog entry can infer the exact reads. */
  effectDeclaration?: EffectDeclaration;
}

export interface EffectTargetBinding {
  entityRef: string;
  /** Exact path in arguments that carries the canonical id. */
  payloadPath: string;
}

export interface ExistingCommandGraph {
  kind: "workflow" | "single_action";
  commandType: string;
  requiresConfirmation: boolean;
  autoApprove: boolean;
}

export interface EffectDomainActionCompatibility {
  /** Audited existing compiler output, retained only for deterministic lowering. */
  compiledGraph: ExistingCommandGraph;
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }> | null;
}

/** Planning-level intended change. It is not a BusinessEffect, provider operation,
 * execution receipt, authority grant, or idempotency identity. */
export interface Effect {
  kind: "effect";
  semanticId: string;
  operation: string;
  arguments: JsonObject;
  targets: EffectTargetBinding[];
  intendedState: Predicate;
  requiredCapability: string;
  consequential: boolean;
  expectedObservationRefs: string[];
  dependsOn: string[];
  domainActionCompatibility?: EffectDomainActionCompatibility;
  /** Typed static semantics. Legacy P1 nodes may omit it and enter audited inference;
   * unsupported or unsafe inference never defaults to admissible. */
  effectDeclaration?: EffectDeclaration;
}

export type ObservationEvidence =
  | { kind: "canonical_query"; queryRef: string; assertion: Predicate }
  | { kind: "canonical_state"; entityRef: string; assertion: Predicate }
  | { kind: "effect_verification"; effectRef: string; minimumState: "verified" }
  | { kind: "objective_success"; condition: ObjectiveSuccessCondition }
  | { kind: "matched_event"; eventType: string; subjectRefs: string[] }
  | { kind: "delegation_state"; entityRef: string; requiredStatus: "acknowledged" | "accepted" | "completed" }
  | { kind: "computer_state"; effectRef: string; evidenceRequired: true }
  | { kind: "workflow_completion"; effectRef: string }
  | { kind: "recorded_result"; effectRef: string };

export interface Observation {
  kind: "observation";
  semanticId: string;
  subject: { kind: "goal" | "effect"; ref: string };
  description: string;
  strength: "REQUIRED" | "SUPPLEMENTAL";
  /** This literal prevents IR from declaring a lower verification floor. */
  verificationFloor: "EXISTING_OR_STRONGER";
  evidence: ObservationEvidence;
}

export interface Sequence {
  kind: "sequence";
  semanticId: string;
  steps: ProgramNode[];
}

export interface Parallel {
  kind: "parallel";
  semanticId: string;
  branches: ProgramNode[];
}

export interface BranchCase {
  caseId: string;
  when: Predicate;
  then: ProgramNode;
}

export interface Branch {
  kind: "branch";
  semanticId: string;
  evaluation: "FIRST_MATCH";
  cases: BranchCase[];
  otherwise?: ProgramNode;
}

export interface WaitEventRef {
  type: string;
  id: string;
}

export interface WaitEvent {
  eventType: string;
  refs: WaitEventRef[];
}

export interface Wait {
  kind: "wait";
  semanticId: string;
  condition: Predicate;
  event?: WaitEvent;
  deadlineAt?: string;
  dependsOn: string[];
}

export interface Compensation {
  kind: "compensation";
  semanticId: string;
  forEffectId: string;
  trigger: "ON_FAILURE" | "ON_PARTIAL_FAILURE" | "MANUAL";
  effect: Effect;
  dependsOn: string[];
}

export type ProgramNode = Query | Effect | Sequence | Parallel | Branch | Wait | Compensation;

export interface SuccessCondition {
  kind: "success_condition";
  semanticId: string;
  statement: string;
  mode: "ALL";
  criteria: Array<
    | { kind: "predicate"; predicate: Predicate }
    | { kind: "observation"; observationRef: string }
    | { kind: "existing_objective_success"; condition: ObjectiveSuccessCondition }
  >;
}

export interface Budget {
  kind: "budget";
  semanticId: string;
  maxSteps?: number;
  maxEffects?: number;
  maxQueries?: number;
  maxWaits?: number;
  maxCost?: { amount: number; currency: string };
  deadlineAt?: string;
}

/** Explicit bounded include/exclude semantics required by existing interaction
 * targeting and by semantic-diff safety checks. */
export interface ProgramScope {
  kind: "scope";
  semanticId: string;
  includeEntityRefs: string[];
  excludeEntityRefs: string[];
  bounded: boolean;
  cohortQueryRef?: string;
}

export interface OperationalProgram {
  kind: "operational_program";
  semanticId: string;
  irSchemaVersion: typeof IR_SCHEMA_VERSION;
  compilerVersion: string;
  provenance: Provenance;
  nonSemantic?: NonSemanticMetadata;
  irSemanticHash: IrSemanticHash;
  executionModel: InstructionExecutionModel;
  goal: Goal;
  constraints: Constraint[];
  entities: EntityRef[];
  scope: ProgramScope;
  body: ProgramNode;
  observations: Observation[];
  successCondition: SuccessCondition;
  budget?: Budget;
}

export type OperationalProgramDraft = Omit<OperationalProgram, "irSemanticHash">;

export const ADAPTER_CLASSIFICATIONS = ["LOSSLESS", "LOSSY", "NOT_APPLICABLE", "UNSUPPORTED"] as const;
export type AdapterClassification = (typeof ADAPTER_CLASSIFICATIONS)[number];

export interface AdapterResult<T> {
  classification: AdapterClassification;
  value?: T;
  reasons: string[];
  preserved: string[];
  omitted: string[];
}
