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

export interface MemorySnapshot {
  shortTerm: Record<string, unknown> | null;
  longTerm: Record<string, unknown> | null;
  semantic: Array<{ chunk: string; sourceDocId: string | null; similarity: number }>;
  episodic: Array<Record<string, unknown>>;
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
