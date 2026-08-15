import { describe, expect, it } from "vitest"
import { canContinueWork, continuationIdentity } from "./store"

describe("Work continuation identity", () => {
  it("carries the same durable Work and conversation session across a voice continuation", () => {
    const existing = {
      sessionId: "typed:original-session",
      workId: "work-123",
      instructionId: "instruction-1",
    }

    expect(continuationIdentity(existing, "vapi:new-call")).toEqual({
      sessionId: "typed:original-session",
      workId: "work-123",
    })
  })

  it("falls back to the prior instruction identity for pre-Work compatibility", () => {
    expect(continuationIdentity({ sessionId: "session-1", workId: null, instructionId: "instruction-1" }, "unused")).toEqual({
      sessionId: "session-1",
      workId: "instruction-1",
    })
  })

  it("allows explicit continuation only at a terminal boundary with durable identity", () => {
    expect(canContinueWork({ workId: "work-1", machine: { instructionState: "completed" } })).toBe(true)
    expect(canContinueWork({ workId: "work-1", machine: { instructionState: "failed" } })).toBe(true)
    expect(canContinueWork({ workId: "work-1", machine: { instructionState: "executing" } })).toBe(false)
    expect(canContinueWork({ workId: null, machine: { instructionState: "completed" } })).toBe(false)
  })
})
