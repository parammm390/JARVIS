/**
 * P6 is an offline hypothesis compiler. These contracts carry no executable
 * callback, provider client, database handle, authority grant, Work mutation, or
 * certified OperationalProgram. Every identity is deliberately outside all
 * authoritative P0-P5 identity domains.
 */

export const TRACE_COMPILER_VERSION = 1 as const;
export const TRACE_IR_VERSION = 1 as const;
export const PROCEDURE_CANDIDATE_VERSION = 1 as const;
export const TRACE_ID_PREFIX = "p6:trace:sha256:" as const;
export const CANDIDATE_ID_PREFIX = "p6:candidate:sha256:" as const;
export const ALIGNMENT_ID_PREFIX = "p6:alignment:sha256:" as const;
export const NORMALIZER_VERSION = "p6-normalizer-v1" as const;
export const DATAFLOW_VERSION = "p6-dataflow-v1" as const;
export const ALIGNMENT_VERSION = "p6-semantic-alignment-v1" as const;
export const ANTI_UNIFIER_VERSION = "p6-conservative-anti-unifier-v1" as const;
export const REDACTION_VERSION = "p6-semantic-redaction-v1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

export type TraceId = `${typeof TRACE_ID_PREFIX}${string}`;
export type ProcedureCandidateId = `${typeof CANDIDATE_ID_PREFIX}${string}`;
export type TraceAlignmentId = `${typeof ALIGNMENT_ID_PREFIX}${string}`;

export type EvidenceClass = "REAL_EXECUTION" | "SIMULATED_EXECUTION" | "REPLAY_FIXTURE";

export type TraceValidity =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "RECOVERED_SUCCESS"
  | "FAILURE"
  | "AMBIGUOUS"
  | "CORRUPT"
  | "INCOMPLETE";

export type TraceNodeSemanticKind =
  | "INSTRUCTION"
  | "WORK_TRANSITION"
  | "QUERY"
  | "ACTION"
  | "PROVIDER_OPERATION"
  | "COMPUTER_OPERATION"
  | "OBSERVATION"
  | "VERIFICATION"
  | "SUCCESS_CONDITION"
  | "AUTHORITY_GATE"
  | "APPROVAL_GATE"
  | "MODEL_DECISION"
  | "BRANCH_DECISION"
  | "LOOP_ITERATION"
  | "WAIT"
  | "RETRY_ATTEMPT"
  | "RECONCILIATION"
  | "COMPENSATION"
  | "FAILURE";

export type TraceEdgeKind =
  | "CONTROL"
  | "DATA"
  | "CAUSAL"
  | "OBSERVATION"
  | "AUTHORITY"
  | "RETRY"
  | "COMPENSATION"
  | "TEMPORAL";

export type TraceSourceKind =
  | "WORK"
  | "WORK_EVENT"
  | "OBJECTIVE_RUNTIME"
  | "BUSINESS_EFFECT"
  | "AUTHORIZED_COMMAND"
  | "WORKFLOW_STEP"
  | "DURABLE_JOB"
  | "DECISION_RECEIPT"
  | "CAUSAL_REPLAY"
  | "EXECUTION_PROJECTION"
  | "PROVIDER_OPERATION"
  | "WEBHOOK_OBSERVATION"
  | "EXTERNAL_OBSERVATION"
  | "COMPUTER_TRACE"
  | "OPERATIONAL_QUERY"
  | "AUTHORITY_DECISION"
  | "HUMAN_APPROVAL"
  | "RECONCILIATION"
  | "COMPENSATION"
  | "INSTRUCTION_EVENT"
  | "P3_EPISTEMIC_TRACE"
  | "P4_PROGRAM_SEARCH_RECEIPT"
  | "P5_SIMULATION_TRACE"
  | "REPLAY_FIXTURE";

export type TraceValueRole =
  | "SOURCE"
  | "PARAMETER"
  | "CONSTANT"
  | "DERIVED"
  | "LOOKUP_RESULT"
  | "EXTERNAL_OBSERVATION"
  | "MODEL_DECISION"
  | "USER_INPUT"
  | "RUNTIME_GENERATED";

export type ValueSensitivity =
  | "PUBLIC"
  | "TENANT_INTERNAL"
  | "CUSTOMER_DATA"
  | "PII"
  | "FINANCIAL"
  | "CREDENTIAL_BOUND"
  | "SECRET";

export type ParameterClassification =
  | "CONSTANT"
  | "PARAMETER"
  | "DERIVED_PARAMETER"
  | "ENVIRONMENT_BOUND"
  | "TENANT_BOUND"
  | "UNKNOWN";

export interface SourceIdentityMappings {
  workIds: string[];
  businessEffectIds: string[];
  businessEffectSemanticHashes: string[];
  providerOperationIds: string[];
  idempotencyKeys: string[];
  operationalIrSemanticHashes: string[];
  p5SimulationTraceIds: string[];
  commandIds: string[];
  workflowRunIds: string[];
  workflowStepIds: string[];
  decisionReceiptIds: string[];
  computerRunIds: string[];
  queryExecutionIds: string[];
  instructionIds: string[];
  authorityDecisionIds: string[];
  other: Array<{ domain: string; id: string }>;
}

export interface TraceOperationIdentity {
  semanticOperation: string;
  goal: string;
  plannerIrSemanticHash: string | null;
  executionModel: string | null;
  sourceOperationRefs: string[];
}

export interface TraceValueProvenance {
  evidenceIds: string[];
  sourceRefs: string[];
  derivedFromValueIds: string[];
  derivationRule: { id: string; version: string } | null;
  complete: boolean;
}

export type TraceValueRepresentation =
  | { kind: "LITERAL"; value: JsonValue }
  | { kind: "TYPED_PLACEHOLDER"; placeholder: string }
  | { kind: "OPAQUE_TOKEN"; token: string };

export interface TraceValue {
  valueId: string;
  path: string;
  role: TraceValueRole;
  semanticType: string;
  sensitivity: ValueSensitivity;
  representation: TraceValueRepresentation;
  /** Equality only; never reversible raw material. Null for secrets. */
  equalityToken: string | null;
  bindingScope: "EXECUTION" | "ENVIRONMENT" | "TENANT" | "GLOBAL" | "UNKNOWN";
  provenance: TraceValueProvenance;
}

export type PredicateOperator =
  | "EXISTS"
  | "NOT_EXISTS"
  | "EQ"
  | "NEQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "CONTAINS"
  | "AVAILABLE";

export interface TracePredicate {
  predicateId: string;
  subjectPath: string;
  operator: PredicateOperator;
  expected: TraceValueRepresentation | null;
  state: "TRUE" | "FALSE" | "UNKNOWN";
  safetyCritical: boolean;
  evidenceIds: string[];
}

export interface TraceObservation {
  observationId: string;
  kind: "CANONICAL" | "PROVIDER" | "WEBHOOK" | "COMPUTER" | "USER" | "EVENT" | "MODEL_OUTPUT";
  subject: string;
  state: "OBSERVED" | "ABSENT" | "DIVERGENT" | "UNKNOWN";
  externalRealityRequired: boolean;
  evidenceIds: string[];
}

export interface TraceAuthorityContext {
  requirementObserved: boolean;
  capability: string | null;
  risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  authorityState: "ALLOWED" | "APPROVAL_REQUIRED" | "DENIED" | "CHANGED" | "UNKNOWN";
  decisionId: string | null;
  revision: number | null;
  approvalRequired: boolean;
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "UNKNOWN";
  /** A learned artifact may preserve requirements but never issue a grant. */
  grantsAuthority: false;
}

export interface TraceTiming {
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export interface TraceFailure {
  kind: "RETRYABLE" | "TERMINAL" | "CONFLICT" | "AUTH" | "VALIDATION" | "PROVIDER_DOWN" | "NEEDS_HUMAN" | "CONFIG" | "UNKNOWN_OUTCOME" | "UNKNOWN";
  reasonCode: string;
  possibleExternalMutation: boolean;
  reconciliationRequired: boolean;
}

export interface TraceNodeOutcome {
  status: "NOT_STARTED" | "SUCCEEDED" | "FAILED" | "PARTIAL" | "AMBIGUOUS" | "BLOCKED" | "CANCELLED" | "UNKNOWN";
  verified: boolean;
  verificationBasis: string | null;
  failure: TraceFailure | null;
}

export interface TraceOperation {
  name: string;
  equivalenceClass: string;
  effectClass: string | null;
  consequential: boolean;
  providerClass: string | null;
}

export interface RetryEvidence {
  family: string;
  attempt: number;
  trigger: string;
  delayMs: number | null;
  backoffEvidence: string | null;
  idempotencyEvidence: string | null;
  reconciliationBeforeAttempt: boolean;
  humanInitiated: boolean;
}

export interface LoopEvidence {
  family: string;
  iteration: number;
  iteratorSource: string | null;
  itemValueId: string | null;
  terminationCondition: string | null;
  ordering: "SEQUENTIAL" | "PARALLEL" | "UNKNOWN";
}

export interface WaitEvidence {
  kind: "FIXED_DURATION" | "EVENT_DRIVEN" | "DEADLINE" | "POLLING" | "UNKNOWN";
  durationMs: number | null;
  eventType: string | null;
  deadline: string | null;
  pollIntervalMs: number | null;
  terminalPredicateId: string | null;
}

export interface BranchEvidence {
  family: string;
  arm: string;
  predicateId: string;
  observedPredicateState: "TRUE" | "FALSE" | "UNKNOWN";
}

export interface ModelDecisionEvidence {
  purpose: string;
  inputSchema: string[];
  outputSchema: string;
  constraints: string[];
  hiddenReasoningPersisted: false;
}

export interface TraceNodeProvenance {
  evidenceClass: EvidenceClass;
  sourceKind: TraceSourceKind;
  evidenceIds: string[];
  sourceRefs: string[];
  sourceIdentities: SourceIdentityMappings;
  uncertainty: string[];
  synthetic: boolean;
}

export interface TraceNode {
  nodeId: string;
  semanticKind: TraceNodeSemanticKind;
  operation: TraceOperation;
  inputs: TraceValue[];
  outputs: TraceValue[];
  predicates: TracePredicate[];
  observations: TraceObservation[];
  authorityContext: TraceAuthorityContext;
  timing: TraceTiming;
  outcome: TraceNodeOutcome;
  retry: RetryEvidence | null;
  loop: LoopEvidence | null;
  wait: WaitEvidence | null;
  branch: BranchEvidence | null;
  modelDecision: ModelDecisionEvidence | null;
  provenance: TraceNodeProvenance;
}

export interface TraceValueBinding {
  fromValueId: string;
  toValueId: string;
  derivation: "IDENTITY" | "EXPLICIT_TRANSFORM" | "LOOKUP" | "OBSERVATION" | "UNKNOWN";
  ruleRef: string | null;
}

export interface TraceEdge {
  edgeId: string;
  from: string;
  to: string;
  kind: TraceEdgeKind;
  valueBindings: TraceValueBinding[];
  certainty: "PROVEN" | "INFERRED" | "MISSING";
  evidenceIds: string[];
}

export interface TraceRedactionSummary {
  piiLiteralsRedacted: number;
  customerDataLiteralsRedacted: number;
  credentialValuesRedacted: number;
  secretValuesDiscarded: number;
  rawSecretLeakage: 0;
  modelChainOfThoughtPersisted: 0;
}

export interface TraceProvenance {
  evidenceClasses: EvidenceClass[];
  sourceKinds: TraceSourceKind[];
  sourceIdentities: SourceIdentityMappings;
  sourceEvidenceHash: string;
  compiler: {
    traceIrVersion: typeof TRACE_IR_VERSION;
    normalizerVersion: string;
    dataflowVersion: string;
    seed: number;
    fixedClock: string;
  };
  redaction: TraceRedactionSummary;
  uncertainty: string[];
}

export interface ExecutionTrace {
  version: typeof TRACE_IR_VERSION;
  traceId: TraceId;
  tenantId: string;
  operationIdentity: TraceOperationIdentity;
  startedAt: string;
  endedAt: string | null;
  outcome: TraceValidity;
  nodes: TraceNode[];
  edges: TraceEdge[];
  inputs: TraceValue[];
  outputs: TraceValue[];
  provenance: TraceProvenance;
}

export interface SemanticValueInput {
  path: string;
  value: unknown;
  role: TraceValueRole;
  semanticType?: string;
  sensitivity?: ValueSensitivity;
  bindingScope?: TraceValue["bindingScope"];
  derivedFrom?: Array<{ eventId: string; path: string }>;
  derivationRule?: { id: string; version: string };
  provenanceComplete?: boolean;
}

export interface RawPredicateInput {
  predicateId?: string;
  subjectPath: string;
  operator: PredicateOperator;
  expected?: unknown;
  state: TracePredicate["state"];
  safetyCritical?: boolean;
}

export interface RawObservationInput {
  observationId?: string;
  kind: TraceObservation["kind"];
  subject: string;
  state: TraceObservation["state"];
  externalRealityRequired?: boolean;
}

export interface RawParentRefs {
  control: string[];
  causal: string[];
  observationOf: string[];
  authorityFor: string[];
  temporalAfter: string[];
  retryOf: string[];
  compensationFor: string[];
}

export interface RawDataBinding {
  fromEventId: string;
  fromPath: string;
  toPath: string;
  derivation: TraceValueBinding["derivation"];
  ruleRef?: string;
}

export interface RawEvidenceEvent {
  eventId: string;
  tenantId: string;
  evidenceClass: EvidenceClass;
  sourceKind: TraceSourceKind;
  sourceRef: string;
  occurredAt: string;
  endedAt?: string;
  sequence?: number;
  semanticKind: TraceNodeSemanticKind;
  operation: {
    name: string;
    equivalenceClass?: string;
    effectClass?: string;
    consequential?: boolean;
    providerClass?: string;
  };
  inputs?: SemanticValueInput[];
  outputs?: SemanticValueInput[];
  predicates?: RawPredicateInput[];
  observations?: RawObservationInput[];
  authority?: Partial<Omit<TraceAuthorityContext, "grantsAuthority">>;
  outcome?: Partial<TraceNodeOutcome> & { failure?: Partial<TraceFailure> | null };
  sourceIdentities?: Partial<SourceIdentityMappings>;
  parents?: Partial<RawParentRefs>;
  dataBindings?: RawDataBinding[];
  retry?: RetryEvidence;
  loop?: LoopEvidence;
  wait?: WaitEvidence;
  branch?: BranchEvidence;
  modelDecision?: Omit<ModelDecisionEvidence, "hiddenReasoningPersisted">;
  uncertainty?: string[];
}

export interface CompletionEvidence {
  workStatus: string | null;
  objectiveVerification: "VERIFIED" | "UNSATISFIED" | "BLOCKED" | "NOT_APPLICABLE" | "UNKNOWN";
  effectVerifications: Array<"VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "DIVERGENT" | "RECONCILIATION_REQUIRED" | "NOT_APPLICABLE">;
  providerAcknowledged: boolean;
  recovered: boolean;
  terminalFailure: boolean;
  ambiguousExternalOutcome: boolean;
  explicitlyIncomplete: boolean;
}

export interface SourceTraceBundle {
  tenantId: string;
  operationIdentity: TraceOperationIdentity;
  startedAt: string;
  endedAt?: string;
  events: RawEvidenceEvent[];
  completion: CompletionEvidence;
}

export interface TraceCompilerOptions {
  fixedClock: string;
  seed: number;
  normalizerVersion?: string;
  dataflowVersion?: string;
  alignmentVersion?: string;
  antiUnifierVersion?: string;
  equalitySalt: string;
}

export interface TraceValidationIssue {
  code: string;
  nodeId: string | null;
  edgeId: string | null;
  consequential: boolean;
}

export interface TraceValidationResult {
  outcome: TraceValidity;
  issues: TraceValidationIssue[];
  trainingEligible: boolean;
  realSuccess: boolean;
}

export interface DataflowReconstructionResult {
  edges: TraceEdge[];
  explicitBindings: number;
  equalityBindings: number;
  unresolvedDerivedValues: string[];
  deterministic: true;
}

export interface AlignmentMember {
  traceId: TraceId;
  nodeIds: string[];
}

export interface AlignmentGroup {
  groupId: string;
  semanticKey: string;
  semanticKind: TraceNodeSemanticKind;
  operation: string;
  members: AlignmentMember[];
  supportingTraceCount: number;
  optional: boolean;
  repeatedWithinTrace: boolean;
  safetyCritical: boolean;
}

export interface UnmatchedAlignmentNode {
  traceId: TraceId;
  nodeId: string;
  reason: "NO_SEMANTIC_PEER" | "SAFETY_BOUNDARY_MISMATCH" | "AMBIGUOUS_EQUIVALENCE";
}

export interface TraceAlignment {
  version: 1;
  alignmentId: TraceAlignmentId;
  tenantScope: "SINGLE_TENANT" | "ANONYMIZED_CROSS_TENANT";
  traceIds: TraceId[];
  groups: AlignmentGroup[];
  unmatched: UnmatchedAlignmentNode[];
  algorithmVersion: string;
  deterministic: true;
}

export interface SupportMetrics {
  supportingTraceCount: number;
  contradictingTraceCount: number;
  successTraceCount: number;
  failureTraceCount: number;
  tenantCount: number;
  timeRange: { start: string; end: string } | null;
  coverage: { numerator: number; denominator: number };
  realExecution: { supporting: number; contradicting: number };
  simulatedExecution: { supporting: number; contradicting: number };
  replayFixture: { supporting: number; contradicting: number };
  sampleQuality: "SINGLE_TRACE_HYPOTHESIS" | "LIMITED" | "MULTI_TRACE" | "CONTRADICTORY";
}

export interface ProcedureParameter {
  parameterId: string;
  path: string;
  semanticType: string;
  classification: ParameterClassification;
  required: boolean;
  sensitivity: ValueSensitivity;
  evidenceValues: number;
  support: SupportMetrics;
  uncertainty: string[];
}

export interface ProcedureConstant {
  constantId: string;
  path: string;
  semanticType: string;
  value: TraceValueRepresentation;
  support: SupportMetrics;
  universalClaim: false;
}

export interface ProcedureDerivedValue {
  valueId: string;
  semanticType: string;
  sourceParameters: string[];
  derivationRules: Array<{ id: string; version: string }>;
  provenanceComplete: boolean;
  support: SupportMetrics;
}

export type InferredPredicateClassification = "OBSERVED_REQUIRED" | "CANDIDATE_REQUIRED" | "INCIDENTAL" | "UNKNOWN";

export interface InferredPredicate {
  predicateId: string;
  subjectPath: string;
  operator: PredicateOperator;
  expected: TraceValueRepresentation | null;
  classification: InferredPredicateClassification;
  safetyCritical: boolean;
  support: SupportMetrics;
  evidence: Array<{ traceId: TraceId; nodeId: string; state: TracePredicate["state"] }>;
}

export interface ProcedureBranchArm {
  label: string;
  observedPredicateState: TracePredicate["state"];
  stepIds: string[];
  outcomes: TraceNodeOutcome["status"][];
  support: SupportMetrics;
}

export interface ProcedureBranch {
  branchId: string;
  predicateId: string;
  arms: ProcedureBranchArm[];
  evidenceTraceIds: TraceId[];
  unseenArmsInvented: 0;
}

export interface ProcedureRetry {
  retryId: string;
  operation: string;
  trigger: string;
  attemptCounts: number[];
  delaysMs: number[];
  backoffEvidence: string[];
  terminalConditions: string[];
  classification: "SAFE_RETRY" | "RECONCILIATION_BEFORE_RETRY" | "HUMAN_RETRY" | "UNKNOWN";
  automatic: boolean;
  support: SupportMetrics;
}

export interface ProcedureLoop {
  loopId: string;
  iteratorSource: string;
  bodyStepIds: string[];
  terminationCondition: string;
  ordering: LoopEvidence["ordering"];
  parallelismEvidence: string[];
  support: SupportMetrics;
  boundedStructuralEvidence: true;
}

export interface ProcedureWait {
  waitId: string;
  stepId: string;
  kind: WaitEvidence["kind"];
  durationsMs: number[];
  eventTypes: string[];
  deadlines: string[];
  pollIntervalsMs: number[];
  terminalPredicateIds: string[];
  support: SupportMetrics;
}

export interface ProcedureObservation {
  observationId: string;
  stepId: string;
  kind: TraceObservation["kind"];
  subject: string;
  externalRealityRequired: boolean;
  continuationPredicateIds: string[];
  support: SupportMetrics;
}

export interface ProcedureAuthorityRequirement {
  requirementId: string;
  stepId: string;
  capability: string | null;
  risk: TraceAuthorityContext["risk"];
  approvalRequired: boolean;
  observedStatuses: TraceAuthorityContext["approvalStatus"][];
  grantsAuthority: false;
  support: SupportMetrics;
}

export interface ProcedureModelDecision {
  decisionId: string;
  stepId: string;
  purpose: string;
  inputSchemas: string[];
  outputSchema: string;
  constraints: string[];
  promptTranscriptPersisted: false;
  chainOfThoughtPersisted: false;
  support: SupportMetrics;
}

export interface ProcedureCompensation {
  compensationId: string;
  stepId: string;
  compensatesStepIds: string[];
  operation: string;
  support: SupportMetrics;
}

export interface ProcedureSuccessCondition {
  conditionId: string;
  stepId: string;
  operation: string;
  requiresVerifiedReality: boolean;
  support: SupportMetrics;
}

export interface ProcedureStep {
  stepId: string;
  semanticKind: TraceNodeSemanticKind;
  operation: string;
  equivalenceClass: string;
  optional: boolean;
  consequential: boolean;
  parameterRefs: string[];
  constantRefs: string[];
  derivedValueRefs: string[];
  predicateRefs: string[];
  authorityRequirementRefs: string[];
  observationRefs: string[];
  sourceAlignmentGroupId: string;
}

export interface ProcedureProgramEdge {
  from: string;
  to: string;
  kind: TraceEdgeKind;
  support: SupportMetrics;
}

export interface ProcedureEvidence {
  positiveRealTraceIds: TraceId[];
  negativeRealTraceIds: TraceId[];
  simulatedStructuralTraceIds: TraceId[];
  replayFixtureTraceIds: TraceId[];
  alignmentId: TraceAlignmentId;
  sourceIdentities: SourceIdentityMappings;
  plannedExecutionDivergences: Array<{ traceId: TraceId; plannedIrSemanticHash: string; actualOperations: string[] }>;
  negativeOnlyExcludedOperations: Array<{
    operation: string;
    semanticKind: TraceNodeSemanticKind;
    traceIds: TraceId[];
    reason: "NEGATIVE_ONLY_NOT_POSITIVE_PROCEDURE_BODY";
  }>;
}

export interface ProcedureCandidate {
  version: typeof PROCEDURE_CANDIDATE_VERSION;
  candidateId: ProcedureCandidateId;
  artifactKind: "PROCEDURE_CANDIDATE";
  executionStatus: "NON_EXECUTABLE_HYPOTHESIS";
  certificationStatus: "UNCERTIFIED_P6_HYPOTHESIS";
  goalPattern: { semanticGoal: string; operation: string };
  parameters: ProcedureParameter[];
  constants: ProcedureConstant[];
  derivedValues: ProcedureDerivedValue[];
  programStructure: { steps: ProcedureStep[]; edges: ProcedureProgramEdge[] };
  predicates: InferredPredicate[];
  branches: ProcedureBranch[];
  loops: ProcedureLoop[];
  retries: ProcedureRetry[];
  waits: ProcedureWait[];
  observations: ProcedureObservation[];
  authorityRequirements: ProcedureAuthorityRequirement[];
  modelDecisions: ProcedureModelDecision[];
  compensation: ProcedureCompensation[];
  successConditions: ProcedureSuccessCondition[];
  evidence: ProcedureEvidence;
  support: SupportMetrics;
  uncertainty: string[];
  provenance: {
    compilerVersion: typeof TRACE_COMPILER_VERSION;
    normalizerVersion: string;
    alignmentVersion: string;
    antiUnifierVersion: string;
    seed: number;
    fixedClock: string;
      crossTenantAnonymized: boolean;
      rawPrivateValuesPersisted: false;
      sourceIdentityValuesOpaque: true;
      realAndSyntheticSupportSeparated: true;
  };
  operationalIrCompatibility: {
    convertibleStepIds: string[];
    unsupportedStepIds: string[];
    automaticPlannerInput: false;
  };
}

export type ProcedureSemanticDiffClassification =
  | "FAITHFUL_GENERALIZATION"
  | "STRICTER_SAFE"
  | "OVER_GENERALIZED"
  | "UNDER_GENERALIZED"
  | "UNSUPPORTED"
  | "FIXTURE_INVALID";

export type SemanticDiffDimension =
  | "goal"
  | "parameters"
  | "constants"
  | "dataflow"
  | "operations"
  | "dependencies"
  | "branches"
  | "loops"
  | "retries"
  | "waits"
  | "authority"
  | "effects"
  | "observations"
  | "success_conditions"
  | "compensation";

export interface ProcedureSemanticDiff {
  classification: ProcedureSemanticDiffClassification;
  dimensions: Record<SemanticDiffDimension, "PRESERVED" | "STRICTER" | "MISSING" | "EXTRA" | "UNSUPPORTED">;
  reasonCodes: string[];
  consequentialGateRemovals: number;
  authorityRequirementRemovals: number;
  observationRequirementRemovals: number;
  verificationRequirementRemovals: number;
  recoveryEdgeRemovals: number;
}

export interface CompileProcedureResult {
  candidate: ProcedureCandidate;
  alignment: TraceAlignment;
  semanticDiff: ProcedureSemanticDiff;
  traceValidation: Array<{ traceId: TraceId; validation: TraceValidationResult }>;
}
