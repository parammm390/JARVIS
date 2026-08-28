import type {
  AssistantSemanticKind,
  InstructionExecutionModel,
  WorkCaseProjection,
} from "@/lib/jarvis-client"
import type { AnswerResult, DurableThreadMessage, Thread, ThreadNode } from "./store"
import type { InstructionState } from "./types"

export interface CanonicalWorkPosture {
  status: string
  reason: string | null
  nextStep: string | null
  nextRunAt: string | null
  revision: number | null
  successVerifiedAt: string | null
  recoveryKind: string | null
  projectedAt: string
}

export interface WorkThreadProjection {
  workId: string
  executionModel: InstructionExecutionModel
  objectiveLoopId: string | null
  instructionState: InstructionState
  nodes: ThreadNode[]
  answerResult: AnswerResult | null
  assistantSemanticKind: AssistantSemanticKind | null
  workPosture: CanonicalWorkPosture
  objectiveProjection: WorkCaseProjection["objectiveLoop"] | null
  everExecuted: boolean
  terminalAtMs: number | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function responseFromWork(work: WorkCaseProjection): Record<string, unknown> | null {
  const outcome = record(work.durableWork?.finalOutcome)
  return record(outcome?.response)
}

function executionModel(work: WorkCaseProjection, response: Record<string, unknown> | null): InstructionExecutionModel {
  const stored = response?.executionModel
  if (stored === "QUERY" || stored === "CONVERSATION" || stored === "ATOMIC_EFFECT" || stored === "OBJECTIVE") return stored
  switch (work.durableWork?.executionModel) {
    case "query": return "QUERY"
    case "atomic_effect": return "ATOMIC_EFFECT"
    case "objective": return "OBJECTIVE"
    default:
      if (work.objectiveLoop) return "OBJECTIVE"
      if (work.actions.length > 0) return "ATOMIC_EFFECT"
      return "CONVERSATION"
  }
}

function semanticFromMessage(message: DurableThreadMessage | null | undefined): AssistantSemanticKind | null {
  const semantic = message?.outcomeRefs?.find((ref) => ref.kind === "assistant_semantic")?.semanticKind
  return semantic === "ANSWER" || semantic === "ACKNOWLEDGEMENT" || semantic === "CLARIFICATION" ? semantic : null
}

function assistantSemantic(response: Record<string, unknown> | null, fallback: DurableThreadMessage | null | undefined): AssistantSemanticKind | null {
  const assistant = record(response?.assistantMessage)
  const semantic = assistant?.semanticKind
  if (semantic === "ANSWER" || semantic === "ACKNOWLEDGEMENT" || semantic === "CLARIFICATION") return semantic
  return semanticFromMessage(fallback)
}

function answerFrom(response: Record<string, unknown> | null, semantic: AssistantSemanticKind | null, fallback: DurableThreadMessage | null | undefined): AnswerResult | null {
  if (semantic !== "ANSWER") return null
  const raw = record(response?.answer)
  if (raw?.kind === "answer" && typeof raw.spokenSummary === "string" && raw.spokenSummary.trim()) {
    return { kind: "answer", spokenSummary: raw.spokenSummary }
  }
  return fallback?.originalText ? { kind: "answer", spokenSummary: fallback.originalText } : null
}

function objectiveVerified(work: WorkCaseProjection): boolean {
  if (!work.objectiveLoop?.successVerifiedAt) return false
  return record(work.objectiveLoop.successVerification)?.state === "verified"
}

function projectInstructionState(work: WorkCaseProjection, model: InstructionExecutionModel): InstructionState {
  const durable = work.durableWork?.status ?? ""
  if (model === "OBJECTIVE" && work.objectiveLoop) {
    switch (work.objectiveLoop.state) {
      case "continue": return durable === "recovery" ? "recovering" : "executing"
      case "awaiting_approval": return "awaiting_approval"
      case "waiting": return "waiting"
      case "blocked": return "blocked"
      case "completed": return objectiveVerified(work) ? "completed" : "verifying"
      case "failed": return "failed"
      case "cancelled": return "cancelled"
    }
  }
  switch (durable) {
    case "received": return "captured"
    case "understanding": return "understanding"
    case "planning": return "planning"
    case "ready":
    case "actionable":
    case "awaiting_approval": return "awaiting_approval"
    case "executing": return "executing"
    case "waiting": return "waiting"
    case "blocked": return "blocked"
    case "recovery": return "recovering"
    case "completed": return "completed"
    case "failed": return "failed"
    case "cancelled": return "cancelled"
    default:
      if (work.status === "Needs you") return "awaiting_approval"
      if (work.status === "Blocked") return "blocked"
      if (work.status === "Working") return "executing"
      if (work.status === "Waiting") return "waiting"
      if (work.status === "Partial") return "partial"
      if (work.status === "Completed") return model === "OBJECTIVE" && !objectiveVerified(work) ? "verifying" : "completed"
      if (work.status === "Failed") return "failed"
      if (work.status === "Cancelled") return "cancelled"
      return "planning"
  }
}

function projectedNodes(work: WorkCaseProjection, existing: ThreadNode[] = []): ThreadNode[] {
  const prior = new Map(existing.map((node) => [node.id, node]))
  return work.actions.map((action) => prior.get(action.id) ?? {
    id: action.id,
    actionType: action.actionType,
    amountUsd: typeof action.payload.amountUsd === "number" ? action.payload.amountUsd : null,
    targetLabel: typeof action.payload.targetLabel === "string" ? action.payload.targetLabel : null,
    policyId: null,
    policyVersion: null,
    groundedPayload: [],
    payload: action.payload,
    dependsOn: action.dependsOn,
  })
}

function latestRecoveryKind(work: WorkCaseProjection): string | null {
  const iterations = work.objectiveLoop?.iterations ?? []
  return [...iterations].reverse().find((iteration) => iteration.recoveryKind)?.recoveryKind ?? null
}

function hasExecuted(work: WorkCaseProjection): boolean {
  return work.actions.some((action) => ["executing", "completed", "failed", "blocked_integration_unavailable"].includes(action.status))
    || work.workflows.length > 0
    || work.receipts.length > 0
    || (work.businessEffects?.some((effect) => !["compiled", "authorized"].includes(effect.status)) ?? false)
    || (work.computerRuns?.some((run) => Boolean(run.startedAt || run.finishedAt)) ?? false)
    || (work.objectiveLoop?.iterations.some((iteration) => Boolean(iteration.completedAt)) ?? false)
}

function activeEventWait(work: WorkCaseProjection) {
  return [...(work.objectiveLoop?.eventWaits ?? [])]
    .reverse()
    .find((wait) => wait.status === "waiting" || wait.status === "pending") ?? null
}

export function projectWorkToThread(
  work: WorkCaseProjection,
  options: { existingNodes?: ThreadNode[]; assistantMessage?: DurableThreadMessage | null } = {},
): WorkThreadProjection {
  const response = responseFromWork(work)
  const model = executionModel(work, response)
  const semantic = assistantSemantic(response, options.assistantMessage)
  const state = projectInstructionState(work, model)
  const terminal = state === "completed" || state === "partial" || state === "failed" || state === "cancelled"
  const eventWait = activeEventWait(work)
  return {
    workId: work.durableWork?.id ?? work.id,
    executionModel: model,
    objectiveLoopId: work.objectiveLoop?.id ?? null,
    instructionState: state,
    nodes: projectedNodes(work, options.existingNodes),
    answerResult: (model === "QUERY" || model === "CONVERSATION") ? answerFrom(response, semantic, options.assistantMessage) : null,
    assistantSemanticKind: semantic,
    workPosture: {
      status: work.objectiveLoop?.state ?? work.durableWork?.status ?? work.status,
      reason: work.objectiveLoop?.reason ?? eventWait?.conditionSummary ?? null,
      nextStep: work.objectiveLoop?.nextStep ?? null,
      nextRunAt: work.objectiveLoop?.nextRunAt ?? eventWait?.deadlineAt ?? null,
      revision: work.objectiveLoop?.revision ?? null,
      successVerifiedAt: work.objectiveLoop?.successVerifiedAt ?? null,
      recoveryKind: latestRecoveryKind(work),
      projectedAt: work.updatedAt,
    },
    objectiveProjection: work.objectiveLoop ?? null,
    everExecuted: hasExecuted(work),
    terminalAtMs: terminal ? new Date(work.updatedAt).getTime() : null,
  }
}

export function applyWorkToThread(thread: Thread, work: WorkCaseProjection, assistantMessage?: DurableThreadMessage | null): Thread {
  const projection = projectWorkToThread(work, { existingNodes: thread.nodes, assistantMessage })
  return {
    ...thread,
    workId: projection.workId,
    executionModel: projection.executionModel,
    objectiveLoopId: projection.objectiveLoopId,
    workPosture: projection.workPosture,
    objectiveProjection: projection.objectiveProjection,
    assistantSemanticKind: projection.assistantSemanticKind,
    machine: { instructionState: projection.instructionState },
    nodes: projection.nodes,
    answerResult: projection.answerResult,
    terminalAtMs: projection.terminalAtMs,
    everExecuted: thread.everExecuted || projection.everExecuted,
  }
}
