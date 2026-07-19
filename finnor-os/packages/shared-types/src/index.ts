// Shared type contracts for the Finnor AI Operating System.
// Every subsystem (orchestration, plugins, memory, tools, workers) compiles against these.

export * from "./dealer-zero-fixtures";

export type Role = "owner" | "dispatcher" | "technician";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
  /** Phase 16(e): per-request trace id, generated (or forwarded from an inbound
   *  `x-correlation-id` header) in requireContext. Threaded through enqueueJob's
   *  payload and worker breadcrumbs so one instruction's effects are greppable across
   *  process boundaries — not a DB column, never persisted on its own. */
  correlationId?: string;
}

export type DomainActionStatus =
  | "draft"
  | "pending" // awaiting human confirmation — the gate
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed"
  | "needs_human_review"
  | "blocked_integration_unavailable";

export interface DomainAction {
  id: string;
  tenantId: string;
  actionType: string;
  payload: Record<string, unknown>;
  policyId: string | null;
  status: DomainActionStatus;
  createdAt: string;
  /** Why the LLM planner chose this action_type/payload — optional (only the LLM
   *  planner path sets it; draftKnownAction/system-originated actions have no LLM
   *  reasoning to report). Not a DB column — carried through to the "planned"
   *  action_log episode for the learning/feedback pillar, never queried directly. */
  reasoning?: string;
  /** Phase 6 typed plan compiler (§6) output — absent on rows created before this
   *  phase or by a path that bypasses the compiler. See packages/orchestration/src/compiler.ts. */
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }> | null;
  compiledGraph?: { kind: "workflow" | "single_action"; commandType: string; requiresConfirmation: boolean; autoApprove: boolean } | null;
  /** Phase 16(e): carried from TenantContext.correlationId when a ctx is available
   *  (handleInstruction). Not a DB column — in-memory only, so draftKnownAction/
   *  runAction paths (no ctx) simply leave it undefined; enqueueJob falls back to the
   *  job's own id in that case (see queue.ts). */
  correlationId?: string;
}

export interface DomainPolicy {
  id: string;
  tenantId: string;
  actionType: string;
  /** The actual business rule — decision tree / rule set / prompt template. Config, never code. */
  policy: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationTemplate: string | null;
  /** Optional per-action-type model provider override (config, not code). */
  modelProvider?: string;
  /** §2.8: hours a gated action may sit "pending" before scan_approval_expiry
   *  escalates it to needs_human_review. Unset/null means the application default
   *  (24h) applies. */
  confirmationTimeoutHours?: number | null;
  /** §3.1: what decision_receipts.policy_applied.version cites — bumped whenever this
   *  row's config changes. Defaults to 1 on every new row (migration 0023). */
  version: number;
}

/** Phase 8: how much extra reasoning depth a drafted action gets before it's
 *  inserted — "low" skips repair entirely (nothing to re-check when no human gate
 *  applies), "medium" gets Phase 7's single repair pass, "high" additionally
 *  generates and scores a second candidate before repair. */
export type ReasoningTier = "low" | "medium" | "high";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DraftAction {
  actionType: string;
  /** Plain-language summary shown in the Confirmation Queue. Never a stack trace. */
  summary: string;
  payload: Record<string, unknown>;
  requiresConfirmation: boolean;
  /** §2.4: stamped onto the draft by the executor (GatedExecutor/graph nodes) right
   *  after plugin.draft() returns, from the originating DomainAction/TenantContext —
   *  finishes the Phase-16(e) correlationId thread into any submitCommand() call a
   *  plugin's execute() makes. Plugins never set this themselves. */
  correlationId?: string;
}

export type ExecutionStatus =
  | "success"
  | "failure"
  | "not_implemented"
  | "integration_unavailable";

export interface ExecutionResult {
  status: ExecutionStatus;
  output: Record<string, unknown>;
  /** Plain-language error, safe to show a dealer owner. */
  error?: string;
  /** What the executor expected to happen — Reflection compares this to observed outcome. */
  expected?: Record<string, unknown>;
}

export type ReflectionDecision = "accept" | "retry" | "escalate";

export interface ReflectionOutcome {
  matched: boolean;
  decision: ReflectionDecision;
  detail: string;
}

// Retrieval-based pattern context (Phase 9) — real, queryable historical signals fed
// to the planner as soft context, never a source of new facts to invent into a
// payload. Call this "pattern context" or "retrieval" everywhere, never "learning":
// nothing here is fine-tuned or trained, it's a live aggregate query over existing
// rows, same honesty standard as every other memory source in this file.
export interface HouseholdProposalPattern {
  totalSent: number;
  accepted: number;
  declined: number;
  expired: number;
  avgAcceptedTotalUsd: number | null;
}
export interface TechnicianReliabilityPattern {
  technicianId: string;
  name: string;
  totalAppointments: number;
  noShowCount: number;
  noShowRate: number;
}
// Phase 12 (loop closure) — undigested scan_findings surfaced as soft context, same
// honesty rule as the rest of this interface: informs the planner, never instructs it.
export interface ScanSignal {
  scanType: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  ageHours: number;
}

export interface PatternContext {
  householdProposals: HouseholdProposalPattern | null; // null only when no householdId was supplied
  technicianReliability: TechnicianReliabilityPattern[]; // tenant-wide, [] if no data yet
  scanSignals: ScanSignal[]; // tenant-wide, newest 10, [] if none open
}

export interface MemorySnapshot {
  shortTerm: Record<string, unknown> | null;
  longTerm: Record<string, unknown> | null;
  semantic: Array<{ chunk: string; sourceDocId: string | null; similarity: number }>;
  episodic: Array<Record<string, unknown>>;
  patterns: PatternContext | null;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "dead_letter";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
}

/** Literal marker for values that require real-world input. Never a guess. */
export const PLACEHOLDER_NEEDS_REAL_VALUE = "PLACEHOLDER_NEEDS_REAL_VALUE";

// ---------------------------------------------------------------------------
// Phase 2 (JARVIS 95% MAESTRO PACK §0.3.2, §2.2): the one error taxonomy every retry
// path keys off. Existing call sites (e.g. packages/tools/src/errors.ts's
// IntegrationError) extend this rather than re-declaring their own — a string-matched
// error kind is exactly the failure mode this type exists to rule out.
// ---------------------------------------------------------------------------
export type ErrorKind = "retryable" | "terminal" | "conflict" | "auth" | "validation" | "provider_down";

export interface TypedError {
  kind: ErrorKind;
  cause: string;
  context?: Record<string, unknown>;
}

// Versioned event envelope (§2.2): every inbox/outbox message is one of these. A
// consumer that doesn't recognize `version`'s major rejects the envelope into
// dead_letters instead of guessing at an unknown payload shape (see
// packages/workflow-runtime/src/envelope.ts for the runtime check).
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  type: string;
  version: number;
  tenantId: string;
  occurredAt: string;
  payload: TPayload;
}

/** One piece of evidence a DecisionReceipt cites — a real row/call this decision relied
 *  on, never an invented justification. */
export interface ReceiptEvidence {
  source: string;
  ref: string;
  timestamp: string;
}

export interface ReceiptApproval {
  required: boolean;
  approvedBy?: string;
  at?: string;
}

export interface ReceiptFailure {
  errorKind: ErrorKind;
  message: string;
  recoveryPath: string;
}

/** Phase 2 (§2.2): the record every executed action must be queryable as — "what did I
 *  intend, what evidence did I use, what policy allowed it, who approved it, what
 *  actually happened, how do we recover" in one row. Created at proposal time
 *  (expectedResult/actualResult null, finalizedAt null), finalized in place at
 *  completion — never a second row per retry. */
export interface DecisionReceipt {
  id: string;
  tenantId: string;
  objective: string;
  evidence: ReceiptEvidence[];
  policyApplied: { id: string; version: number } | null;
  riskTier: "low" | "medium" | "high";
  proposedAction: Record<string, unknown>;
  approval: ReceiptApproval;
  expectedResult: Record<string, unknown> | null;
  actualResult: Record<string, unknown> | null;
  failure: ReceiptFailure | null;
  correlationId: string | null;
  workflowRunId: string | null;
  stepId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}
