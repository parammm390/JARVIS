// P4.T8 execution observability. This module records only real workflow status
// events and the browser frame in which the corresponding step became visible.
// It never creates an event, infers a missing run, or treats an animation
// duration as a latency measurement.

export type ExecutionMetricTransport = "poll" | "sse"
export type ExecutionMetricEntity = "step" | "run"

export interface ExecutionMetricEvent {
  key: string
  entity: ExecutionMetricEntity
  entityId: string
  status: string
  transport: ExecutionMetricTransport
  receivedAtMs: number
}

export interface ExecutionPixelMeasurement extends ExecutionMetricEvent {
  paintedAtMs: number
  eventToPixelMs: number
}

export interface ExecutionPixelSummary {
  sampleSize: number
  medianMs: number | null
  p95Ms: number | null
}

declare global {
  interface Window {
    /** Ephemeral inspection copy for the Phase 4 runtime audit. */
    __jarvisExecutionPixelMeasurements?: ExecutionPixelMeasurement[]
  }
}

const MAX_MEASUREMENTS = 100
const pending = new Map<string, ExecutionMetricEvent>()
const paintedAt = new Map<string, number>()
const completedKeys = new Set<string>()
const measurements: ExecutionPixelMeasurement[] = []
const listeners = new Set<(measurement: ExecutionPixelMeasurement) => void>()

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function syncBrowserInspection(): void {
  if (typeof window === "undefined") return
  // Keep this as a copy. The inspection surface is not a second mutable source
  // of truth for the kernel's workflow state.
  window.__jarvisExecutionPixelMeasurements = measurements.map((measurement) => ({ ...measurement }))
}

function publish(event: ExecutionMetricEvent, paintedAtMs: number): ExecutionPixelMeasurement {
  const measurement: ExecutionPixelMeasurement = {
    ...event,
    paintedAtMs,
    eventToPixelMs: Math.max(0, paintedAtMs - event.receivedAtMs),
  }
  measurements.push(measurement)
  if (measurements.length > MAX_MEASUREMENTS) measurements.shift()
  syncBrowserInspection()
  listeners.forEach((listener) => listener(measurement))
  return measurement
}

function complete(key: string, paintedAtMs: number): ExecutionPixelMeasurement | null {
  const event = pending.get(key)
  if (!event || completedKeys.has(key)) return null
  pending.delete(key)
  completedKeys.add(key)
  return publish(event, Math.max(paintedAtMs, event.receivedAtMs))
}

/** Stable key shared by the poll/SSE event boundary and the rendered node. */
export function executionMetricTransitionKey(type: string, id: string, previous: string | undefined, next: string): string {
  return `${type}:${id}:${previous ?? "unknown"}->${next}`
}

/** Record a status edge only after the authoritative transport has delivered it. */
export function recordExecutionEventReceived(event: Omit<ExecutionMetricEvent, "receivedAtMs"> & { receivedAtMs?: number }): void {
  if (!event.key || !event.entityId || completedKeys.has(event.key) || pending.has(event.key)) return
  const receivedAtMs = event.receivedAtMs ?? nowMs()
  const existingPaint = paintedAt.get(event.key)
  const normalized: ExecutionMetricEvent = { ...event, receivedAtMs }
  if (existingPaint !== undefined) {
    pending.set(event.key, normalized)
    complete(event.key, Math.max(existingPaint, receivedAtMs))
    return
  }
  pending.set(event.key, normalized)
}

/** Mark the browser frame in which the corresponding real state is visible. */
export function markExecutionPixelPainted(key: string, paintedAtMs = nowMs()): ExecutionPixelMeasurement | null {
  if (!key) return null
  const previous = paintedAt.get(key)
  if (previous !== undefined && previous >= paintedAtMs) return null
  paintedAt.set(key, paintedAtMs)
  return complete(key, paintedAtMs)
}

export function onExecutionPixelMeasurement(listener: (measurement: ExecutionPixelMeasurement) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getExecutionPixelMeasurements(filter?: { entity?: ExecutionMetricEntity; transport?: ExecutionMetricTransport }): ExecutionPixelMeasurement[] {
  return measurements.filter((measurement) => {
    if (filter?.entity && measurement.entity !== filter.entity) return false
    if (filter?.transport && measurement.transport !== filter.transport) return false
    return true
  })
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? null
}

/** Deterministic nearest-rank summary used by the runtime report. */
export function summarizeExecutionPixelMeasurements(values = measurements): ExecutionPixelSummary {
  const durations = values.map((measurement) => measurement.eventToPixelMs).filter((value) => Number.isFinite(value) && value >= 0)
  return {
    sampleSize: durations.length,
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  }
}

/** Test/reset seam; production callers never clear the session-local bus. */
export function resetExecutionPixelMeasurements(): void {
  pending.clear()
  paintedAt.clear()
  completedKeys.clear()
  measurements.length = 0
  syncBrowserInspection()
}

syncBrowserInspection()
