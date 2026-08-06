import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getTracePixelMeasurements,
  markTraceStagePainted,
  onTracePixelMeasurement,
  recordTraceEventReceived,
  resetTracePixelMeasurements,
  traceStageForPhase,
} from "./trace-metrics"

beforeEach(() => {
  resetTracePixelMeasurements()
})

describe("kernel/trace-metrics", () => {
  it("maps only real lifecycle phases to visible stages", () => {
    expect(traceStageForPhase("received")).toBe("heard")
    expect(traceStageForPhase("context_retrieved")).toBe("understood")
    expect(traceStageForPhase("plan_ready")).toBe("plan")
    expect(traceStageForPhase("clarification_required")).toBe("plan")
    expect(traceStageForPhase("executing")).toBe("execution")
    expect(traceStageForPhase("completed")).toBe("receipt")
    expect(traceStageForPhase("made_up_phase")).toBeNull()
  })

  it("measures the real event-to-next-paint interval and publishes it", () => {
    const listener = vi.fn()
    const unsubscribe = onTracePixelMeasurement(listener)

    recordTraceEventReceived("i1", { seq: 2, phase: "planning" }, 100)
    expect(getTracePixelMeasurements("i1")).toEqual([])

    const measurements = markTraceStagePainted("i1", "understood", 124)
    expect(measurements[0]).toMatchObject({
      instructionId: "i1",
      seq: 2,
      phase: "planning",
      stage: "understood",
      eventReceivedAtMs: 100,
      paintedAtMs: 124,
      eventToPixelMs: 24,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("does not double-count duplicate event delivery and closes late-arriving events honestly", () => {
    recordTraceEventReceived("i1", { seq: 1, phase: "received" }, 50)
    recordTraceEventReceived("i1", { seq: 1, phase: "received" }, 90)
    markTraceStagePainted("i1", "heard", 75)
    expect(getTracePixelMeasurements("i1")).toHaveLength(1)
    expect(getTracePixelMeasurements("i1")[0]?.eventToPixelMs).toBe(25)

    recordTraceEventReceived("i1", { seq: 2, phase: "received" }, 100)
    expect(getTracePixelMeasurements("i1")).toHaveLength(2)
    expect(getTracePixelMeasurements("i1")[1]?.eventToPixelMs).toBe(0)
  })

  it("keeps an ephemeral browser inspection copy of the measured values", () => {
    const browserWindow: Record<string, unknown> = {}
    vi.stubGlobal("window", browserWindow)

    recordTraceEventReceived("i1", { seq: 1, phase: "received" }, 10)
    markTraceStagePainted("i1", "heard", 26)

    expect(browserWindow.__jarvisTracePixelMeasurements).toEqual(getTracePixelMeasurements())
    expect(browserWindow.__jarvisTracePixelMeasurements).not.toBe(getTracePixelMeasurements())
    vi.unstubAllGlobals()
  })
})
