import { describe, expect, it } from "vitest"
import { shouldEmitStatusTransition } from "./data-core"

describe("workflow status transition reconciliation", () => {
  it("does not emit the first observation or a repeated fast/medium edge", () => {
    const ledger = new Set<string>()
    expect(shouldEmitStatusTransition(ledger, "step-completed", "step-1", undefined, "completed")).toBe(false)
    expect(shouldEmitStatusTransition(ledger, "step-completed", "step-1", "leased", "completed")).toBe(true)
    expect(shouldEmitStatusTransition(ledger, "step-completed", "step-1", "leased", "completed")).toBe(false)
  })

  it("allows a later real transition after a previous edge", () => {
    const ledger = new Set<string>()
    expect(shouldEmitStatusTransition(ledger, "run-failed", "run-1", "running", "failed")).toBe(true)
    expect(shouldEmitStatusTransition(ledger, "run-failed", "run-1", "failed", "running")).toBe(false)
    expect(shouldEmitStatusTransition(ledger, "run-failed", "run-1", "compensating", "failed")).toBe(true)
  })
})
