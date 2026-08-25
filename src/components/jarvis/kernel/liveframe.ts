// LIVEFRAME — the presentation projection for the JARVIS canvas.
//
// This module deliberately sits at the kernel boundary. It consumes facts that
// the existing kernel, voice session, and workflow read model already expose;
// it does not create a second lifecycle machine or own any business state.
// There is no clock, I/O, subscription, hook, mutation, or random value here.
// Callers pass the current time and the latest real impulse explicitly.

import type { InstructionState, Presence } from "./types"
import type { TransportHealth } from "./transport"

export const LIVEFRAME_MODES = [
  "ready",
  "listening",
  "thinking",
  "decision",
  "working",
  "verifying",
  "resolved",
  "fault",
] as const

export type LiveFrameMode = (typeof LIVEFRAME_MODES)[number]

export const LIVEFRAME_FOCUSES = [
  "presence",
  "thread",
  "clarification",
  "approval",
  "workflow",
  "receipt",
  "recovery",
] as const

export type LiveFrameFocus = (typeof LIVEFRAME_FOCUSES)[number]

export type LiveFrameTransportPosture = "healthy" | "degraded" | "offline"

/** A real event impulse supplied by the event/pulse owner. The projection only
 * decays it; it never creates an event or chooses a duration. */
export interface LiveFrameImpulse {
  atMs: number
  durationMs: number
  kind?: string
}

/** A real authenticated-submit edge that the presentation layer may carry to
 * the Dock, Orb, and Heard block. `id` is presentation identity only; the
 * accepted submit remains owned by the existing kernel promise. */
export interface LiveFrameIntentLaunch extends LiveFrameImpulse {
  id: number
  kind: "intent-launch"
}

/** The existing Thread/Instruction Machine facts needed by LIVEFRAME. The
 * caller maps `thread.machine.instructionState`, `thread.nodes`, and the
 * existing clarification/recovery signals into this structural boundary. */
export interface LiveFrameInstructionSignals {
  state: InstructionState | null
  actionIds: readonly string[]
  clarificationRequired?: boolean
  approvalRequired?: boolean
  verificationActive?: boolean
  recoveryActive?: boolean
}

/** Structural subset of the existing workflow read model. Keeping this
 * boundary structural avoids making the pure projection import a data provider
 * at runtime. */
export interface LiveFrameStepSignal {
  id: string
  domainActionId: string | null
  status: string
}

export interface LiveFrameRunSignal {
  id: string
  status: string
  steps: readonly LiveFrameStepSignal[]
}

export interface LiveFrameInput {
  /** Sole presence value produced by `kernel/presence.ts`. */
  presence: Presence
  /** Existing transport health; LIVEFRAME exposes its human-safe posture. */
  transport: TransportHealth
  /** Existing voice facts. `localVolumeLevel` is the user's mic only. */
  micOpen: boolean
  voiceSpeaking: boolean
  localVolumeLevel?: number
  /** Explicit time supplied by the caller so this function remains pure. */
  nowMs: number
  instruction: LiveFrameInstructionSignals | null
  /** Existing workflow snapshots. Only steps linked to this instruction's
   * action IDs may affect the projection. */
  workflowRuns: readonly LiveFrameRunSignal[]
  latestImpulse: LiveFrameImpulse | null
}

export interface LiveFrameProjection {
  mode: LiveFrameMode
  focus: LiveFrameFocus
  presence: Presence
  energy: number
  activity: number
  voiceEnergy: number
  transportPosture: LiveFrameTransportPosture
  activeActionIds: string[]
  linkedRunIds: string[]
  activeRunIds: string[]
  activeStepIds: string[]
  latestImpulse: LiveFrameImpulse | null
}

/** Structural kernel seam shared by the home canvas and route-persistent dock. */
export interface KernelLiveFrameSource {
  presence: Presence
  transport: TransportHealth
  micOpen: boolean
  voiceSpeaking: boolean
  selectorInput: { now: number; runs: LiveFrameRunSignal[]; terminalRuns?: LiveFrameRunSignal[] }
  thread: {
    machine: { instructionState: InstructionState }
    nodes: Array<{ id: string }>
    clarification: unknown | null
  } | null
}

export function projectKernelLiveFrame(
  kernel: KernelLiveFrameSource,
  localVolumeLevel?: number,
  latestImpulse: LiveFrameIntentLaunch | null = null,
): LiveFrameProjection {
  const workflowRuns = kernel.selectorInput.terminalRuns
    ? [...kernel.selectorInput.runs, ...kernel.selectorInput.terminalRuns]
    : kernel.selectorInput.runs
  const state = kernel.thread?.machine.instructionState ?? null
  return deriveLiveFrame({
    presence: kernel.presence,
    transport: kernel.transport,
    micOpen: kernel.micOpen,
    voiceSpeaking: kernel.voiceSpeaking,
    localVolumeLevel,
    nowMs: kernel.selectorInput.now,
    instruction: kernel.thread ? {
      state,
      actionIds: kernel.thread.nodes.map((node) => node.id),
      clarificationRequired: kernel.thread.clarification !== null || state === "clarifying",
      approvalRequired: state === "awaiting_approval",
      verificationActive: state === "verifying",
    } : null,
    workflowRuns,
    latestImpulse,
  })
}

export const LIVEFRAME_ENERGY_BASE: Readonly<Record<LiveFrameMode, number>> = {
  ready: 0.12,
  listening: 0.28,
  thinking: 0.32,
  decision: 0.38,
  working: 0.48,
  verifying: 0.34,
  resolved: 0.24,
  fault: 0.3,
}

const ACTIVE_INSTRUCTION_STATES = new Set<InstructionState>([
  "captured",
  "understanding",
  "planning",
  "clarifying",
  "awaiting_approval",
  "executing",
  "verifying",
])

const TERMINAL_INSTRUCTION_STATES = new Set<InstructionState>([
  "completed",
  "partial",
  "failed",
  "cancelled",
])

const ACTIVE_RUN_STATES = new Set(["running", "paused", "compensating", "escalated"])
const RECOVERY_RUN_STATES = new Set(["failed", "compensating", "escalated"])
const ACTIVE_STEP_STATES = new Set(["leased", "compensating"])

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function transportPosture(transport: TransportHealth): LiveFrameTransportPosture {
  if (transport === "offline") return "offline"
  if (transport === "reconnecting" || transport === "unavailable") return "degraded"
  return "healthy"
}

/** Exponential decay, bounded by the real impulse's named duration. A future
 * timestamp is treated as the impulse's leading edge, not as a reason to
 * invent extra energy. */
function impulseEnergy(nowMs: number, impulse: LiveFrameImpulse | null): number {
  if (!impulse || !Number.isFinite(impulse.atMs) || !Number.isFinite(impulse.durationMs) || impulse.durationMs <= 0) return 0
  const elapsedMs = nowMs - impulse.atMs
  if (elapsedMs <= 0) return 1
  if (elapsedMs >= impulse.durationMs) return 0
  return clamp(Math.exp(-elapsedMs / impulse.durationMs), 0, 1)
}

function linkedWorkflow(
  actionIds: readonly string[],
  runs: readonly LiveFrameRunSignal[],
): { linkedRunIds: string[]; activeRunIds: string[]; activeStepIds: string[]; recoveryRun: boolean } {
  const actionSet = new Set(actionIds)
  const linkedRunIds: string[] = []
  const activeRunIds: string[] = []
  const activeStepIds: string[] = []
  let recoveryRun = false

  for (const run of runs) {
    const linkedSteps = run.steps.filter((step) => typeof step.domainActionId === "string" && actionSet.has(step.domainActionId))
    if (linkedSteps.length === 0) continue

    linkedRunIds.push(run.id)
    if (RECOVERY_RUN_STATES.has(run.status)) recoveryRun = true
    if (ACTIVE_RUN_STATES.has(run.status)) activeRunIds.push(run.id)
    for (const step of linkedSteps) {
      if (ACTIVE_STEP_STATES.has(step.status)) activeStepIds.push(step.id)
    }
  }

  return {
    linkedRunIds: uniqueIds(linkedRunIds),
    activeRunIds: uniqueIds(activeRunIds),
    activeStepIds: uniqueIds(activeStepIds),
    recoveryRun,
  }
}

function modeFromPresence(presence: Presence, hasActiveWorkflow: boolean): { mode: LiveFrameMode; focus: LiveFrameFocus } {
  switch (presence) {
    case "listening":
    case "hearing":
      return { mode: "listening", focus: "presence" }
    case "thinking":
      return { mode: "thinking", focus: "thread" }
    case "asking":
      return { mode: "decision", focus: "clarification" }
    case "proposing":
      return { mode: "decision", focus: "approval" }
    case "working":
      return { mode: "working", focus: hasActiveWorkflow ? "workflow" : "thread" }
    case "verifying":
      return { mode: "verifying", focus: "receipt" }
    case "resolved":
      return { mode: "resolved", focus: "receipt" }
    case "wounded":
    case "obstructed":
    case "severed":
      return { mode: "fault", focus: "recovery" }
    case "dormant":
    default:
      return { mode: "ready", focus: "presence" }
  }
}

/**
 * Project the current kernel/voice/data facts into the exact eight LIVEFRAME
 * modes. The branch order is the plan's §3.2 priority order:
 * decision -> execution/recovery -> verifying -> voice -> planning -> terminal
 * -> ready. Transport is retained as posture and only becomes a fault when no
 * more important user-facing focus is present.
 */
export function deriveLiveFrame(input: LiveFrameInput): LiveFrameProjection {
  const instruction = input.instruction
  const state = instruction ? instruction.state : null
  const actionIds = instruction ? uniqueIds(instruction.actionIds) : []
  const linked = linkedWorkflow(actionIds, input.workflowRuns)
  const hasActiveWorkflow = linked.activeRunIds.length > 0 || linked.activeStepIds.length > 0

  const clarificationRequired = Boolean(
    instruction && (instruction.clarificationRequired === true || state === "clarifying"),
  )
  const approvalRequired = Boolean(
    instruction && (instruction.approvalRequired === true || state === "awaiting_approval"),
  )
  const recoveryActive = Boolean(
    instruction && (
      instruction.recoveryActive === true ||
      (!TERMINAL_INSTRUCTION_STATES.has(state as InstructionState) && linked.recoveryRun)
    ),
  )

  let modeFocus: { mode: LiveFrameMode; focus: LiveFrameFocus }

  // 1. Explicit human decision: clarification before approval when a malformed
  // or mid-transition snapshot exposes both facts. Normal machine states are
  // mutually exclusive, so this is only a deterministic defensive tie-break.
  if (clarificationRequired) {
    modeFocus = { mode: "decision", focus: "clarification" }
  } else if (approvalRequired) {
    modeFocus = { mode: "decision", focus: "approval" }
  // 2. Active execution or recovery.
  } else if (recoveryActive) {
    modeFocus = { mode: "fault", focus: "recovery" }
  } else if (state === "executing") {
    modeFocus = { mode: "working", focus: hasActiveWorkflow ? "workflow" : "thread" }
  // 3. Verifying/reconciling outcome.
  } else if (state === "verifying" || instruction?.verificationActive === true) {
    modeFocus = { mode: "verifying", focus: "receipt" }
  // 4. Mic open or assistant speech.
  } else if (input.micOpen || input.voiceSpeaking) {
    modeFocus = { mode: "listening", focus: "presence" }
  // 5. Captured/understanding/planning.
  } else if (state !== null && ["captured", "understanding", "planning"].includes(state)) {
    modeFocus = { mode: "thinking", focus: "thread" }
  // 6. Terminal outcome. A terminal thread remains legible after its short
  // presence bloom; the mode is not invented from a timer.
  } else if (state === "completed") {
    modeFocus = { mode: "resolved", focus: "receipt" }
  } else if (state === "partial" || state === "failed") {
    modeFocus = { mode: "fault", focus: "recovery" }
  } else if (state === "cancelled" || state === "idle") {
    modeFocus = { mode: "ready", focus: "presence" }
  } else {
    // 7. No higher-priority instruction fact: retain the existing kernel
    // presence, then expose a disconnected idle surface as a fault.
    modeFocus = modeFromPresence(input.presence, hasActiveWorkflow)
    if (modeFocus.mode === "ready" && input.transport === "offline") {
      modeFocus = { mode: "fault", focus: "recovery" }
    }
  }

  const activeActionIds = instruction && state !== null && ACTIVE_INSTRUCTION_STATES.has(state)
    ? actionIds
    : instruction?.recoveryActive === true
      ? actionIds
      : []
  const activeRunIds = linked.activeRunIds
  const activeStepIds = linked.activeStepIds
  const activity = clamp(activeStepIds.length / 6, 0, 1)
  const voiceEnergy = input.micOpen
    ? clamp(typeof input.localVolumeLevel === "number" ? input.localVolumeLevel : 0, 0, 1)
    : 0
  const eventImpulse = impulseEnergy(input.nowMs, input.latestImpulse)
  const energy = clamp(
    LIVEFRAME_ENERGY_BASE[modeFocus.mode] + 0.45 * voiceEnergy + 0.25 * activity + 0.2 * eventImpulse,
    0,
    1,
  )

  return {
    mode: modeFocus.mode,
    focus: modeFocus.focus,
    presence: input.presence,
    energy,
    activity,
    voiceEnergy,
    transportPosture: transportPosture(input.transport),
    activeActionIds: [...activeActionIds],
    linkedRunIds: [...linked.linkedRunIds],
    activeRunIds: [...activeRunIds],
    activeStepIds: [...activeStepIds],
    latestImpulse: input.latestImpulse,
  }
}

/** Naming alias for callers that describe this operation as a projection. */
export const projectLiveFrame = deriveLiveFrame
