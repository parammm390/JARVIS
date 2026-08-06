import { describe, expect, it } from "vitest"
import {
  LF09_DECISION_WAVE_MS,
  LF10_WORKFLOW_IGNITION_MS,
  LF11_FLOW_FAST_MS,
  LF11_FLOW_SLOW_MS,
  LF12_STEP_SPARK_MS,
  LF13_FAULT_FRACTURE_MS,
  leasedFlowDurationMs,
  workflowFaultVariants,
} from "./execution-choreography"

describe("Phase 4 execution motion contracts", () => {
  it("keeps the plan-defined impulse durations", () => {
    expect(LF09_DECISION_WAVE_MS).toBe(520)
    expect(LF10_WORKFLOW_IGNITION_MS).toBe(300)
    expect(LF12_STEP_SPARK_MS).toBe(340)
    expect(LF13_FAULT_FRACTURE_MS).toBe(160)
  })

  it("maps bounded live energy from the slow to fast leased flow", () => {
    expect(leasedFlowDurationMs(0)).toBe(LF11_FLOW_SLOW_MS)
    expect(leasedFlowDurationMs(1)).toBe(LF11_FLOW_FAST_MS)
    expect(leasedFlowDurationMs(-1)).toBe(LF11_FLOW_SLOW_MS)
    expect(leasedFlowDurationMs(2)).toBe(LF11_FLOW_FAST_MS)
  })

  it("leaves reduced-motion failure state semantic and still local", () => {
    expect(workflowFaultVariants(true).animate).toEqual({ x: 0, opacity: 1, transition: { duration: 0 } })
    expect(workflowFaultVariants(false).animate).toMatchObject({ x: [0, -4, 4, 0], transition: { duration: 0.16 } })
  })
})
