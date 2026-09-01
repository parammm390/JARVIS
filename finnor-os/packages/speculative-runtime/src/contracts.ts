import type {
  ConfidenceLevel,
  EpistemicState,
  PropositionStatus,
} from "@finnor/epistemic-runtime";
import type {
  JsonObject,
  JsonValue,
  Observation,
  OperationalProgram,
  Predicate,
  StaticAdmissibilityStatus,
} from "@finnor/operational-ir";

/**
 * P5 is a planning-time world predictor. Every identity below is deliberately
 * outside BusinessEffect, Work, DomainAction, provider-operation, idempotency,
 * and Operational IR identity domains.
 */
export const SPECULATIVE_RUNTIME_VERSION = 1 as const;
export const P5_IDENTITY_VERSION = "p5-world-runtime-v1" as const;
export const SNAPSHOT_HASH_PREFIX = "p5:snapshot:sha256:" as const;
export const BRANCH_HASH_PREFIX = "p5:branch:sha256:" as const;
export const OVERLAY_HASH_PREFIX = "p5:overlay:sha256:" as const;
export const HYPOTHETICAL_EFFECT_HASH_PREFIX = "p5:hypothetical-effect:sha256:" as const;
export const TRACE_HASH_PREFIX = "p5:trace:sha256:" as const;
export const REPLAY_HASH_PREFIX = "p5:replay:sha256:" as const;

export type WorldSnapshotId = `${typeof SNAPSHOT_HASH_PREFIX}${string}`;
export type WorldBranchId = `${typeof BRANCH_HASH_PREFIX}${string}`;
export type EffectOverlayId = `${typeof OVERLAY_HASH_PREFIX}${string}`;
export type HypotheticalEffectId = `${typeof HYPOTHETICAL_EFFECT_HASH_PREFIX}${string}`;
export type SimulationTraceId = `${typeof TRACE_HASH_PREFIX}${string}`;
export type SimulationReplayIdentity = `${typeof REPLAY_HASH_PREFIX}${string}`;

export type WorldEntityKind = "entity" | "party" | "resource" | "work";

export interface WorldEntityRef {
  kind: WorldEntityKind;
  type: string;
  id: string;
}

export interface WorldMaterializationSelector {
  ref: WorldEntityRef;
  fields: string[];
  purpose: "PROGRAM_ENTITY" | "EFFECT_READ" | "EFFECT_WRITE" | "WORK_CONTEXT" | "OBSERVATION";
  sourceSemanticRef: string;
}

export interface WorldStateInput {
  tenantId: string;
  ref: WorldEntityRef;
  /** Bounded business fields only. Credentials, sessions, and unrestricted rows are forbidden. */
  values: JsonObject;
  observedAt: string;
  sourceVersion?: string;
  provenance: {
    owner: string;
    sourceRef: string;
    evidenceRefs: string[];
  };
}

export interface WorldStateRecord extends Omit<WorldStateInput, "sourceVersion"> {
  stateHash: `p5:state:sha256:${string}`;
  sourceVersion: string | null;
}

export interface SnapshotObservationInput {
  id: string;
  tenantId: string;
  subject: { kind: "query" | "entity" | "effect" | "work" | "event"; ref: string };
  state: "OBSERVED" | "MISSING" | "UNKNOWN";
  value: JsonValue;
  observedAt: string;
  evidenceRefs: string[];
  provenance: { owner: string; sourceRef: string };
}

export interface EpistemicSnapshotInput {
  propositionId: string;
  status: PropositionStatus;
  value: JsonValue | null;
  confidenceQuality: ConfidenceLevel;
  evidenceRefs: string[];
  provenanceComplete: boolean;
}

export interface SnapshotMaterialization {
  tenantId: string;
  canonicalState: WorldStateInput[];
  workState: WorldStateInput[];
  relevantObservations: SnapshotObservationInput[];
  epistemicInputs?: EpistemicSnapshotInput[];
  sourceRefs: string[];
}

export interface SnapshotMaterializationRequest {
  tenantId: string;
  asOf: string;
  programIrSemanticHash: OperationalProgram["irSemanticHash"];
  selectors: WorldMaterializationSelector[];
}

/** The only snapshot input seam is read-only and tenant-explicit. P5 never imports a DB client. */
export interface WorldSnapshotSource {
  readonly mode: "READ_ONLY";
  readonly sourceId: string;
  materialize(request: SnapshotMaterializationRequest): Promise<SnapshotMaterialization>;
}

export interface WorldSnapshot {
  version: typeof SPECULATIVE_RUNTIME_VERSION;
  kind: "world_snapshot";
  snapshotId: WorldSnapshotId;
  tenantId: string;
  asOf: string;
  canonicalState: readonly WorldStateRecord[];
  workState: readonly WorldStateRecord[];
  relevantObservations: readonly SnapshotObservationInput[];
  epistemicInputs: readonly EpistemicSnapshotInput[];
  provenance: {
    sourceId: string;
    sourceRefs: readonly string[];
    programIrSemanticHash: OperationalProgram["irSemanticHash"];
    materializationSelectors: readonly WorldMaterializationSelector[];
    materializationHash: `p5:materialization:sha256:${string}`;
  };
  immutable: true;
}

export type WorldLikelihood =
  | { kind: "UNRANKED" }
  | {
      kind: "ORDINAL";
      level: "MORE_LIKELY" | "PLAUSIBLE" | "LESS_LIKELY";
      basisRef: string;
    }
  | {
      kind: "EMPIRICAL";
      occurrences: number;
      sampleSize: number;
      datasetRef: string;
      measuredAt: string;
    };

export type SimulatedOperationalStatus =
  | "SUCCESS"
  | "RETRYABLE_FAILURE"
  | "FAILURE"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "TIMEOUT"
  | "STALE_PRECONDITION"
  | "UNKNOWN";

export interface WorldVariableOutcome {
  outcomeId: string;
  value: JsonValue;
  operationalStatus: SimulatedOperationalStatus;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CONSEQUENTIAL";
  likelihood: WorldLikelihood;
  evidenceRefs: string[];
  recovery?: {
    kind: "RETRY" | "RECONCILIATION" | "COMPENSATION" | "MANUAL";
    nextOutcomeId?: string;
    reasonCode: string;
  };
}

export type WorldVariableBinding =
  | { kind: "PREDICATE"; subjectRef: string; path: Array<string | number> }
  | { kind: "EFFECT_OUTCOME"; effectRef: string }
  | { kind: "WAIT_EVENT"; waitRef: string }
  | { kind: "EXTERNAL_STATE"; ref: WorldEntityRef; path: Array<string | number> };

/** P3-owned uncertainty consumed by P5. P5 never calibrates or persists it. */
export interface WorldVariable {
  id: string;
  tenantId: string;
  sourcePropositionId: string;
  binding: WorldVariableBinding;
  possibleOutcomes: WorldVariableOutcome[];
  evidence: string[];
  confidenceQuality: ConfidenceLevel;
  provenance: {
    owner: "P3";
    propositionId: string;
    evidenceRefs: string[];
    asOf: string;
  };
}

export interface BranchAssumption {
  variableId: string;
  outcomeId: string;
  value: JsonValue;
  operationalStatus: SimulatedOperationalStatus;
  risk: WorldVariableOutcome["risk"];
  recovery: WorldVariableOutcome["recovery"] | null;
}

export interface WorldStateChange {
  target: WorldEntityRef;
  path: Array<string | number>;
  beforeExists: boolean;
  before?: JsonValue;
  after: JsonValue;
}

export const SPECULATIVE_ADAPTER_CLASSES = [
  "CANONICAL_READ",
  "CANONICAL_WRITE",
  "COMMUNICATION",
  "FINANCIAL_EFFECT",
  "PROVIDER_MUTATION",
  "COMPUTER_MUTATION",
  "WAIT_EVENT",
  "OBSERVATION",
] as const;
export type SpeculativeAdapterClass = (typeof SPECULATIVE_ADAPTER_CLASSES)[number];

/** A hypothetical projection of a P2-declared planning Effect, never a real BusinessEffect. */
export interface HypotheticalEffect {
  kind: "hypothetical_effect";
  hypotheticalEffectId: HypotheticalEffectId;
  planningEffect: {
    semanticId: string;
    operation: string;
    programIrSemanticHash: OperationalProgram["irSemanticHash"];
  };
  adapterClass: Exclude<SpeculativeAdapterClass, "CANONICAL_READ" | "WAIT_EVENT" | "OBSERVATION">;
  outcome: SimulatedOperationalStatus;
  changes: WorldStateChange[];
  reversibility: "READ_ONLY" | "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE" | "UNKNOWN";
  authoritative: false;
  realBusinessEffectId: null;
  identityDomain: "P5_HYPOTHETICAL";
}

export interface SimulatedQueryResult {
  queryRef: string;
  status: "PREDICTED" | "UNKNOWN" | "FAILED";
  values: JsonObject;
  recordRefs: WorldEntityRef[];
  evidenceRefs: string[];
}

export interface PredictedObservation {
  observationRef: string;
  status: "SATISFIED" | "FAILED" | "UNKNOWN";
  evidenceClass: "CANONICAL_SNAPSHOT" | "HYPOTHETICAL_OVERLAY" | "PREDICTED_EXTERNAL" | "MISSING";
  /** Speculative observations can never claim verified reality. */
  verification: "PREDICTED_ONLY" | "UNKNOWN";
  strength: Observation["strength"];
  reasonCodes: string[];
}

export interface SimulationTraceEntry {
  sequence: number;
  kind:
    | "BRANCH_STARTED"
    | "ASSUMPTION_APPLIED"
    | "NODE_ENTERED"
    | "QUERY_PREDICTED"
    | "EFFECT_PREDICTED"
    | "WAIT_PREDICTED"
    | "BRANCH_CASE_SELECTED"
    | "PARALLEL_MERGED"
    | "RECOVERY_REGISTERED"
    | "RECOVERY_PREDICTED"
    | "OBSERVATION_PREDICTED"
    | "SUCCESS_EVALUATED"
    | "BUDGET_STOP"
    | "UNSUPPORTED_SEMANTICS";
  nodeRef: string | null;
  status: string;
  reasonCodes: string[];
  evidence: Record<string, JsonValue>;
}

export interface RecoveryPathStep {
  kind: "RETRY" | "RECONCILIATION" | "COMPENSATION" | "MANUAL";
  status: "PREDICTED_SUCCESS" | "PREDICTED_FAILURE" | "REQUIRED" | "UNKNOWN";
  effectRef: string | null;
  reasonCodes: string[];
}

export interface BranchFailureMode {
  code: string;
  nodeRef: string | null;
  recoverable: boolean;
  consequential: boolean;
  residualRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
}

export interface BranchOutcome {
  outcome: "PREDICTED_SUCCESS" | "PREDICTED_FAILURE" | "PREDICTED_PARTIAL" | "UNKNOWN";
  goalSatisfaction: {
    status: "SATISFIED" | "UNSATISFIED" | "PARTIAL" | "UNKNOWN";
    ordinal: 0 | 250 | 500 | 750 | 1000;
    reasonCodes: string[];
  };
  hardConstraintStatus: "SATISFIED" | "VIOLATED" | "UNKNOWN";
  effects: Array<{
    hypotheticalEffectId: HypotheticalEffectId;
    planningEffectRef: string;
    adapterClass: HypotheticalEffect["adapterClass"];
    outcome: SimulatedOperationalStatus;
  }>;
  observations: PredictedObservation[];
  verificationStrength: "CANONICAL_PREDICTED" | "HYPOTHETICAL_PREDICTED" | "WEAK_PREDICTED" | "UNKNOWN";
  failureModes: BranchFailureMode[];
  recoveryPath: RecoveryPathStep[];
  recoveryBurden: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  irreversibility: "READ_ONLY" | "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE" | "UNKNOWN";
  humanInterruption: { upperBound: number; basis: "STRUCTURAL" };
  latencyEstimate: { valueMs: number | null; quality: "CONFIGURED" | "EMPIRICAL" | "UNKNOWN"; sourceRef: string | null };
  costEstimate: { amount: number | null; currency: string | null; quality: "CONFIGURED" | "EMPIRICAL" | "UNKNOWN"; sourceRef: string | null };
  uncertaintyRemaining: string[];
  residualDamage: string[];
}

export interface WorldBranch {
  version: typeof SPECULATIVE_RUNTIME_VERSION;
  kind: "world_branch";
  branchId: WorldBranchId;
  tenantId: string;
  baseSnapshotId: WorldSnapshotId;
  parentBranchId: WorldBranchId | null;
  effectOverlayId: EffectOverlayId;
  effectOverlay: readonly HypotheticalEffect[];
  uncertainVariables: readonly WorldVariable[];
  assumptions: readonly BranchAssumption[];
  queryResults: readonly SimulatedQueryResult[];
  simulatedObservations: readonly PredictedObservation[];
  branchTrace: readonly SimulationTraceEntry[];
  failureModes: readonly BranchFailureMode[];
  recoveryPath: readonly RecoveryPathStep[];
  outcome: BranchOutcome | null;
  immutable: true;
}

export interface SimulationBounds {
  maxBranches: number;
  maxDepth: number;
  maxEffects: number;
  maxSimulationSteps: number;
  maxSimulationMs: number;
  maxMemory: number;
}

export interface SimulationGateContext {
  p2Status: StaticAdmissibilityStatus;
  p3Status: "RESOLVED" | "UNRESOLVED";
  p4CandidateHash: `p4:program:sha256:${string}`;
  p4SelectionAuthority: "P4";
}

export interface SpeculativeEstimateInput {
  latencyByCapability?: Record<string, { valueMs: number; quality: "CONFIGURED" | "EMPIRICAL"; sourceRef: string }>;
  costByCapability?: Record<string, { amount: number; currency: string; quality: "CONFIGURED" | "EMPIRICAL"; sourceRef: string }>;
}

export interface SimulateOperationalProgramInput {
  snapshot: WorldSnapshot;
  program: OperationalProgram;
  worldVariables: WorldVariable[];
  bounds: SimulationBounds;
  gates: SimulationGateContext;
  estimates?: SpeculativeEstimateInput;
}

export interface SpeculativeSideEffectCounters {
  realDbMutations: 0;
  realProviderCalls: 0;
  realComputerMutations: 0;
  realAuthorityDecisions: 0;
  realApprovalRequests: 0;
  realWorkTransitions: 0;
  realOutboxWrites: 0;
  realExternalWebhooks: 0;
  realPaymentMutations: 0;
}

export interface SimulationStats {
  requiredBranches: number;
  simulatedBranches: number;
  steps: number;
  effects: number;
  deterministicTimeUnits: number;
  estimatedMemoryBytes: number;
  maxDepthObserved: number;
  budgetExhausted: boolean;
  budgetReasonCodes: string[];
  highRiskBranchesDiscarded: 0;
}

export interface SimulationIssue {
  code: string;
  message: string;
  nodeRef: string | null;
}

export interface SimulationResult {
  version: typeof SPECULATIVE_RUNTIME_VERSION;
  status: "COMPLETE" | "BOUNDED_INCOMPLETE" | "UNSUPPORTED" | "P2_BLOCKED" | "P3_BLOCKED" | "FAILED";
  tenantId: string;
  snapshotId: WorldSnapshotId;
  programIrSemanticHash: OperationalProgram["irSemanticHash"];
  p4CandidateHash: `p4:program:sha256:${string}`;
  snapshotProvenance: {
    asOf: string;
    sourceId: string;
    sourceRefs: readonly string[];
    materializationHash: `p5:materialization:sha256:${string}`;
  };
  programEvidence: {
    semanticId: string;
    executionModel: OperationalProgram["executionModel"];
    nodes: ReadonlyArray<{
      semanticId: string;
      kind: string;
      operation: string | null;
      requiredCapability: string | null;
    }>;
  };
  replayIdentity: SimulationReplayIdentity;
  traceId: SimulationTraceId;
  branches: readonly WorldBranch[];
  branchOutcomes: readonly BranchOutcome[];
  bounds: SimulationBounds;
  stats: SimulationStats;
  issues: readonly SimulationIssue[];
  sideEffects: SpeculativeSideEffectCounters;
  ownership: {
    predictsWorlds: "P5";
    selectsPrograms: "P4";
    epistemicOwner: "P3";
    staticAdmissibilityOwner: "P2";
    authoritativeExecution: "EXISTING_GOVERNED_RUNTIME";
  };
}

export interface PredicateEvaluation {
  state: "TRUE" | "FALSE" | "UNKNOWN";
  reasonCodes: string[];
}

export interface WorldView {
  snapshot: WorldSnapshot;
  branch: WorldBranch;
  program: OperationalProgram;
}

export interface P5SemanticExpectation {
  fixtureValid: boolean;
  supported: boolean;
  consequentialEffectRefs: string[];
  failureModeCodes: string[];
  minimumRecoveryKinds: RecoveryPathStep["kind"][];
  expectedOutcome?: BranchOutcome["outcome"];
}

export type P5SemanticDiffClassification =
  | "EQUIVALENT"
  | "STRICTER_SAFE"
  | "BETTER_PREDICTION"
  | "REGRESSION"
  | "UNSUPPORTED"
  | "FIXTURE_INVALID";

export interface P5SemanticDiff {
  classification: P5SemanticDiffClassification;
  reasonCodes: string[];
}

export interface WorldVariableFromP3Input {
  state: EpistemicState;
  propositionId: string;
  binding: WorldVariableBinding;
  outcomes?: Array<Omit<WorldVariableOutcome, "evidenceRefs"> & { evidenceRefs?: string[] }>;
}

export interface ObservationEvaluationInput {
  observation: Observation;
  view: WorldView;
}

export interface PredicateEvaluationInput {
  predicate: Predicate;
  view: WorldView;
}
