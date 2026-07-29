// jarvis-v3 P4.T3 — M16 TruthReveal's two pure variant-generators. Same
// pure-function-over-explicit-input pattern as every other kernel test (BLOCKER
// B-1: no jsdom/@testing-library/dom authorized, so nothing here renders).

import { describe, it, expect } from "vitest"
import { truthRevealActualVariants, truthRevealRowPulse, fieldWarmExitVariants, P4_PROMOTED_MOTIONS, MOTION_SPECS } from "./choreography"

describe("truthRevealActualVariants", () => {
  it("slides in from x:12px over M16's own 320ms/EASE_OUT spec", () => {
    const v = truthRevealActualVariants(false)
    expect(v.initial).toEqual({ opacity: 0, x: 12 })
    expect(v.animate).toEqual({ opacity: 1, x: 0 })
    expect(v.transition).toEqual({ duration: MOTION_SPECS.M16.durationMs / 1000, ease: MOTION_SPECS.M16.easing })
  })

  it("reduced motion: no slide, renders at the settled state instantly (§5.3 M16 reduced equivalent)", () => {
    const v = truthRevealActualVariants(true)
    expect(v.initial).toEqual({ opacity: 1 })
    expect(v.transition).toEqual({ duration: 0 })
  })
})

describe("truthRevealRowPulse", () => {
  it("a matched row pulses green once, then settles fully transparent", () => {
    const p = truthRevealRowPulse(true, false)
    expect(p.initial).toEqual({ backgroundColor: "rgba(52,211,153,0.22)" })
    expect(p.animate).toEqual({ backgroundColor: "rgba(52,211,153,0)" })
    expect(p.transition).toEqual({ duration: 0.14, ease: "easeOut" })
  })

  it("a differing row pulses amber, then settles to a lasting amber wash (\"stay outlined\")", () => {
    const p = truthRevealRowPulse(false, false)
    expect(p.initial).toEqual({ backgroundColor: "rgba(245,185,66,0.22)" })
    expect(p.animate).toEqual({ backgroundColor: "rgba(245,185,66,0.08)" })
  })

  it("reduced motion: renders directly at the settled state, no pulse, for both outcomes", () => {
    const matched = truthRevealRowPulse(true, true)
    const differing = truthRevealRowPulse(false, true)
    expect(matched.initial).toEqual(matched.animate)
    expect(matched.transition).toEqual({ duration: 0 })
    expect(differing.initial).toEqual(differing.animate)
    expect(differing.animate).toEqual({ backgroundColor: "rgba(245,185,66,0.08)" })
  })
})

describe("P4_PROMOTED_MOTIONS", () => {
  it("promotes M16 (ThreadVerification) and M17 (Field cools on a real payment), per plan v3 §8 PHASE 4's own consequence graph", () => {
    expect(P4_PROMOTED_MOTIONS).toEqual(["M16", "M17"])
  })
})

describe("fieldWarmExitVariants", () => {
  it("fades a departing Field point over M17's own 900ms/EASE_IO spec", () => {
    const v = fieldWarmExitVariants(false)
    expect(v.exit).toEqual({ opacity: 0, transition: { duration: MOTION_SPECS.M17.durationMs / 1000, ease: MOTION_SPECS.M17.easing } })
  })
  it("reduced motion: no fade — points simply re-render at their new positions", () => {
    expect(fieldWarmExitVariants(true).exit).toEqual({ opacity: 0, transition: { duration: 0 } })
  })
})
