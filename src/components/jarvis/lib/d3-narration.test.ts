// jarvis-v3 P5.T7 — pure-function coverage for d3-narration.ts (BLOCKER B-1:
// the effect that calls this cannot itself be rendered in this environment).

import { describe, it, expect } from "vitest"
import { shouldFireD3Narration } from "./d3-narration"

describe("shouldFireD3Narration", () => {
  it("fires for a real executing thread that hasn't been narrated yet", () => {
    expect(shouldFireD3Narration("t1", "executing", null)).toBe(true)
  })

  it("never fires for a non-executing state", () => {
    expect(shouldFireD3Narration("t1", "awaiting_approval", null)).toBe(false)
    expect(shouldFireD3Narration("t1", "completed", null)).toBe(false)
    expect(shouldFireD3Narration("t1", "verifying", null)).toBe(false)
    expect(shouldFireD3Narration("t1", undefined, null)).toBe(false)
  })

  it("never fires twice for the SAME thread — once per thread, never a running commentary", () => {
    expect(shouldFireD3Narration("t1", "executing", "t1")).toBe(false)
  })

  it("fires again for a genuinely DIFFERENT thread that already narrated a prior one", () => {
    expect(shouldFireD3Narration("t2", "executing", "t1")).toBe(true)
  })

  it("never fires with no thread id at all", () => {
    expect(shouldFireD3Narration(undefined, "executing", null)).toBe(false)
  })
})
