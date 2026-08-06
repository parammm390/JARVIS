import type { WorkflowRun } from "../lib/data-core"

export type ActionExecutionState =
  | "unobserved"
  | "blocked"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "cancelled"
  | "escalated"

export interface ExecutionProgress {
  totalActions: number
  linkedActions: number
  completedActions: number
  failedActions: number
  blockedActions: number
  compensatingActions: number
  compensatedActions: number
  cancelledActions: number
  escalatedActions: number
  activeActions: number
  runningActions: number
  pausedActions: number
  unresolvedActions: number
  totalSteps: number
  completedSteps: number
  failedSteps: number
  actionStates: Record<string, ActionExecutionState>
  runs: WorkflowRun[]
}

const FAILURE_STEP_STATES = new Set(["failed", "compensating", "compensated"])

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Keep only runs whose durable workflow step points at one of this instruction's
 * domain actions. A run without that link is intentionally excluded: showing it
 * would make a tenant-wide run look like the active instruction's consequence.
 */
export function runsForActionIds(runs: WorkflowRun[], actionIds: readonly string[]): WorkflowRun[] {
  if (actionIds.length === 0 || runs.length === 0) return []
  const ids = new Set(actionIds)
  const latestById = new Map<string, WorkflowRun>()
  for (const run of runs) {
    if (!run.steps.some((step) => step.domainActionId !== null && ids.has(step.domainActionId))) continue
    const previous = latestById.get(run.id)
    if (!previous || timestamp(run.updatedAt) >= timestamp(previous.updatedAt)) latestById.set(run.id, run)
  }
  return [...latestById.values()].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))
}

function stateForAction(run: WorkflowRun, actionId: string): ActionExecutionState {
  const actionSteps = run.steps.filter((step) => step.domainActionId === actionId)
  if (run.status === "cancelled") return "cancelled"
  if (run.status === "escalated") return "escalated"
  if (run.status === "compensating" || actionSteps.some((step) => step.status === "compensating")) return "compensating"
  if (run.status === "compensated" || actionSteps.some((step) => step.status === "compensated")) return "compensated"
  if (run.status === "completed" || (actionSteps.length > 0 && actionSteps.every((step) => step.status === "completed"))) return "completed"
  if (run.status === "failed" || actionSteps.some((step) => step.status === "failed")) return "failed"
  if (run.status === "paused") return "paused"
  return "running"
}

/** The action id(s) carried by a run's real workflow steps. */
function actionIdsForRun(run: WorkflowRun, actionIds: Set<string>): string[] {
  return [...new Set(run.steps.map((step) => step.domainActionId).filter((id): id is string => id !== null && actionIds.has(id)))]
}

function stepsForActionIds(run: WorkflowRun, actionIds: Set<string>) {
  return run.steps.filter((step) => step.domainActionId !== null && actionIds.has(step.domainActionId))
}

/**
 * Derive instruction-level progress from the latest linked run for each action.
 * `traceOutcomes` covers the short synchronous path while the durable run row is
 * still arriving; it never replaces a linked run, which is the stronger source.
 */
export function executionProgressForActions(
  actionIds: readonly string[],
  runs: WorkflowRun[],
  traceOutcomes?: { completedActionIds?: readonly string[]; failedActionIds?: readonly string[] },
  blockedActionIds: readonly string[] = [],
): ExecutionProgress {
  const uniqueActionIds = [...new Set(actionIds)]
  const actionIdSet = new Set(uniqueActionIds)
  const blockedIds = new Set(blockedActionIds)
  const scopedRuns = runsForActionIds(runs, uniqueActionIds)
  const latestRunByAction = new Map<string, WorkflowRun>()

  for (const run of scopedRuns) {
    for (const actionId of actionIdsForRun(run, actionIdSet)) {
      const previous = latestRunByAction.get(actionId)
      if (!previous || timestamp(run.updatedAt) >= timestamp(previous.updatedAt)) latestRunByAction.set(actionId, run)
    }
  }

  const actionStates: Record<string, ActionExecutionState> = {}
  for (const actionId of uniqueActionIds) {
    const run = latestRunByAction.get(actionId)
    if (run) {
      actionStates[actionId] = stateForAction(run, actionId)
      continue
    }
    if (traceOutcomes?.completedActionIds?.includes(actionId)) actionStates[actionId] = "completed"
    else if (traceOutcomes?.failedActionIds?.includes(actionId)) actionStates[actionId] = "failed"
    else if (blockedIds.has(actionId)) actionStates[actionId] = "blocked"
    else actionStates[actionId] = "unobserved"
  }

  const latestRuns = [...new Set(latestRunByAction.values())]
  const completedSteps = latestRuns.reduce((count, run) => count + stepsForActionIds(run, actionIdSet).filter((step) => step.status === "completed").length, 0)
  const failedSteps = latestRuns.reduce((count, run) => count + stepsForActionIds(run, actionIdSet).filter((step) => FAILURE_STEP_STATES.has(step.status)).length, 0)
  const completedActions = uniqueActionIds.filter((id) => actionStates[id] === "completed").length
  const failedActions = uniqueActionIds.filter((id) => actionStates[id] === "failed").length
  const blockedActions = uniqueActionIds.filter((id) => actionStates[id] === "blocked").length
  const compensatingActions = uniqueActionIds.filter((id) => actionStates[id] === "compensating").length
  const compensatedActions = uniqueActionIds.filter((id) => actionStates[id] === "compensated").length
  const cancelledActions = uniqueActionIds.filter((id) => actionStates[id] === "cancelled").length
  const escalatedActions = uniqueActionIds.filter((id) => actionStates[id] === "escalated").length
  const runningActions = uniqueActionIds.filter((id) => actionStates[id] === "running").length
  const pausedActions = uniqueActionIds.filter((id) => actionStates[id] === "paused").length
  const activeActions = runningActions + pausedActions + compensatingActions

  return {
    totalActions: uniqueActionIds.length,
    linkedActions: uniqueActionIds.filter((id) => actionStates[id] !== "unobserved").length,
    completedActions,
    failedActions,
    blockedActions,
    compensatingActions,
    compensatedActions,
    cancelledActions,
    escalatedActions,
    activeActions,
    runningActions,
    pausedActions,
    unresolvedActions: uniqueActionIds.filter((id) => actionStates[id] === "unobserved").length,
    totalSteps: latestRuns.reduce((count, run) => count + stepsForActionIds(run, actionIdSet).length, 0),
    completedSteps,
    failedSteps,
    actionStates,
    runs: latestRuns.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)),
  }
}

export type ScopedExecutionMode = "live" | "settled" | "trace" | "waiting" | "empty"

/**
 * The active instruction has exactly one truthful theater posture. In
 * particular, an empty action scope is not permission to fall back to a
 * tenant-wide catalog or replay surface.
 */
export function scopedExecutionMode(
  actionIds: readonly string[],
  liveRuns: readonly WorkflowRun[],
  terminalRuns: readonly WorkflowRun[],
  progress: ExecutionProgress,
): ScopedExecutionMode {
  if (actionIds.length === 0) return "empty"
  if (liveRuns.length > 0) return "live"
  if (terminalRuns.length > 0) return "settled"
  if (progress.linkedActions > 0 && progress.unresolvedActions === 0 && progress.activeActions === 0) return "trace"
  return "waiting"
}
