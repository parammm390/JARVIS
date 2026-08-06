import type { LiveFrameProjection } from "../kernel/liveframe"
import type { InstructionState, Presence } from "../kernel/types"
import type { TransportHealth } from "../kernel/transport"

export const ORB_VISUAL_STATES = [
  "idle",
  "listening",
  "acknowledged",
  "thinking",
  "answer-ready",
  "proposal-ready",
  "deferred",
  "needs-human-review",
  "executing",
  "verifying",
  "failed",
  "cancelled-stale",
] as const
export type OrbVisualState = (typeof ORB_VISUAL_STATES)[number]
export type CorrelatedOrbAction = { id: string; instructionId?: string | null; status: string }

export interface OrbVisualStateInput {
  instructionId?: string | null
  instructionState?: InstructionState | null
  answerResult?: unknown | null
  actions?: readonly CorrelatedOrbAction[]
  /** Current thread action ids are a valid correlation key even while an
   * approval is waiting and LIVEFRAME has no active execution ids yet. */
  currentActionIds?: readonly string[]
  transport: TransportHealth
  presence: Presence
  liveFrame: LiveFrameProjection
  cancelled?: boolean
}

function actionBelongsToCurrentThread(
  action: CorrelatedOrbAction,
  instructionId: string | null | undefined,
  activeActionIds: readonly string[],
): boolean {
  const matchesInstruction = Boolean(instructionId) && action.instructionId === instructionId
  const matchesAction = activeActionIds.includes(action.id)
  return matchesInstruction || matchesAction
}

export function deriveOrbVisualState(input: OrbVisualStateInput): OrbVisualState {
  const correlationActionIds = [...input.liveFrame.activeActionIds, ...(input.currentActionIds ?? [])]
  const correlated = input.actions?.filter((action) => actionBelongsToCurrentThread(action, input.instructionId, correlationActionIds)) ?? []
  const statuses = new Set(correlated.map((action) => action.status))

  // This is deliberately ordered. A stale/cancelled surface must never look
  // resolved just because an old answer or action row is still in memory.
  if (
    input.cancelled ||
    input.instructionState === "cancelled" ||
    input.transport === "offline" ||
    input.transport === "unavailable" ||
    input.liveFrame.transportPosture === "offline" ||
    input.presence === "severed"
  ) return "cancelled-stale"
  if (input.answerResult !== null && input.answerResult !== undefined) return "answer-ready"
  if (statuses.has("needs_human_review")) return "needs-human-review"
  if (statuses.has("blocked_integration_unavailable")) return "deferred"

  const state = input.instructionState
  if (state === "failed" || state === "partial" || input.presence === "wounded") return "failed"
  if (state === "executing" || input.liveFrame.mode === "working" || input.liveFrame.activeRunIds.length > 0) return "executing"
  if (state === "verifying" || input.liveFrame.mode === "verifying") return "verifying"
  if (state === "awaiting_approval" || (input.liveFrame.mode === "decision" && input.liveFrame.focus === "approval")) return "proposal-ready"
  if (state === "planning" || ((state === null || state === undefined) && input.liveFrame.mode === "thinking")) return "thinking"
  if (state === "captured" || state === "understanding" || input.liveFrame.latestImpulse?.kind === "acknowledged") return "acknowledged"
  if (input.presence === "listening" || input.presence === "hearing" || input.liveFrame.mode === "listening") return "listening"
  return "idle"
}
