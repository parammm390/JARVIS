// Measured instruction trace observability. This is deliberately a tiny in-memory
// bus: it records the real time an event reached the browser and the next paint
// that made its corresponding thread stage visible. It never synthesizes an event
// or uses a fixed animation duration as a latency claim.

export type TracePixelStage = "heard" | "understood" | "plan" | "execution" | "receipt"

export interface TraceMetricEvent {
  seq: number
  phase: string
}

export interface TracePixelMeasurement {
  instructionId: string
  seq: number
  phase: string
  stage: TracePixelStage
  eventReceivedAtMs: number
  paintedAtMs: number
  eventToPixelMs: number
}

declare global {
  interface Window {
    /** Ephemeral read-only inspection copy for the Phase 3 runtime audit. */
    __jarvisTracePixelMeasurements?: TracePixelMeasurement[]
  }
}

function syncBrowserInspection(): void {
  if (typeof window === "undefined") return
  // Keep this as a copy: the inspection surface must not become a second
  // mutable source of truth for the kernel's measurements.
  window.__jarvisTracePixelMeasurements = measurements.map((measurement) => ({ ...measurement }))
}

const pending = new Map<string, { instructionId: string; event: TraceMetricEvent; stage: TracePixelStage; receivedAtMs: number }>()
const paintedAt = new Map<string, number>()
const measurements: TracePixelMeasurement[] = []
const listeners = new Set<(measurement: TracePixelMeasurement) => void>()

// Make the inspection surface explicit even before the first real trace event
// arrives: an empty array means "the module is present and no measurement has
// been recorded", while an absent property means an older deployment or a
// surface that never loaded this module.
syncBrowserInspection()

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

export function traceStageForPhase(phase: string): TracePixelStage | null {
  switch (phase) {
    case "received":
      return "heard"
    case "context_retrieved":
    case "planning":
      return "understood"
    case "plan_ready":
    case "clarification_required":
    case "action_created":
    case "action_gated":
      return "plan"
    case "dispatched":
    case "executing":
    case "step_progress":
    case "verifying":
    case "verified":
      return "execution"
    case "completed":
    case "failed":
    case "cancelled":
      return "receipt"
    default:
      return null
  }
}

function publish(measurement: TracePixelMeasurement): void {
  measurements.push(measurement)
  if (measurements.length > 100) measurements.shift()
  syncBrowserInspection()
  listeners.forEach((listener) => listener(measurement))
}

function complete(key: string, paintedAtMs: number): void {
  const item = pending.get(key)
  if (!item) return
  pending.delete(key)
  publish({
    instructionId: item.instructionId,
    seq: item.event.seq,
    phase: item.event.phase,
    stage: item.stage,
    eventReceivedAtMs: item.receivedAtMs,
    paintedAtMs,
    eventToPixelMs: Math.max(0, paintedAtMs - item.receivedAtMs),
  })
}

export function recordTraceEventReceived(instructionId: string, event: TraceMetricEvent, receivedAtMs = nowMs()): void {
  const stage = traceStageForPhase(event.phase)
  if (!stage) return
  const key = `${instructionId}:${event.seq}`
  if (pending.has(key)) return
  const existingPaint = paintedAt.get(`${instructionId}:${stage}`)
  if (existingPaint !== undefined) {
    pending.set(key, { instructionId, event, stage, receivedAtMs })
    complete(key, Math.max(existingPaint, receivedAtMs))
    return
  }
  pending.set(key, { instructionId, event, stage, receivedAtMs })
}

/** Mark the next browser frame in which a thread stage is present. The caller
 *  supplies the rAF timestamp so tests and production use the same calculation. */
export function markTraceStagePainted(instructionId: string, stage: TracePixelStage, paintedAtMs = nowMs()): TracePixelMeasurement[] {
  const stageKey = `${instructionId}:${stage}`
  const previous = paintedAt.get(stageKey)
  if (previous !== undefined && previous >= paintedAtMs) return []
  paintedAt.set(stageKey, paintedAtMs)
  const keys = [...pending.entries()]
    .filter(([, item]) => item.instructionId === instructionId && item.stage === stage)
    .sort((a, b) => a[1].event.seq - b[1].event.seq)
    .map(([key]) => key)
  const before = measurements.length
  for (const key of keys) complete(key, paintedAtMs)
  return measurements.slice(before)
}

export function onTracePixelMeasurement(listener: (measurement: TracePixelMeasurement) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTracePixelMeasurements(instructionId?: string): TracePixelMeasurement[] {
  return measurements.filter((measurement) => !instructionId || measurement.instructionId === instructionId)
}

/** Test/reset seam; production callers never need to clear the session-local bus. */
export function resetTracePixelMeasurements(): void {
  pending.clear()
  paintedAt.clear()
  measurements.length = 0
  syncBrowserInspection()
}
