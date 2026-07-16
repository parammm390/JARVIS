// Shared type contracts for the Finnor AI Operating System.
// Every subsystem (orchestration, plugins, memory, tools, workers) compiles against these.

export type Role = "owner" | "dispatcher" | "technician";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
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
export interface PatternContext {
  householdProposals: HouseholdProposalPattern | null; // null only when no householdId was supplied
  technicianReliability: TechnicianReliabilityPattern[]; // tenant-wide, [] if no data yet
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
