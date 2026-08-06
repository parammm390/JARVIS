import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  executionMetricTransitionKey,
  getExecutionPixelMeasurements,
  markExecutionPixelPainted,
  onExecutionPixelMeasurement,
  recordExecutionEventReceived,
  resetExecutionPixelMeasurements,
  summarizeExecutionPixelMeasurements,
} from "./execution-metrics"

beforeEach(() => {
  resetExecutionPixelMeasurements()
})

describe("kernel/execution-metrics", () => {
  it("closes a real poll event at the next rendered frame", () => {
    const key = executionMetricTransitionKey("step-completed", "step-1", "leased", "completed")
    const listener = vi.fn()
    const unsubscribe = onExecutionPixelMeasurement(listener)

    recordExecutionEventReceived({ key, entity: "step", entityId: "step-1", status: "completed", transport: "poll", receivedAtMs: 100 })
    expect(markExecutionPixelPainted(key, 124)).toMatchObject({
      key,
      entity: "step",
      transport: "poll",
      eventToPixelMs: 24,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("deduplicates repeated delivery and keeps poll/SSE samples filterable", () => {
    const key = executionMetricTransitionKey("step-failed", "step-2", "leased", "failed")
    const event = { key, entity: "step" as const, entityId: "step-2", status: "failed", transport: "sse" as const, receivedAtMs: 50 }
    recordExecutionEventReceived(event)
    recordExecutionEventReceived({ ...event, receivedAtMs: 90 })
    markExecutionPixelPainted(key, 75)
    markExecutionPixelPainted(key, 100)

    expect(getExecutionPixelMeasurements()).toHaveLength(1)
    expect(getExecutionPixelMeasurements({ transport: "sse" })).toHaveLength(1)
    expect(getExecutionPixelMeasurements({ transport: "poll" })).toHaveLength(0)
    expect(getExecutionPixelMeasurements()[0]?.eventToPixelMs).toBe(25)
  })

  it("closes an event that arrives after a previously painted state without negative latency", () => {
    const key = executionMetricTransitionKey("run-completed", "run-1", "running", "completed")
    markExecutionPixelPainted(key, 200)
    recordExecutionEventReceived({ key, entity: "run", entityId: "run-1", status: "completed", transport: "poll", receivedAtMs: 220 })

    expect(getExecutionPixelMeasurements()[0]?.eventToPixelMs).toBe(0)
  })

  it("reports deterministic nearest-rank median and p95 values", () => {
    const durations = [10, 20, 30, 40, 50]
    durations.forEach((duration, index) => {
      const key = executionMetricTransitionKey("step-completed", `step-${index}`, "leased", "completed")
      recordExecutionEventReceived({ key, entity: "step", entityId: `step-${index}`, status: "completed", transport: "poll", receivedAtMs: 0 })
      markExecutionPixelPainted(key, duration)
    })

    expect(summarizeExecutionPixelMeasurements()).toEqual({ sampleSize: 5, medianMs: 30, p95Ms: 50 })
  })

  it("keeps an ephemeral browser inspection copy", () => {
    const browserWindow: Record<string, unknown> = {}
    vi.stubGlobal("window", browserWindow)
    const key = executionMetricTransitionKey("step-completed", "step-3", "leased", "completed")
    recordExecutionEventReceived({ key, entity: "step", entityId: "step-3", status: "completed", transport: "poll", receivedAtMs: 10 })
    markExecutionPixelPainted(key, 26)

    expect(browserWindow.__jarvisExecutionPixelMeasurements).toEqual(getExecutionPixelMeasurements())
    expect(browserWindow.__jarvisExecutionPixelMeasurements).not.toBe(getExecutionPixelMeasurements())
    vi.unstubAllGlobals()
  })
})
