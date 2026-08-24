// P2.T1 — the backward-compatible Work Case projection.
//
// Upgrade 2 makes `works` the canonical lifecycle root. This module keeps the old
// Work Case response fields stable while grouping proven action/workflow/receipt
// records through their durable Work foreign keys. Older rows without those links
// retain the original deterministic projection fallback.

import {
  actionLog,
  businessEvents,
  businessOperations,
  businessOperationTargets,
  calls,
  commands,
  conversations,
  decisionReceipts,
  domainActions,
  instructionEvents,
  instructionSessions,
  pendingConfirmations,
  voiceSessions,
  voiceTurns,
  withTenant,
  workflowRuns,
  workflowSteps,
  works,
  workEvents,
  workInputs,
  workPlannerAttempts,
  workEntityLinks,
  workObjectiveLoops,
  workObjectiveSteps,
  workObjectivePlannerAttempts,
} from "@finnor/db";
import { and, asc, desc, eq, or } from "drizzle-orm";

export const WORK_STATUSES = ["Needs you", "Working", "Waiting", "Completed", "Failed", "Blocked"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
type DurableWorkRow = typeof works.$inferSelect;

export type DomainActionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed"
  | "needs_human_review"
  | "blocked_integration_unavailable";

export type WorkflowRunStatus = "running" | "completed" | "failed" | "compensating" | "compensated" | "paused" | "cancelled" | "escalated";
export type WorkflowStepStatus = "pending" | "leased" | "waiting_observation" | "completed" | "failed" | "compensating" | "compensated";
export type InstructionPhase =
  | "received"
  | "context_retrieved"
  | "planning"
  | "plan_ready"
  | "clarification_required"
  | "action_created"
  | "action_gated"
  | "dispatched"
  | "executing"
  | "step_progress"
  | "verifying"
  | "verified"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkRootKind = "work" | "instruction" | "plan" | "trace" | "workflow_run" | "action";
export type WorkEntityType =
  | "household"
  | "invoice"
  | "visit"
  | "service_visit"
  | "appointment"
  | "work_order"
  | "call"
  | "conversation"
  | "lead"
  | "quote"
  | "opportunity"
  | "proposal"
  | "document"
  | "equipment"
  | "maintenance_agreement"
  | "technician";
  // Canonical links are additive; historical JSON inference above only emits the
  // original subset, while durable Work attachments may name these real rows too.
export type CanonicalWorkEntityType = WorkEntityType
  | "contact" | "user" | "payment" | "message" | "communication" | "task"
  | "work" | "domain_action" | "workflow_run" | "workflow_step"
  | "business_operation" | "business_operation_target" | "decision_receipt" | "business_event";

export interface WorkRoot {
  kind: WorkRootKind;
  id: string;
}

export interface WorkEntityLink {
  entityType: CanonicalWorkEntityType;
  entityId: string;
  via: string;
}

export interface WorkInstruction {
  id: string;
  text: string;
  source: "typed" | "voice";
  createdAt: string;
  lastPhase: InstructionPhase | null;
}

export interface WorkAction {
  id: string;
  actionType: string;
  status: DomainActionStatus;
  summary: string | null;
  instructionId: string | null;
  planId: string | null;
  dependsOn: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkApproval {
  actionId: string;
  status: "pending" | "approved" | "rejected" | "escalated" | "expired" | "not_required" | "unknown";
  decidedBy: string | null;
  decidedAt: string | null;
  pendingConfirmationId: string | null;
}

export interface WorkStep {
  id: string;
  stepType: string;
  sequence: number;
  status: WorkflowStepStatus;
  attempts: number;
  terminalReason: string | null;
  domainActionId: string | null;
  updatedAt: string;
}

export interface WorkWorkflow {
  id: string;
  commandId: string;
  workflowType: string;
  status: WorkflowRunStatus;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  steps: WorkStep[];
}

export interface WorkReceipt {
  id: string;
  workflowRunId: string | null;
  workflowStepId: string | null;
  domainActionId: string | null;
  objective: string;
  evidence: unknown;
  approval: unknown;
  expectedResult: unknown;
  actualResult: unknown;
  failure: unknown;
  correlationId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface WorkOperation {
  id: string;
  operationType: string;
  status: string;
  configuration: unknown;
  cohortDefinition: unknown;
  cohortFrozenAt: string;
  targetCount: number;
  counts: { pending: number; running: number; succeeded: number; failed: number; skipped: number; retry: number };
  finalOutcome: unknown;
  failure: unknown;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkBusinessEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  source: string | null;
}

export interface WorkCall {
  id: string;
  conversationId: string | null;
  direction: "inbound" | "outbound";
  externalId: string | null;
  sourceSystem: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  householdId: string | null;
  agentKey: "jarvis" | "follow-up" | "service-reminder" | "win-back" | "payment-collector" | null;
}

export interface WorkCaseProjection {
  id: string;
  root: WorkRoot;
  title: string;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  source: { kind: "instruction" | "action" | "workflow" | "voice" | "system"; id: string | null; channel: string | null };
  instruction: WorkInstruction | null;
  actions: WorkAction[];
  approvals: WorkApproval[];
  workflows: WorkWorkflow[];
  receipts: WorkReceipt[];
  operations?: WorkOperation[];
  linkedEntities: WorkEntityLink[];
  businessEvents: WorkBusinessEvent[];
  calls: WorkCall[];
  /** Exact action ids observed on a workflow when it cannot be safely merged into one action/instruction root. */
  relatedActionIds: string[];
  /** Source paths used to make the projection inspectable; not a user-facing raw-data dump. */
  provenance: string[];
  /** Upgrade 2 canonical state. Older clients can keep consuming the unchanged
   * title/status/actions/workflows/receipts fields above. */
  durableWork?: {
    id: string;
    status: DurableWorkRow["status"];
    executionModel: DurableWorkRow["executionModel"];
    sessionId: string | null;
    channel: DurableWorkRow["initialChannel"];
    activeContext: unknown;
    initiatedBy: string | null;
    currentOwnerId: string | null;
    assignedTo: string | null;
    authorityContext: unknown;
    finalOutcome: unknown;
    failure: unknown;
    recovery: unknown;
    handoffs: Array<{
      sequence: number;
      fromEmployeeId: string | null;
      toEmployeeId: string | null;
      actorId: string | null;
      note: string | null;
      authorityRevision: number | null;
      createdAt: string;
    }>;
  };
  inputs?: Array<{ id: string; instructionId: string; channel: string; text: string; createdAt: string }>;
  plannerAttempts?: Array<{ id: string; attempt: number; status: string; result: unknown; failure: unknown; startedAt: string; completedAt: string | null }>;
  objectiveLoop?: {
    id: string;
    objective: string;
    state: "continue" | "awaiting_approval" | "waiting" | "blocked" | "completed" | "failed" | "cancelled";
    revision: number;
    reason: string | null;
    nextStep: string | null;
    nextRunAt: string | null;
    lastObservation: unknown;
    successCondition: unknown;
    successVerification: unknown;
    successVerifiedAt: string | null;
    cancelledAt: string | null;
    budget: { steps: number; maxSteps: number; actions: number; maxActions: number; queries: number; maxQueries: number };
    iterations: Array<{
      id: string;
      stepNumber: number;
      phase: string;
      decisionKind: string | null;
      reason: string | null;
      observation: unknown;
      progressMade: boolean | null;
      outcome: string | null;
      recoveryKind: string | null;
      successVerification: unknown;
      scheduledFor: string | null;
      completedAt: string | null;
      plannerAttempts: Array<{ id: string; attempt: number; status: string; provider: string | null; failure: unknown }>;
    }>;
  };
}

const ENTITY_KEYS: Record<string, WorkEntityType> = {
  householdId: "household",
  invoiceId: "invoice",
  invoiceIds: "invoice",
  // service_visits is the canonical table and Company Graph entity. `visitId` is
  // the long-standing action payload field, not a second entity kind.
  visitId: "service_visit",
  serviceVisitId: "service_visit",
  appointmentId: "appointment",
  workOrderId: "work_order",
  callId: "call",
  conversationId: "conversation",
  leadId: "lead",
  quoteId: "quote",
  opportunityId: "opportunity",
  proposalId: "proposal",
  documentId: "document",
  equipmentId: "equipment",
  maintenanceAgreementId: "maintenance_agreement",
  technicianId: "technician",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const WORK_AGENT_KEYS = ["jarvis", "follow-up", "service-reminder", "win-back", "payment-collector"] as const;
type WorkAgentKey = (typeof WORK_AGENT_KEYS)[number];

function callAgentKey(raw: unknown): WorkAgentKey | null {
  const value = stringValue(record(raw)?.agentKey);
  return value && WORK_AGENT_KEYS.includes(value as WorkAgentKey) ? (value as WorkAgentKey) : null;
}

function callDomainActionId(raw: unknown): string | null {
  return stringValue(record(raw)?.domainActionId);
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function maxDate(values: Array<Date | null | undefined>, fallback: Date): string {
  const timestamps = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return new Date(Math.max(fallback.getTime(), ...(timestamps.length > 0 ? timestamps : [fallback.getTime()]))).toISOString();
}

function minDate(values: Array<Date | null | undefined>, fallback: Date): string {
  const timestamps = values.filter((value): value is Date => value instanceof Date).map((value) => value.getTime());
  return new Date(Math.min(fallback.getTime(), ...(timestamps.length > 0 ? timestamps : [fallback.getTime()]))).toISOString();
}

/** Exhaustive mapping for the current domain_actions status union. */
export function projectDomainActionStatus(status: DomainActionStatus): WorkStatus {
  switch (status) {
    case "failed":
      return "Failed";
    case "blocked_integration_unavailable":
      return "Blocked";
    case "pending":
    case "needs_human_review":
      return "Needs you";
    case "executing":
      return "Working";
    case "approved":
    case "draft":
      return "Waiting";
    case "completed":
    case "rejected":
      return "Completed";
  }
}

/** Exhaustive mapping for the current workflow_runs status union. */
export function projectWorkflowRunStatus(status: WorkflowRunStatus): WorkStatus {
  switch (status) {
    case "failed":
      return "Failed";
    case "paused":
    case "escalated":
      return "Needs you";
    case "running":
    case "compensating":
      return "Working";
    case "completed":
    case "compensated":
    case "cancelled":
      return "Completed";
  }
}

/** Exhaustive mapping for the current workflow_steps status union. */
export function projectWorkflowStepStatus(status: WorkflowStepStatus): WorkStatus {
  switch (status) {
    case "failed":
      return "Failed";
    case "leased":
    case "compensating":
      return "Working";
    case "pending":
    case "waiting_observation":
      return "Waiting";
    case "completed":
    case "compensated":
      return "Completed";
  }
}

function projectInstructionPhase(phase: InstructionPhase | null): WorkStatus | null {
  switch (phase) {
    case "clarification_required":
    case "action_gated":
      return "Needs you";
    case "failed":
      return "Failed";
    case "received":
    case "context_retrieved":
    case "planning":
    case "plan_ready":
    case "action_created":
    case "dispatched":
    case "executing":
    case "step_progress":
    case "verifying":
      return "Working";
    case "verified":
    case "completed":
    case "cancelled":
      return "Completed";
    case null:
      return null;
  }
}

const STATUS_PRIORITY: Record<WorkStatus, number> = {
  Failed: 6,
  Blocked: 5,
  "Needs you": 4,
  Working: 3,
  Waiting: 2,
  Completed: 1,
};

export function deriveWorkStatus(statuses: WorkStatus[], instructionPhase: InstructionPhase | null = null): WorkStatus {
  // A terminal durable graph is stronger evidence than a stale pre-execution trace
  // phase. Older approvals stopped their instruction trace at action_gated even
  // after every action/run/step completed and a receipt finalized, which left Work
  // permanently claiming "Needs you". Do not let that observational lag override
  // unanimous terminal execution state.
  if (statuses.length > 0 && statuses.every((status) => status === "Completed")) return "Completed";
  const candidates = [...statuses, ...(instructionPhase ? [projectInstructionPhase(instructionPhase)] : [])].filter(
    (status): status is WorkStatus => status !== null,
  );
  return candidates.sort((left, right) => STATUS_PRIORITY[right] - STATUS_PRIORITY[left])[0] ?? "Waiting";
}

function addLink(target: Map<string, WorkEntityLink>, entityType: CanonicalWorkEntityType, entityId: string, via: string): void {
  if (!entityId) return;
  const key = `${entityType}:${entityId}`;
  if (!target.has(key)) target.set(key, { entityType, entityId, via });
}

function collectEntityLinks(value: unknown, source: string, target: Map<string, WorkEntityLink>, depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEntityLinks(item, `${source}[${index}]`, target, depth + 1));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    const entityType = ENTITY_KEYS[key];
    if (entityType) {
      const values = Array.isArray(child) ? child : [child];
      values.forEach((item) => {
        const id = stringValue(item);
        if (id) addLink(target, entityType, id, `${source}.${key}`);
      });
    }
    collectEntityLinks(child, `${source}.${key}`, target, depth + 1);
  }
}

function latestDecisionLog(logs: Array<{ step: string; input: unknown; output: unknown; timestamp: Date }>, actionId: string): WorkApproval {
  const candidates = logs.filter((log) => ["confirmed", "rejected", "escalated", "policy_ungated_authorized"].includes(log.step)).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const latest = candidates[0];
  if (!latest) return { actionId, status: "unknown", decidedBy: null, decidedAt: null, pendingConfirmationId: null };
  const input = record(latest.input);
  const output = record(latest.output);
  const decidedBy = stringValue(output?.by) ?? stringValue(input?.by) ?? null;
  const status = latest.step === "confirmed" ? "approved" : latest.step === "rejected" ? "rejected" : latest.step === "escalated" ? "escalated" : "not_required";
  return { actionId, status, decidedBy, decidedAt: latest.timestamp.toISOString(), pendingConfirmationId: null };
}

function actionApproval(
  action: { id: string; status: DomainActionStatus },
  confirmations: Array<{ id: string; status: "awaiting" | "confirmed" | "rejected" | "expired"; createdAt: Date; resolvedAt: Date | null }>,
  logs: Array<{ step: string; input: unknown; output: unknown; timestamp: Date }>,
): WorkApproval {
  const confirmation = [...confirmations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (confirmation) {
    const status = confirmation.status === "awaiting" ? "pending" : confirmation.status === "confirmed" ? "approved" : confirmation.status;
    return {
      actionId: action.id,
      status,
      decidedBy: null,
      decidedAt: iso(confirmation.resolvedAt),
      pendingConfirmationId: confirmation.id,
    };
  }
  if (action.status === "pending") return { actionId: action.id, status: "pending", decidedBy: null, decidedAt: null, pendingConfirmationId: null };
  if (action.status === "needs_human_review") return { actionId: action.id, status: "escalated", decidedBy: null, decidedAt: null, pendingConfirmationId: null };
  const logged = latestDecisionLog(logs, action.id);
  if (logged.status !== "unknown") return logged;
  if (action.status === "rejected") return { actionId: action.id, status: "rejected", decidedBy: null, decidedAt: null, pendingConfirmationId: null };
  return logged;
}

function sourceForCase(instruction: WorkInstruction | null, actions: WorkAction[], calls: WorkCall[], root: WorkRoot): WorkCaseProjection["source"] {
  if (instruction) return { kind: "instruction", id: instruction.id, channel: instruction.source };
  if (calls.length > 0) return { kind: "voice", id: calls[0]!.id, channel: "voice" };
  if (root.kind === "workflow_run") return { kind: "workflow", id: root.id, channel: null };
  if (actions.length > 0) return { kind: "action", id: actions[0]!.id, channel: null };
  return { kind: "system", id: root.id, channel: null };
}

function caseTitle(instruction: WorkInstruction | null, actions: WorkAction[], workflows: WorkWorkflow[], root: WorkRoot): string {
  if (instruction?.text) return instruction.text;
  const summary = actions.find((action) => action.summary)?.summary;
  if (summary) return summary;
  const actionType = actions[0]?.actionType;
  if (actionType) return humanize(actionType);
  const workflowType = workflows[0]?.workflowType;
  if (workflowType) return humanize(workflowType);
  return `${humanize(root.kind)} ${root.id.slice(0, 8)}`;
}

function caseSort(left: WorkCaseProjection, right: WorkCaseProjection): number {
  const statusDelta = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];
  if (statusDelta !== 0) return statusDelta;
  return right.updatedAt.localeCompare(left.updatedAt);
}

type WorkingCase = {
  root: WorkRoot;
  instructionId: string | null;
  actionIds: Set<string>;
  runIds: Set<string>;
  relatedActionIds: Set<string>;
  links: Map<string, WorkEntityLink>;
  provenance: Set<string>;
};

function ensureCase(cases: Map<string, WorkingCase>, root: WorkRoot): WorkingCase {
  const key = `${root.kind}:${root.id}`;
  const current = cases.get(key);
  if (current) return current;
  const created: WorkingCase = {
    root,
    instructionId: root.kind === "instruction" ? root.id : null,
    actionIds: new Set(),
    runIds: new Set(),
    relatedActionIds: new Set(),
    links: new Map(),
    provenance: new Set(),
  };
  cases.set(key, created);
  return created;
}

function addLinks(target: WorkingCase, links: Map<string, WorkEntityLink>, provenance: Set<string>): void {
  links.forEach((link, key) => target.links.set(key, link));
  provenance.forEach((path) => target.provenance.add(path));
}

function mergeLinkMaps(target: Map<string, WorkEntityLink>, provenance: Set<string>, links: Map<string, WorkEntityLink>): void {
  links.forEach((link, key) => target.set(key, link));
  links.forEach((link) => provenance.add(link.via));
}

function findActionRoot(
  action: { id: string; workId: string | null; instructionId: string | null; planId: string | null },
  instructionIds: Set<string>,
  instructionActionRoots: Map<string, string>,
): WorkRoot {
  if (action.workId) return { kind: "work", id: action.workId };
  if (action.instructionId && instructionIds.has(action.instructionId)) return { kind: "instruction", id: action.instructionId };
  const eventInstructionId = instructionActionRoots.get(action.id);
  if (eventInstructionId) return { kind: "instruction", id: eventInstructionId };
  if (action.planId) return { kind: "plan", id: action.planId };
  return { kind: "action", id: action.id };
}

function toWorkAction(row: typeof domainActions.$inferSelect): WorkAction {
  return {
    id: row.id,
    actionType: row.actionType,
    status: row.status,
    summary: row.summary,
    instructionId: row.instructionId,
    planId: row.planId,
    dependsOn: row.dependsOn,
    payload: record(row.payload) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.executionStartedAt ?? row.createdAt).toISOString(),
  };
}

function toWorkStep(row: typeof workflowSteps.$inferSelect): WorkStep {
  return {
    id: row.id,
    stepType: row.stepType,
    sequence: row.sequence,
    status: row.status,
    attempts: row.attempts,
    terminalReason: row.terminalReason,
    domainActionId: row.domainActionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWorkReceipt(row: typeof decisionReceipts.$inferSelect): WorkReceipt {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    workflowStepId: row.workflowStepId,
    domainActionId: row.domainActionId,
    objective: row.objective,
    evidence: row.evidence,
    approval: row.approval,
    expectedResult: row.expectedResult,
    actualResult: row.actualResult,
    failure: row.failure,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
    finalizedAt: iso(row.finalizedAt),
  };
}

/**
 * Returns all tenant Work Cases from existing durable rows. The caller may use
 * `root.kind/root.id` as the stable derived ID; no customer, invoice, time, or
 * text similarity is used as a grouping key.
 */
export async function workCases(tenantId: string): Promise<WorkCaseProjection[]> {
  return withTenant(tenantId, async (db) => {
    // A tenant transaction is a single pg client. These queries were always
    // serialized by the driver; spelling that out avoids pg@9's overlapping-
    // query deprecation and keeps the projection deterministic.
    const workRows = await db.select().from(works).where(eq(works.tenantId, tenantId)).orderBy(desc(works.updatedAt));
    const workEventRows = await db.select().from(workEvents).where(eq(workEvents.tenantId, tenantId)).orderBy(asc(workEvents.seq));
    const workInputRows = await db.select().from(workInputs).where(eq(workInputs.tenantId, tenantId)).orderBy(asc(workInputs.createdAt));
    const plannerAttemptRows = await db.select().from(workPlannerAttempts).where(eq(workPlannerAttempts.tenantId, tenantId)).orderBy(asc(workPlannerAttempts.attempt));
    const canonicalWorkLinks = await db.select().from(workEntityLinks).where(eq(workEntityLinks.tenantId, tenantId)).orderBy(asc(workEntityLinks.createdAt));
    const objectiveLoopRows = await db.select().from(workObjectiveLoops).where(eq(workObjectiveLoops.tenantId, tenantId)).orderBy(desc(workObjectiveLoops.updatedAt));
    const objectiveStepRows = await db.select().from(workObjectiveSteps).where(eq(workObjectiveSteps.tenantId, tenantId)).orderBy(asc(workObjectiveSteps.stepNumber));
    const objectiveAttemptRows = await db.select().from(workObjectivePlannerAttempts).where(eq(workObjectivePlannerAttempts.tenantId, tenantId)).orderBy(asc(workObjectivePlannerAttempts.startedAt));
    const instructionRows = await db.select().from(instructionSessions).where(eq(instructionSessions.tenantId, tenantId)).orderBy(desc(instructionSessions.updatedAt));
    const instructionEventRows = await db.select().from(instructionEvents).where(eq(instructionEvents.tenantId, tenantId)).orderBy(asc(instructionEvents.seq));
    const actionRows = await db.select().from(domainActions).where(eq(domainActions.tenantId, tenantId)).orderBy(desc(domainActions.createdAt));
    const confirmationRows = await db.select().from(pendingConfirmations).where(eq(pendingConfirmations.tenantId, tenantId)).orderBy(desc(pendingConfirmations.createdAt));
    const commandRows = await db.select().from(commands).where(eq(commands.tenantId, tenantId)).orderBy(desc(commands.updatedAt));
    const runRows = await db.select().from(workflowRuns).where(eq(workflowRuns.tenantId, tenantId)).orderBy(desc(workflowRuns.updatedAt));
    const stepRows = await db.select().from(workflowSteps).where(eq(workflowSteps.tenantId, tenantId)).orderBy(asc(workflowSteps.sequence));
    const receiptRows = await db.select().from(decisionReceipts).where(eq(decisionReceipts.tenantId, tenantId)).orderBy(desc(decisionReceipts.createdAt));
    const operationRows = await db.select().from(businessOperations).where(eq(businessOperations.tenantId, tenantId)).orderBy(desc(businessOperations.updatedAt));
    const operationTargetRows = await db.select().from(businessOperationTargets).where(eq(businessOperationTargets.tenantId, tenantId)).orderBy(asc(businessOperationTargets.ordinal));
    const logRows = await db.select().from(actionLog).where(eq(actionLog.tenantId, tenantId)).orderBy(desc(actionLog.timestamp));
    const voiceSessionRows = await db.select().from(voiceSessions).where(eq(voiceSessions.tenantId, tenantId));
    const voiceTurnRows = await db.select().from(voiceTurns).where(eq(voiceTurns.tenantId, tenantId)).orderBy(asc(voiceTurns.sequence));
    const conversationRows = await db
      .select({ id: conversations.id, householdId: conversations.householdId })
      .from(conversations)
      .where(eq(conversations.tenantId, tenantId));

    const instructionActionRoots = new Map<string, string>();
    const lastPhaseByInstruction = new Map<string, InstructionPhase>();
    for (const event of instructionEventRows) {
      lastPhaseByInstruction.set(event.instructionId, event.phase);
      const actionId = stringValue(record(event.payload)?.actionId);
      if (actionId) instructionActionRoots.set(actionId, event.instructionId);
    }

    const actionLinks = new Map<string, Map<string, WorkEntityLink>>();
    const actionProvenance = new Map<string, Set<string>>();
    const linksForAction = (actionId: string): { links: Map<string, WorkEntityLink>; provenance: Set<string> } => {
      const links = actionLinks.get(actionId) ?? new Map<string, WorkEntityLink>();
      const provenance = actionProvenance.get(actionId) ?? new Set<string>();
      actionLinks.set(actionId, links);
      actionProvenance.set(actionId, provenance);
      return { links, provenance };
    };
    for (const action of actionRows) {
      const target = linksForAction(action.id);
      collectEntityLinks(action.payload, `domain_actions(${action.id}).payload`, target.links);
      target.links.forEach((link) => target.provenance.add(link.via));
    }
    for (const target of operationTargetRows) {
      const operation = operationRows.find((row) => row.id === target.operationId);
      if (!operation) continue;
      const actionTarget = linksForAction(operation.domainActionId);
      addLink(actionTarget.links, "household", target.targetId, `business_operation_targets(${target.id}).target_id`);
      actionTarget.provenance.add(`business_operation_targets(${target.id}).target_id`);
    }
    for (const log of logRows) {
      const target = linksForAction(log.domainActionId);
      collectEntityLinks(log.input, `action_log(${log.id}).input`, target.links);
      collectEntityLinks(log.output, `action_log(${log.id}).output`, target.links);
      target.links.forEach((link) => target.provenance.add(link.via));
    }

    const stepsByRun = new Map<string, typeof stepRows>();
    const stepLinks = new Map<string, Map<string, WorkEntityLink>>();
    for (const step of stepRows) {
      const list = stepsByRun.get(step.workflowRunId) ?? [];
      list.push(step);
      stepsByRun.set(step.workflowRunId, list);
      const links = new Map<string, WorkEntityLink>();
      const provenance = new Set<string>();
      collectEntityLinks(step.payload, `workflow_steps(${step.id}).payload`, links);
      collectEntityLinks(step.evidence, `workflow_steps(${step.id}).evidence`, links);
      links.forEach((link) => provenance.add(link.via));
      stepLinks.set(step.id, links);
      if (step.domainActionId) {
        const actionTarget = linksForAction(step.domainActionId);
        mergeLinkMaps(actionTarget.links, actionTarget.provenance, links);
      }
    }

    const runLinks = new Map<string, Map<string, WorkEntityLink>>();
    for (const receipt of receiptRows) {
      const links = new Map<string, WorkEntityLink>();
      collectEntityLinks(receipt.proposedAction, `decision_receipts(${receipt.id}).proposed_action`, links);
      collectEntityLinks(receipt.expectedResult, `decision_receipts(${receipt.id}).expected_result`, links);
      collectEntityLinks(receipt.actualResult, `decision_receipts(${receipt.id}).actual_result`, links);
      collectEntityLinks(receipt.failure, `decision_receipts(${receipt.id}).failure`, links);
      if (receipt.domainActionId) {
        const target = linksForAction(receipt.domainActionId);
        mergeLinkMaps(target.links, target.provenance, links);
      } else if (receipt.workflowStepId) {
        const step = stepRows.find((row) => row.id === receipt.workflowStepId);
        const stepTarget = step ? stepLinks.get(step.id) : undefined;
        if (stepTarget) mergeLinkMaps(stepTarget, new Set(), links);
      } else if (receipt.workflowRunId) {
        const target = runLinks.get(receipt.workflowRunId) ?? new Map<string, WorkEntityLink>();
        mergeLinkMaps(target, new Set(), links);
        runLinks.set(receipt.workflowRunId, target);
      }
    }

    const commandById = new Map(commandRows.map((command) => [command.id, command]));
    const runById = new Map(runRows.map((run) => [run.id, run]));
    const actionById = new Map(actionRows.map((action) => [action.id, action]));
    const instructionById = new Map(instructionRows.map((instruction) => [instruction.id, instruction]));

    const cases = new Map<string, WorkingCase>();
    for (const work of workRows) ensureCase(cases, { kind: "work", id: work.id });
    for (const link of canonicalWorkLinks) {
      const target = ensureCase(cases, { kind: "work", id: link.workId });
      target.links.set(`${link.entityType}:${link.entityId}`, { entityType: link.entityType as CanonicalWorkEntityType, entityId: link.entityId, via: `work_entity_links(${link.id}).entity_id` });
      target.provenance.add(`work_entity_links(${link.id}).entity_id`);
    }
    for (const instruction of instructionRows) {
      const target = ensureCase(cases, instruction.workId ? { kind: "work", id: instruction.workId } : { kind: "instruction", id: instruction.id });
      target.instructionId ??= instruction.id;
    }
    const rootByAction = new Map<string, WorkRoot>();
    for (const action of actionRows) {
      const root = findActionRoot(action, new Set(instructionRows.map((instruction) => instruction.id)), instructionActionRoots);
      rootByAction.set(action.id, root);
      const target = ensureCase(cases, root);
      target.actionIds.add(action.id);
      addLinks(target, actionLinks.get(action.id) ?? new Map(), actionProvenance.get(action.id) ?? new Set());
    }

    const traceRoots = new Map<string, WorkRoot>();
    for (const run of runRows) {
      const command = commandById.get(run.commandId);
      const steps = stepsByRun.get(run.id) ?? [];
      const actionIds = [...new Set(steps.map((step) => step.domainActionId).filter((id): id is string => Boolean(id)))];
      const actionRoots = [...new Set(actionIds.map((id) => rootByAction.get(id)).filter((root): root is WorkRoot => Boolean(root)).map((root) => `${root.kind}:${root.id}`))];
      let root: WorkRoot;
      if (run.workId) {
        root = { kind: "work", id: run.workId };
      } else if (actionRoots.length === 1) {
        root = rootByAction.get(actionIds[0]!) ?? { kind: "workflow_run", id: run.id };
      } else if (actionRoots.length > 1) {
        root = { kind: "workflow_run", id: run.id };
      } else {
        if (command?.correlationId) {
          root = traceRoots.get(command.correlationId) ?? { kind: "trace", id: command.correlationId };
          traceRoots.set(command.correlationId, root);
        } else {
          root = { kind: "workflow_run", id: run.id };
        }
      }
      const target = ensureCase(cases, root);
      target.runIds.add(run.id);
      actionIds.forEach((actionId) => {
        if (`${rootByAction.get(actionId)?.kind}:${rootByAction.get(actionId)?.id}` === `${root.kind}:${root.id}`) target.actionIds.add(actionId);
        else target.relatedActionIds.add(actionId);
      });
      for (const step of steps) addLinks(target, stepLinks.get(step.id) ?? new Map(), new Set([...stepLinks.get(step.id)?.values() ?? []].map((link) => link.via)));
      if (command) {
        const commandLinks = new Map<string, WorkEntityLink>();
        collectEntityLinks(command.payload, `commands(${command.id}).payload`, commandLinks);
        addLinks(target, commandLinks, new Set([...commandLinks.values()].map((link) => link.via)));
      }
      addLinks(target, runLinks.get(run.id) ?? new Map(), new Set([...runLinks.get(run.id)?.values() ?? []].map((link) => link.via)));
    }

    const caseByAction = (actionId: string): WorkingCase | null => {
      const root = rootByAction.get(actionId);
      return root ? cases.get(`${root.kind}:${root.id}`) ?? null : null;
    };
    const caseByRun = (runId: string): WorkingCase | null => {
      for (const target of cases.values()) if (target.runIds.has(runId)) return target;
      return null;
    };
    const caseByStep = (stepId: string): WorkingCase | null => {
      const step = stepRows.find((row) => row.id === stepId);
      return step ? caseByRun(step.workflowRunId) : null;
    };

    const receiptByCase = new Map<WorkingCase, typeof receiptRows>();
    for (const receipt of receiptRows) {
      const target = receipt.domainActionId ? caseByAction(receipt.domainActionId) : receipt.workflowRunId ? caseByRun(receipt.workflowRunId) : receipt.workflowStepId ? caseByStep(receipt.workflowStepId) : null;
      if (!target) continue;
      const list = receiptByCase.get(target) ?? [];
      list.push(receipt);
      receiptByCase.set(target, list);
    }

    const voiceSessionById = new Map(voiceSessionRows.map((session) => [session.id, session]));
    const actionCallRefs = new Map<string, Set<string>>();
    for (const turn of voiceTurnRows) {
      const actionIds = Array.isArray(turn.resolvedActionIds) ? turn.resolvedActionIds.filter((id): id is string => typeof id === "string") : [];
      for (const actionId of actionIds) {
        const refs = actionCallRefs.get(actionId) ?? new Set<string>();
        const session = voiceSessionById.get(turn.voiceSessionId);
        if (session) refs.add(session.callExternalId);
        actionCallRefs.set(actionId, refs);
      }
    }
    for (const confirmation of confirmationRows) {
      const session = voiceSessionById.get(confirmation.voiceSessionId);
      if (!session) continue;
      const refs = actionCallRefs.get(confirmation.domainActionId) ?? new Set<string>();
      refs.add(session.callExternalId);
      actionCallRefs.set(confirmation.domainActionId, refs);
    }

    const callRows = await db.select().from(calls).where(eq(calls.tenantId, tenantId)).orderBy(desc(calls.createdAt));
    const callByReference = new Map<string, typeof callRows[number]>();
    const conversationById = new Map(conversationRows.map((conversation) => [conversation.id, conversation]));
    for (const call of callRows) {
      callByReference.set(call.id, call);
      if (call.externalId) callByReference.set(call.externalId, call);
    }

    const addCallEdge = (target: WorkingCase, call: typeof callRows[number], via: string): void => {
      const callLinks = new Map<string, WorkEntityLink>();
      addLink(callLinks, "call", call.id, via);
      const conversation = call.conversationId ? conversationById.get(call.conversationId) : undefined;
      if (conversation?.householdId) {
        addLink(callLinks, "household", conversation.householdId, `calls(${call.id}).conversation_id -> conversations(${conversation.id}).household_id`);
      }
      mergeLinkMaps(target.links, target.provenance, callLinks);
    };

    // Outbound call writers carry the executor-stamped action id in a whitelisted
    // metadata envelope. This is the only call→Work join for those calls; no
    // customer, invoice, time, or text similarity is considered.
    for (const call of callRows) {
      const actionId = callDomainActionId(call.raw);
      const target = actionId && actionById.has(actionId) ? caseByAction(actionId) : null;
      if (target) addCallEdge(target, call, `calls(${call.id}).raw.domainActionId`);
    }

    for (const [actionId, refs] of actionCallRefs) {
      const target = caseByAction(actionId);
      if (!target) continue;
      for (const ref of refs) {
        const call = callByReference.get(ref);
        if (call) addCallEdge(target, call, `voice_turns(${actionId}).resolved_action_ids`);
      }
    }

    const allLinks = [...cases.values()].flatMap((target) => [...target.links.values()]);
    const eventPredicates = [...new Map(allLinks.map((link) => [`${link.entityType}:${link.entityId}`, link])).values()].map((link) => and(eq(businessEvents.entityType, link.entityType), eq(businessEvents.entityId, link.entityId)));
    const eventRows = eventPredicates.length > 0
      ? await db.select().from(businessEvents).where(and(eq(businessEvents.tenantId, tenantId), or(...eventPredicates))).orderBy(desc(businessEvents.occurredAt))
      : [];
    const eventsByEntity = new Map<string, typeof eventRows>();
    for (const event of eventRows) {
      const key = `${event.entityType}:${event.entityId}`;
      const list = eventsByEntity.get(key) ?? [];
      list.push(event);
      eventsByEntity.set(key, list);
    }

    // Canonical attachments win provenance when a historical JSON/operation edge
    // names the same row. The entity is de-duplicated, but the durable validated
    // Work link is the relationship contract runtime consumers should see.
    for (const link of canonicalWorkLinks) {
      const target = cases.get(`work:${link.workId}`);
      if (!target) continue;
      target.links.set(`${link.entityType}:${link.entityId}`, { entityType: link.entityType as CanonicalWorkEntityType, entityId: link.entityId, via: `work_entity_links(${link.id}).entity_id` });
      target.provenance.add(`work_entity_links(${link.id}).entity_id`);
    }

    const output: WorkCaseProjection[] = [];
    const workById = new Map(workRows.map((work) => [work.id, work]));
    for (const target of cases.values()) {
      const durableWork = target.root.kind === "work" ? workById.get(target.root.id) : undefined;
      const objectiveLoop = durableWork ? objectiveLoopRows.find((loop) => loop.workId === durableWork.id) : undefined;
      const instructionRow = target.instructionId ? instructionById.get(target.instructionId) : undefined;
      const actions = [...target.actionIds].map((id) => actionById.get(id)).filter((action): action is typeof actionRows[number] => Boolean(action)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toWorkAction);
      const workflows = [...target.runIds].map((id) => {
        const run = runById.get(id);
        if (!run) return null;
        const command = commandById.get(run.commandId);
        return {
          id: run.id,
          commandId: run.commandId,
          workflowType: run.workflowType,
          status: run.status,
          correlationId: command?.correlationId ?? null,
          createdAt: run.createdAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          steps: (stepsByRun.get(run.id) ?? []).sort((a, b) => a.sequence - b.sequence).map(toWorkStep),
        } satisfies WorkWorkflow;
      }).filter((workflow): workflow is WorkWorkflow => Boolean(workflow));
      const instruction: WorkInstruction | null = instructionRow
        ? { id: instructionRow.id, text: instructionRow.instructionText, source: instructionRow.source, createdAt: instructionRow.createdAt.toISOString(), lastPhase: lastPhaseByInstruction.get(instructionRow.id) ?? null }
        : null;
      const approvals = actions.map((action) => actionApproval(
        { id: action.id, status: action.status },
        confirmationRows.filter((confirmation) => confirmation.domainActionId === action.id).map((confirmation) => ({ id: confirmation.id, status: confirmation.status, createdAt: confirmation.createdAt, resolvedAt: confirmation.resolvedAt })),
        logRows.filter((log) => log.domainActionId === action.id).map((log) => ({ step: log.step, input: log.input, output: log.output, timestamp: log.timestamp })),
      ));
      const receipts = [...(receiptByCase.get(target) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toWorkReceipt);
      const operations = operationRows
        .filter((operation) => operation.workId === durableWork?.id || target.actionIds.has(operation.domainActionId))
        .map((operation) => ({
          id: operation.id,
          operationType: operation.operationType,
          status: operation.status,
          configuration: operation.configuration,
          cohortDefinition: operation.cohortDefinition,
          cohortFrozenAt: operation.cohortFrozenAt.toISOString(),
          targetCount: operation.targetCount,
          counts: {
            pending: operation.pendingCount,
            running: operation.runningCount,
            succeeded: operation.succeededCount,
            failed: operation.failedCount,
            skipped: operation.skippedCount,
            retry: operation.retryCount,
          },
          finalOutcome: operation.finalOutcome,
          failure: operation.failure,
          approvedBy: operation.approvedBy,
          approvedAt: iso(operation.approvedAt),
          createdAt: operation.createdAt.toISOString(),
          updatedAt: operation.updatedAt.toISOString(),
        }));
      const linkedEntities = [...target.links.values()].sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));
      const businessEventList = linkedEntities.flatMap((link) => eventsByEntity.get(`${link.entityType}:${link.entityId}`) ?? []).map((event) => ({ id: event.id, entityType: event.entityType, entityId: event.entityId, eventType: event.eventType, occurredAt: event.occurredAt.toISOString(), source: event.source }));
      const callsForCase = callRows
        .filter((call) => linkedEntities.some((link) => link.entityType === "call" && link.entityId === call.id))
        .map((call) => ({
          id: call.id,
          conversationId: call.conversationId,
          direction: call.direction,
          externalId: call.externalId,
          sourceSystem: call.sourceSystem,
          startedAt: iso(call.startedAt),
          endedAt: iso(call.endedAt),
          endedReason: call.endedReason,
          householdId: call.conversationId ? conversationById.get(call.conversationId)?.householdId ?? null : null,
          agentKey: callAgentKey(call.raw),
        }));
      const statusCandidates = [
        ...actions.map((action) => projectDomainActionStatus(action.status)),
        ...workflows.flatMap((workflow) => [projectWorkflowRunStatus(workflow.status), ...workflow.steps.map((step) => projectWorkflowStepStatus(step.status))]),
      ];
      const lastPhase = instruction?.lastPhase ?? null;
      const status = durableWork
        ? durableWork.status === "completed"
          ? "Completed"
          : durableWork.status === "cancelled"
            ? "Completed"
          : durableWork.status === "failed"
            ? "Failed"
            : durableWork.status === "blocked"
              ? "Blocked"
              : durableWork.status === "waiting"
                ? "Waiting"
            : durableWork.status === "awaiting_approval" || durableWork.status === "recovery"
              ? "Needs you"
              : "Working"
        : deriveWorkStatus(statusCandidates, lastPhase);
      const fallbackDate = instructionRow?.createdAt
        ?? actionRows.find((action) => target.actionIds.has(action.id))?.createdAt
        ?? runRows.find((run) => target.runIds.has(run.id))?.createdAt
        ?? new Date(0);
      const sourceCalls = callsForCase;
      output.push({
        id: `${target.root.kind}:${target.root.id}`,
        root: target.root,
        title: caseTitle(instruction, actions, workflows, target.root),
        status,
        createdAt: minDate([
          instructionRow?.createdAt,
          ...[...target.actionIds].map((id) => actionById.get(id)?.createdAt),
          ...[...target.runIds].map((id) => runById.get(id)?.createdAt),
        ], fallbackDate),
        updatedAt: maxDate([
          instructionRow?.updatedAt,
          ...[...target.actionIds].map((id) => actionById.get(id)?.createdAt),
          ...[...target.runIds].map((id) => runById.get(id)?.updatedAt),
          ...receipts.map((receipt) => new Date(receipt.finalizedAt ?? receipt.createdAt)),
          ...operations.map((operation) => new Date(operation.updatedAt)),
          objectiveLoop?.updatedAt,
          ...objectiveStepRows.filter((step) => step.objectiveLoopId === objectiveLoop?.id).map((step) => step.completedAt ?? step.startedAt),
        ], fallbackDate),
        source: sourceForCase(instruction, actions, sourceCalls, target.root),
        instruction,
        actions,
        approvals,
        workflows,
        receipts,
        operations,
        linkedEntities,
        businessEvents: businessEventList.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        calls: sourceCalls,
        relatedActionIds: [...target.relatedActionIds].sort(),
        provenance: [...target.provenance].sort(),
        ...(durableWork ? {
          durableWork: {
            id: durableWork.id,
            status: durableWork.status,
            executionModel: durableWork.executionModel,
            sessionId: durableWork.sessionId,
            channel: durableWork.initialChannel,
            activeContext: durableWork.activeContext,
            initiatedBy: durableWork.createdBy,
            currentOwnerId: durableWork.currentOwnerId,
            assignedTo: durableWork.assignedTo,
            authorityContext: durableWork.authorityContext,
            finalOutcome: durableWork.finalOutcome,
            failure: durableWork.failure,
            recovery: durableWork.recovery,
            handoffs: workEventRows.filter((event) => event.workId === durableWork.id && event.eventType === "employee_handoff").map((event) => {
              const payload = record(event.payload) ?? {};
              return {
                sequence: event.seq,
                fromEmployeeId: stringValue(payload.fromEmployeeId),
                toEmployeeId: stringValue(payload.toEmployeeId),
                actorId: stringValue(payload.actorId),
                note: stringValue(payload.note),
                authorityRevision: typeof payload.authorityRevision === "number" ? payload.authorityRevision : null,
                createdAt: event.createdAt.toISOString(),
              };
            }),
          },
          inputs: workInputRows.filter((input) => input.workId === durableWork.id).map((input) => ({
            id: input.id,
            instructionId: input.instructionId,
            channel: input.channel,
            text: input.instructionText,
            createdAt: input.createdAt.toISOString(),
          })),
          plannerAttempts: plannerAttemptRows.filter((attempt) => attempt.workId === durableWork.id).map((attempt) => ({
            id: attempt.id,
            attempt: attempt.attempt,
            status: attempt.status,
            result: attempt.plannerResult,
            failure: attempt.failure,
            startedAt: attempt.startedAt.toISOString(),
            completedAt: iso(attempt.completedAt),
          })),
          ...(objectiveLoop ? {
            objectiveLoop: {
              id: objectiveLoop.id,
              objective: objectiveLoop.objective,
              state: objectiveLoop.state,
              revision: objectiveLoop.revision,
              reason: objectiveLoop.reason,
              nextStep: objectiveLoop.nextStep,
              nextRunAt: iso(objectiveLoop.nextRunAt),
              lastObservation: objectiveLoop.lastObservation,
              successCondition: objectiveLoop.successCondition,
              successVerification: objectiveLoop.successVerification,
              successVerifiedAt: iso(objectiveLoop.successVerifiedAt),
              cancelledAt: iso(objectiveLoop.cancelledAt),
              budget: {
                steps: objectiveLoop.stepCount,
                maxSteps: objectiveLoop.maxSteps,
                actions: objectiveLoop.actionCount,
                maxActions: objectiveLoop.maxActions,
                queries: objectiveLoop.queryCount,
                maxQueries: objectiveLoop.maxQueries,
              },
              iterations: objectiveStepRows.filter((step) => step.objectiveLoopId === objectiveLoop.id).map((step) => ({
                id: step.id,
                stepNumber: step.stepNumber,
                phase: step.phase,
                decisionKind: step.decisionKind,
                reason: step.decisionReason,
                observation: step.observation,
                progressMade: step.progressMade,
                outcome: step.iterationOutcome,
                recoveryKind: step.recoveryKind,
                successVerification: step.successVerification,
                scheduledFor: iso(step.scheduledFor),
                completedAt: iso(step.completedAt),
                plannerAttempts: objectiveAttemptRows.filter((attempt) => attempt.objectiveStepId === step.id).map((attempt) => ({ id: attempt.id, attempt: attempt.attempt, status: attempt.status, provider: attempt.provider, failure: attempt.failure })),
              })),
            },
          } : {}),
        } : {}),
      });
    }
    return output.sort(caseSort);
  });
}

export const workCasesReadModel = workCases;
