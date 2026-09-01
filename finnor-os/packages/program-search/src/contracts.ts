import type {
  CompatibilityLoweringResult,
  Goal,
  OperationalProgram,
  ProgramEffectSummary,
  StaticAdmissibilityResult,
} from "@finnor/operational-ir";
import type {
  DecisionRequirement,
  EpistemicState,
} from "@finnor/epistemic-runtime";

/**
 * P4 is planning-time search only. A program identity is deliberately outside the
 * BusinessEffect, Work, DomainAction, idempotency, and provider-operation identity
 * domains owned by the governed runtime.
 */
export const PROGRAM_SEARCH_VERSION = 1 as const;
export const PROGRAM_SEARCH_HASH_PREFIX = "p4:program:sha256:" as const;
export const PROGRAM_SEARCH_COST_MODEL_VERSION = "p4-cost-model-v1" as const;
export const PROGRAM_SEARCH_SUCCESS_MODEL_VERSION = "p4-success-heuristic-v1" as const;
export const PROGRAM_SEARCH_SMT_SOLVER_VERSION = "finnor-smt-finite-domain-v1" as const;
export const PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION = "finnor-cp-sat-branch-bound-v1" as const;
export const PROGRAM_SEARCH_REWRITE_SET_VERSION = "p4-guarded-rewrites-v1" as const;

export type ProgramSearchHash = `${typeof PROGRAM_SEARCH_HASH_PREFIX}${string}`;

export type CandidateOrigin =
  | "MODEL_CANDIDATE"
  | "DETERMINISTIC_REWRITE"
  | "CAPABILITY_ALTERNATIVE"
  | "RECOVERY_ALTERNATIVE"
  | "PROCEDURE_TEMPLATE";

export type EstimateQuality = "EMPIRICAL" | "CONFIGURED" | "CONSERVATIVE_HEURISTIC" | "UNKNOWN";

export interface NumericEstimate {
  /** Null is explicit unknown. Extraction uses fallbackAssumption, never zero. */
  value: number | null;
  unit: string;
  source: string;
  version: string;
  quality: EstimateQuality;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  fallbackAssumption: {
    value: number;
    rationale: string;
  };
}

export interface SuccessEstimate {
  /** 0..1000 ordinal only. It is not a calibrated probability claim. */
  ordinal: number | null;
  source: string;
  version: typeof PROGRAM_SEARCH_SUCCESS_MODEL_VERSION | string;
  quality: EstimateQuality;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  calibratedProbability: false;
  fallbackAssumption: {
    ordinal: number;
    rationale: string;
  };
}

export interface ProgramCostEstimate {
  modelCalls: NumericEstimate;
  tokens: NumericEstimate;
  providerCalls: NumericEstimate;
  financialSpend: NumericEstimate;
  expectedLatencyMs: NumericEstimate;
  humanInterruptions: NumericEstimate;
  computerUseMs: NumericEstimate;
  failureRecoveryBurden: NumericEstimate;
}

export interface CapabilityCostProfile {
  modelCalls?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  tokens?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  providerCalls?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  financialSpend?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  expectedLatencyMs?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  humanInterruptions?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  computerUseMs?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
  failureRecoveryBurden?: Partial<NumericEstimate> & Pick<NumericEstimate, "value">;
}

export interface SearchCapability {
  capability: string;
  available: boolean | "UNKNOWN";
  version: string;
  providerClass?: string;
  equivalenceClass?: string;
  operation?: string;
  batch?: {
    compatibleOperation: string;
    batchOperation: string;
    maxItems: number;
    proofRef: string;
    /** Fully typed semantic replacement supplied by an audited capability owner. */
    replacementEffect: Extract<OperationalProgram["body"], { kind: "effect" }>;
  };
  substitution?: {
    replacesCapability: string;
    proofRef: string;
    /** Fully typed replacement; P4 never invents provider semantics. */
    replacementEffect: Extract<OperationalProgram["body"], { kind: "effect" }>;
  };
  compensation?: {
    forOperation: string;
    effect: Extract<OperationalProgram["body"], { kind: "effect" }>;
    proofRef: string;
  };
  requiredPropositionIds?: string[];
  cost: CapabilityCostProfile;
  success: SuccessEstimate;
}

export type DependencyRelationKind =
  | "MUST_PRECEDE"
  | "MAY_PRECEDE"
  | "INDEPENDENT"
  | "CONFLICTS"
  | "COMPENSATES"
  | "ENABLES"
  | "OBSERVES";

export interface DependencyRelation {
  from: string;
  to: string;
  relation: DependencyRelationKind;
  source: "EXPLICIT" | "SEQUENCE" | "EFFECT_CONTRACT" | "RESOURCE_EFFECT" | "COMPENSATION" | "OBSERVATION";
  proofRefs: string[];
}

export interface PartialOrderPlan {
  nodeIds: string[];
  relations: DependencyRelation[];
  topologicalLayers: string[][];
  legal: boolean;
  reasonCodes: string[];
}

export type SmtValue = string | number | boolean;

export type SmtAtom =
  | { kind: "CAPABILITY_AVAILABLE"; capability: string }
  | { kind: "AUTHORITY_DECLARED"; requirementKind: string; capability?: string }
  | { kind: "NODE_PRESENT"; nodeId: string }
  | { kind: "PROGRAM_CONSTRAINT_SATISFIED"; constraintId: string }
  | { kind: "DEPENDENCY_RELATION"; from: string; to: string; relation: DependencyRelationKind }
  | { kind: "FACT_COMPARE"; fact: string; operator: "EQ" | "NEQ" | "GTE" | "LTE"; value: SmtValue };

export type SmtExpression =
  | { kind: "ATOM"; atom: SmtAtom }
  | { kind: "ALL" | "ANY"; expressions: SmtExpression[] }
  | { kind: "NOT"; expression: SmtExpression }
  | { kind: "IMPLIES"; if: SmtExpression; then: SmtExpression };

export interface SmtHardConstraint {
  id: string;
  kind: "SMT";
  description: string;
  expression: SmtExpression;
}

export interface CpSatVariable {
  id: string;
  domain: number[];
}

export type CpSatConstraint =
  | { kind: "ALL_DIFFERENT"; variables: string[] }
  | { kind: "LINEAR"; terms: Array<{ variable: string; coefficient: number }>; operator: "EQ" | "GTE" | "LTE"; bound: number }
  | { kind: "ALLOWED_ASSIGNMENTS"; variables: string[]; tuples: number[][] };

export interface CpSatModel {
  variables: CpSatVariable[];
  constraints: CpSatConstraint[];
  objective?: {
    direction: "MINIMIZE" | "MAXIMIZE";
    terms: Array<{ variable: string; coefficient: number }>;
  };
}

export interface CpSatHardConstraint {
  id: string;
  kind: "CP_SAT";
  description: string;
  model: CpSatModel;
  /** Candidate facts may fix a subset or all variables before solving. */
  candidateFactPrefix: string;
}

export type SearchHardConstraint = SmtHardConstraint | CpSatHardConstraint;

export type SoftObjectiveKind =
  | "PREFER_CAPABILITY"
  | "PREFER_REVERSIBLE"
  | "PREFER_STRONGER_VERIFICATION"
  | "MINIMIZE_HUMAN_INTERRUPTION"
  | "MINIMIZE_LATENCY"
  | "MINIMIZE_FINANCIAL_COST"
  | "MINIMIZE_MODEL_COST";

export interface SearchSoftObjective {
  id: string;
  kind: SoftObjectiveKind;
  capability?: string;
  description: string;
}

export interface SearchBounds {
  maxInitialCandidates: number;
  maxRewriteIterations: number;
  maxSearchNodes: number;
  maxSolverTimeMs: number;
  maxTotalSearchMs: number;
  maxMemoryBytes: number;
}

export interface SearchBudgets {
  maxModelCalls?: number;
  maxTokens?: number;
  maxProviderCalls?: number;
  maxFinancialSpend?: { amount: number; currency: string };
  maxExpectedLatencyMs?: number;
  maxHumanInterruptions?: number;
  maxComputerUseMs?: number;
}

export interface CandidateProgramInput {
  candidateId: string;
  origin: CandidateOrigin;
  originRef: string;
  program: OperationalProgram;
  requiredPropositionIds?: string[];
  /** Typed, replayable facts used by SMT/CP-SAT; no executable callbacks. */
  solverFacts?: Record<string, SmtValue>;
  costOverrides?: Partial<ProgramCostEstimate>;
  successOverride?: SuccessEstimate;
}

export interface SearchProblem {
  version: typeof PROGRAM_SEARCH_VERSION;
  goal: Goal;
  epistemicState: EpistemicState;
  epistemicRequirements: DecisionRequirement[];
  initialPrograms: CandidateProgramInput[];
  hardConstraints: SearchHardConstraint[];
  softObjectives: SearchSoftObjective[];
  capabilities: SearchCapability[];
  budgets: SearchBudgets;
  searchBounds: SearchBounds;
  fixedNow: string;
  seed: number;
  solverVersions: {
    smt: typeof PROGRAM_SEARCH_SMT_SOLVER_VERSION | string;
    cpSat: typeof PROGRAM_SEARCH_CP_SAT_SOLVER_VERSION | string;
  };
  costModelVersion: typeof PROGRAM_SEARCH_COST_MODEL_VERSION | string;
  rewriteSetVersion: typeof PROGRAM_SEARCH_REWRITE_SET_VERSION | string;
  /**
   * Optional P5 evidence gate. Existing P4 callers remain byte-for-byte unchanged
   * when this is absent. REQUIRED fails closed unless every candidate is simulated.
   */
  simulationPolicy?: {
    version: 1;
    mode: "REQUIRED";
  };
}

export interface ProgramSimulationBranchEvidence {
  branchId: string;
  outcome: "PREDICTED_SUCCESS" | "PREDICTED_FAILURE" | "PREDICTED_PARTIAL" | "UNKNOWN";
  goalSatisfactionOrdinal: 0 | 250 | 500 | 750 | 1000;
  hardConstraintStatus: "SATISFIED" | "VIOLATED" | "UNKNOWN";
  verificationStrength: "CANONICAL_PREDICTED" | "HYPOTHETICAL_PREDICTED" | "WEAK_PREDICTED" | "UNKNOWN";
  recoveryBurden: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  irreversibility: "READ_ONLY" | "REVERSIBLE" | "COMPENSATABLE" | "IRREVERSIBLE" | "UNKNOWN";
  humanInterruptionsUpperBound: number;
  latencyMs: number | null;
  financialCost: number | null;
  financialCurrency: string | null;
  failureModeCodes: string[];
  consequentialFailure: boolean;
  uncertaintyRemaining: string[];
}

/**
 * Narrow P5 -> P4 evidence contract. It intentionally excludes callbacks,
 * authoritative receipts, raw entity values, and selection recommendations.
 */
export interface ProgramSimulationEvidence {
  version: 1;
  source: "P5";
  status: "COMPLETE" | "BOUNDED_INCOMPLETE" | "UNSUPPORTED" | "P2_BLOCKED" | "P3_BLOCKED" | "FAILED";
  tenantId: string;
  programIrSemanticHash: OperationalProgram["irSemanticHash"];
  p4CandidateHash: ProgramSearchHash;
  snapshotId: string;
  replayIdentity: string;
  traceId: string;
  requiredBranches: number;
  simulatedBranches: number;
  budgetExhausted: boolean;
  highRiskBranchesDiscarded: number;
  realSideEffects: {
    dbMutations: number;
    providerCalls: number;
    computerMutations: number;
    authorityDecisions: number;
    approvalRequests: number;
    workTransitions: number;
    outboxWrites: number;
    externalWebhooks: number;
    paymentMutations: number;
  };
  ownership: {
    predictsWorlds: "P5";
    selectsPrograms: "P4";
    epistemicOwner: "P3";
    staticAdmissibilityOwner: "P2";
    authoritativeExecution: "EXISTING_GOVERNED_RUNTIME";
  };
  branches: ProgramSimulationBranchEvidence[];
  issueCodes: string[];
}

export interface ProgramSimulationRequest {
  candidateId: string;
  programHash: ProgramSearchHash;
  program: OperationalProgram;
  p2Status: "ADMISSIBLE";
  fixedNow: string;
  epistemicState: EpistemicState;
}

export type RewriteSafetyClass = "SEMANTIC_EQUIVALENCE" | "STRICTER_SAFE";

export interface RewriteApplication {
  ruleId: string;
  ruleVersion: string;
  parentProgramHash: ProgramSearchHash;
  resultProgramHash: ProgramSearchHash;
  safetyClass: RewriteSafetyClass;
  proofRefs: string[];
  costImpact: string;
  effectRelation: "EQUIVALENT" | "STRICTER";
}

export type SearchRejectionStage =
  | "IR_STRUCTURAL_VALIDATION"
  | "P3_KNOWLEDGE_SUFFICIENCY"
  | "P2_STATIC_ADMISSIBILITY"
  | "REWRITE_GUARD"
  | "DEPENDENCY_LEGALITY"
  | "SMT_SOLVER"
  | "CP_SAT_SOLVER"
  | "SEARCH_BUDGET"
  | "RUNTIME_LOWERING"
  | "P5_SPECULATIVE_EVIDENCE";

export type SearchRejectionReasonCode =
  | "IR_STRUCTURAL_INVALID"
  | "P3_MANDATORY_UNKNOWN"
  | "P3_CANDIDATE_MANDATORY_UNKNOWN"
  | "P2_REJECTED"
  | "P2_UNRESOLVED"
  | "UNSAFE_REWRITE"
  | "EFFECT_WEAKENING_REWRITE"
  | "DEPENDENCY_CYCLE"
  | "DEPENDENCY_VIOLATION"
  | "CONFLICTING_PARALLEL_EFFECTS"
  | "SMT_UNSAT"
  | "SMT_UNKNOWN"
  | "CP_SAT_INFEASIBLE"
  | "CP_SAT_UNKNOWN"
  | "PROGRAM_BUDGET_EXCEEDED"
  | "SEARCH_NODE_BUDGET_EXHAUSTED"
  | "SEARCH_TIME_BUDGET_EXHAUSTED"
  | "SEARCH_MEMORY_BUDGET_EXHAUSTED"
  | "SOLVER_TIME_BUDGET_EXHAUSTED"
  | "DUPLICATE_PROGRAM"
  | "UNSUPPORTED_RUNTIME_LOWERING"
  | "P5_SIMULATION_UNAVAILABLE"
  | "P5_SIMULATION_INCOMPLETE"
  | "P5_SIMULATION_UNSUPPORTED"
  | "P5_SIMULATION_SIDE_EFFECT_ESCAPE"
  | "P5_SIMULATION_BRANCH_COVERAGE_INCOMPLETE"
  | "P5_SIMULATION_HARD_CONSTRAINT_VIOLATION"
  | "P5_SIMULATION_OWNERSHIP_VIOLATION"
  | "P5_SIMULATION_EVIDENCE_INVALID";

export interface SearchRejection {
  stage: SearchRejectionStage;
  reasonCode: SearchRejectionReasonCode;
  detailCodes: string[];
  message: string;
}

export interface SolverProofRecord {
  constraintId: string;
  solver: "SMT" | "CP_SAT";
  solverVersion: string;
  status: "SAT" | "UNSAT" | "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
  reasonCodes: string[];
  assignment?: Record<string, number>;
  objectiveValue?: number;
  exploredNodes: number;
  deterministicTimeUnits: number;
}

export interface ExtractionScoreVector {
  /** Survivors are legal; this is never used to soften a hard violation. */
  safetyLegality: number;
  goalSatisfaction: number;
  verificationStrength: number;
  reversibilityRecoverability: number;
  successOrdinal: number;
  humanInterruptions: number;
  latencyMs: number;
  financialCost: number;
  modelTokenCost: number;
  tieBreak: ProgramSearchHash;
}

export interface CandidateRecord {
  candidateId: string;
  origin: CandidateOrigin;
  originRef: string;
  programHash: ProgramSearchHash;
  irSemanticHash: OperationalProgram["irSemanticHash"];
  parentProgramHash: ProgramSearchHash | null;
  rewriteRule: string | null;
  equivalenceClass: string;
  program: OperationalProgram;
  effects?: ProgramEffectSummary;
  dependencies?: PartialOrderPlan;
  constraintResults: SolverProofRecord[];
  costEstimate: ProgramCostEstimate;
  successEstimate: SuccessEstimate;
  extractionScore?: ExtractionScoreVector;
  p2?: Pick<StaticAdmissibilityResult, "status" | "reasonCodes" | "issues">;
  lowering?: Pick<CompatibilityLoweringResult, "status" | "classification" | "reasons">;
  simulationEvidence?: ProgramSimulationEvidence;
  rewriteApplications: RewriteApplication[];
  rejection?: SearchRejection;
}

export interface SearchProofRecord {
  sequence: number;
  kind:
    | "SEARCH_STARTED"
    | "CANDIDATE_ACCEPTED"
    | "CANDIDATE_REJECTED"
    | "DUPLICATE_ELIMINATED"
    | "REWRITE_APPLIED"
    | "SOLVER_RESULT"
    | "SIMULATION_RESULT"
    | "BUDGET_STOP"
    | "EXTRACTION";
  programHash?: ProgramSearchHash;
  reasonCodes: string[];
  detail: Record<string, string | number | boolean | null | string[]>;
}

export interface SearchStats {
  mode: "SIMPLE_FAST_PATH" | "BOUNDED_SEARCH";
  initialCandidatesReceived: number;
  initialCandidatesAccepted: number;
  rewriteIterations: number;
  rewriteApplications: number;
  searchNodesVisited: number;
  duplicatesEliminated: number;
  solverCalls: { smt: number; cpSat: number };
  solverNodes: number;
  deterministicTimeUnits: number;
  wallTimeMs: number;
  estimatedMemoryBytes: number;
  budgetExhausted: boolean;
  budgetReasonCodes: SearchRejectionReasonCode[];
  /** Present only when P5 simulationPolicy is REQUIRED. */
  simulationCalls?: number;
}

export type SearchResultStatus =
  | "SELECTED"
  | "NO_SURVIVING_PROGRAM"
  | "P3_UNRESOLVED"
  | "BOUNDED_INCOMPLETE"
  | "UNSUPPORTED";

export interface SearchResult {
  version: typeof PROGRAM_SEARCH_VERSION;
  status: SearchResultStatus;
  selectedProgram: OperationalProgram | null;
  selectedProgramHash: ProgramSearchHash | null;
  survivingCandidates: CandidateRecord[];
  rejectedCandidates: CandidateRecord[];
  proofRecords: SearchProofRecord[];
  extractionScore: ExtractionScoreVector | null;
  requirementsForP3: string[];
  searchStats: SearchStats;
  deterministicReplayKey: string;
  hardConstraintsUsedAsScores: 0;
  modelFinalPlanJudgments: 0;
}

export interface ProgramSearchClock {
  nowMs(): number;
}

export interface ProgramSearchDependencies {
  checkP2?: (program: OperationalProgram) => Promise<StaticAdmissibilityResult>;
  lower?: (program: OperationalProgram) => CompatibilityLoweringResult;
  simulate?: (request: ProgramSimulationRequest) => Promise<ProgramSimulationEvidence>;
  clock?: ProgramSearchClock;
}
