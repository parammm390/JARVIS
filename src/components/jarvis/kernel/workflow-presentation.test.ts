import { describe, expect, it } from "vitest"
import { runStatusPresentation, stepStatusPresentation } from "./workflow-presentation"
import type { RunState, StepState } from "./types"

const RUN_STATES: RunState[] = ["running", "completed", "failed", "compensating", "compensated", "paused", "cancelled", "escalated"]
const STEP_STATES: StepState[] = ["pending", "leased", "completed", "failed", "compensating", "compensated"]

describe("P7.T2 workflow state coverage", () => {
  it("renders all eight RunState values distinctly", () => {
    const labels = RUN_STATES.map((state) => runStatusPresentation(state).label)
    expect(new Set(labels).size).toBe(RUN_STATES.length)
    expect(runStatusPresentation("cancelled")).toMatchObject({ label: "cancelled", tone: "cancelled" })
    expect(runStatusPresentation("escalated")).toMatchObject({ label: "escalated", tone: "escalated" })
  })

  it("renders all six StepState values distinctly", () => {
    const presentations = STEP_STATES.map(stepStatusPresentation)
    expect(presentations).toHaveLength(6)
    expect(stepStatusPresentation("leased").label).toBe("leased")
    expect(stepStatusPresentation("compensating").label).toBe("Rolling back")
    expect(stepStatusPresentation("compensated").label).toBe("Rolled back")
  })
})
