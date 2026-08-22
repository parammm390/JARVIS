/** Planner-visible Phase 3 contract. This describes one governed business task;
 * browser primitives are intentionally absent and remain private to the runner. */
export const COMPUTER_TASK_ACTION = "computer_task" as const;

export type ComputerExecutionMode = "READ_ONLY" | "WRITE";

export type ComputerRunStatus =
  | "queued"
  | "authorizing"
  | "provisioning"
  | "authenticating"
  | "running"
  | "reconciling"
  | "succeeded"
  | "blocked"
  | "failed"
  | "timed_out"
  | "cancelled";

export type ComputerEffectStatus = "none" | "pending" | "dispatching" | "succeeded" | "failed" | "unknown";

export type ComputerProviderCapability =
  | "cloud_session"
  | "cdp"
  | "structured_page"
  | "screenshot"
  | "visual_input"
  | "live_view"
  | "persistent_profile"
  | "file_download"
  | "file_upload";

export interface ComputerTaskTarget {
  kind: string;
  identifier: string;
}

/** Exact semantic effect authorized for a WRITE task. A runner decision must
 * reproduce this object exactly before any consequential provider operation. */
export interface ComputerAuthorizedEffect {
  operation: string;
  target: ComputerTaskTarget;
  changes: Record<string, string | number | boolean | null>;
}

export interface ComputerTaskInput {
  application: string;
  authProfileRef: string;
  task: string;
  target: ComputerTaskTarget;
  mode: ComputerExecutionMode;
  successCriteria: string[];
  authorizedEffect?: ComputerAuthorizedEffect;
}

export interface ComputerRunLimits {
  maxSteps: number;
  timeoutMs: number;
  maxProviderCredits: number;
  maxScreenshots: number;
  maxArtifacts: number;
  maxDownloadBytes: number;
  maxUploadBytes: number;
  maxOutputBytes: number;
}

/** Safe API/activity projection. Provider session/profile identifiers and artifact
 * bytes never appear here because either can carry authenticated application state. */
export interface ComputerRunView {
  id: string;
  domainActionId: string;
  workId: string | null;
  objectiveLoopId: string | null;
  actorId: string;
  application: string;
  authProfileRef: string;
  provider: string;
  status: ComputerRunStatus;
  mode: ComputerExecutionMode;
  task: string;
  target: ComputerTaskTarget;
  limits: ComputerRunLimits;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  blockReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ComputerStepView {
  id: string;
  runId: string;
  seq: number;
  phase: ComputerRunStatus;
  operation: string;
  status: "started" | "succeeded" | "blocked" | "failed";
  summary: string;
  pageUrl: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface ComputerArtifactView {
  id: string;
  runId: string;
  stepId: string | null;
  kind: "dom_snapshot" | "screenshot" | "download" | "upload" | "result_evidence";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
