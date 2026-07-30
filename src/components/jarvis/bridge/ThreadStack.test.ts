// jarvis-v3 P5.T8 — pure-function coverage for ThreadStack.tsx's
// summarizeThreadOutcome (BLOCKER B-1: the components around it cannot be
// rendered in this environment).

import { describe, it, expect } from "vitest"
import { summarizeThreadOutcome } from "./ThreadStack"

describe("summarizeThreadOutcome", () => {
  it("real terminal states get their own honest label", () => {
    expect(summarizeThreadOutcome("completed")).toBe("Done")
    expect(summarizeThreadOutcome("partial")).toBe("Partial")
    expect(summarizeThreadOutcome("failed")).toBe("Failed")
    expect(summarizeThreadOutcome("cancelled")).toBe("Cancelled")
  })

  it("never claims 'Done' for a thread superseded mid-flight — every non-terminal state reads honestly as left in progress", () => {
    expect(summarizeThreadOutcome("captured")).toBe("Left in progress")
    expect(summarizeThreadOutcome("understanding")).toBe("Left in progress")
    expect(summarizeThreadOutcome("planning")).toBe("Left in progress")
    expect(summarizeThreadOutcome("clarifying")).toBe("Left in progress")
    expect(summarizeThreadOutcome("awaiting_approval")).toBe("Left in progress")
    expect(summarizeThreadOutcome("executing")).toBe("Left in progress")
    expect(summarizeThreadOutcome("verifying")).toBe("Left in progress")
  })
})
