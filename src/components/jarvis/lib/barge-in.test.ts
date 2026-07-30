// jarvis-v3 P5.T6 — pure-function coverage for barge-in.ts. BLOCKER B-1
// means `useVapiSession.tsx`'s own stateful hook (which uses this function on
// every real `local-volume-level` tick) cannot be rendered/tested directly in
// this environment (no jsdom) — this is the one genuinely pure piece of the
// barge-in decision, and the only part directly unit-testable here. The real,
// live ≤200ms Orb-reaction measurement itself needs an actual microphone,
// which this environment does not have (established P2/P3) — left honestly
// unchecked in the exit gate, not simulated.

import { describe, it, expect } from "vitest"
import { isRealMicActivity, MIC_ACTIVITY_THRESHOLD } from "./barge-in"

describe("isRealMicActivity", () => {
  it("is false at and below the real threshold — silence/noise floor never counts as speech", () => {
    expect(isRealMicActivity(0)).toBe(false)
    expect(isRealMicActivity(MIC_ACTIVITY_THRESHOLD)).toBe(false)
  })

  it("is true just above the real threshold", () => {
    expect(isRealMicActivity(MIC_ACTIVITY_THRESHOLD + 0.001)).toBe(true)
  })

  it("is true for a real, clearly-speaking amplitude", () => {
    expect(isRealMicActivity(0.4)).toBe(true)
  })

  it("treats a negative or NaN reading as not real activity — never a false barge-in from bad data", () => {
    expect(isRealMicActivity(-1)).toBe(false)
    expect(isRealMicActivity(NaN)).toBe(false)
  })
})
