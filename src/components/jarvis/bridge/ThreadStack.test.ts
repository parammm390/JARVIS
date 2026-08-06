// jarvis-v3 P5.T8 — pure-function coverage for ThreadStack.tsx's
// summarizeThreadOutcome (BLOCKER B-1: the components around it cannot be
// rendered in this environment).

import { describe, it, expect } from "vitest"
import { summarizeThreadOutcome } from "./ThreadStack"
import { shouldHandoffThreadFocus } from "./Thread"

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

describe("LF-18 Thread focus handoff", () => {
  it("moves focus when an interactive control would be hidden by a collapsing body", () => {
    expect(shouldHandoffThreadFocus({
      focusIsInteractive: true,
      focusIsInsideCollapsingBody: true,
      commandRailOwnsFocus: false,
      clarificationOwnsFocus: false,
    })).toBe(true)
  })

  it("preserves command-dock and clarification control focus", () => {
    expect(shouldHandoffThreadFocus({
      focusIsInteractive: true,
      focusIsInsideCollapsingBody: false,
      commandRailOwnsFocus: true,
      clarificationOwnsFocus: false,
    })).toBe(false)
    expect(shouldHandoffThreadFocus({
      focusIsInteractive: true,
      focusIsInsideCollapsingBody: false,
      commandRailOwnsFocus: false,
      clarificationOwnsFocus: true,
    })).toBe(false)
  })

  it("hands passive focus to the next active causal block", () => {
    expect(shouldHandoffThreadFocus({
      focusIsInteractive: false,
      focusIsInsideCollapsingBody: false,
      commandRailOwnsFocus: false,
      clarificationOwnsFocus: false,
    })).toBe(true)
  })
})
