// jarvis-v3 P4.T3 — M16 TruthReveal's two pure variant-generators. Same
// pure-function-over-explicit-input pattern as every other kernel test (BLOCKER
// B-1: no jsdom/@testing-library/dom authorized, so nothing here renders).

import { describe, it, expect } from "vitest"
import {
  faultShakeVariants,
  fieldWarmExitVariants,
  P4_PROMOTED_MOTIONS,
  P7_PROMOTED_MOTIONS,
  MOTION_SPECS,
  relightVariants,
  transcriptInkVariants,
  TRANSCRIPT_FINAL_LOCK_MS,
  TRANSCRIPT_PARTIAL_CROSSFADE_MS,
  contextConstellationChipVariants,
  contextConstellationFlightVariants,
  CONTEXT_CONSTELLATION_DURATION_MS,
  CONTEXT_CONSTELLATION_STAGGER_MS,
  PLAN_DRAW_EDGE_DURATION_MS,
  PLAN_DRAW_NODE_DURATION_MS,
  SPATIAL_CONTINUITY_DURATION_MS,
  spatialContinuityTransition,
  threadBodyVariants,
  threadLayoutTransition,
  intentLaunchVariants,
  INTENT_LAUNCH_DURATION_MS,
  planDrawEdgeVariants,
  planDrawNodeVariants,
  QUESTION_FOCUS_DIM_OPACITY,
  QUESTION_FOCUS_DURATION_MS,
  QUESTION_FOCUS_RISE_PX,
  questionFocusLayerVariants,
  questionFocusQuestionVariants,
  railCommitVariants,
  truthRevealActualVariants,
  truthRevealRowPulse,
  blastRadiusDotVariants,
  cockpitRiseVariants,
  gateRiseVariants,
  LF08_GATE_RISE_MS,
  receiptSealVariants,
  threadBirthVariants,
} from "./choreography"

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

describe("LF-08 Gate Rise", () => {
  it("uses the 280ms rise and does not replay on restore", () => {
    const fresh = gateRiseVariants(false, false)
    const restored = gateRiseVariants(false, true)
    expect(fresh.transition).toMatchObject({ duration: LF08_GATE_RISE_MS / 1000 })
    expect(fresh.initial).toEqual({ opacity: 0, y: 16 })
    expect(restored.initial).toEqual({ opacity: 1, y: 0 })
    expect(restored.transition).toEqual({ duration: 0 })
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

describe("LF-03 transcript ink", () => {
  it("cross-fades each partial replacement in 90ms and locks the final in 180ms", () => {
    const partial = transcriptInkVariants("partial", false)
    const final = transcriptInkVariants("final", false)

    expect(partial.animate.transition).toEqual({ duration: TRANSCRIPT_PARTIAL_CROSSFADE_MS / 1000, ease: [0.65, 0, 0.35, 1] })
    expect(partial.exit.transition).toEqual({ duration: TRANSCRIPT_PARTIAL_CROSSFADE_MS / 1000, ease: [0.65, 0, 0.35, 1] })
    expect(final.animate.transition).toEqual({ duration: TRANSCRIPT_FINAL_LOCK_MS / 1000, ease: [0.65, 0, 0.35, 1] })
    expect(final.animate.fontWeight).toBe(600)
  })

  it("reduced motion replaces immediately and still changes final weight", () => {
    const partial = transcriptInkVariants("partial", true)
    const final = transcriptInkVariants("final", true)

    expect(partial.initial).toEqual({ opacity: 1, fontWeight: 400 })
    expect(partial.animate.transition).toEqual({ duration: 0 })
    expect(partial.exit.transition).toEqual({ duration: 0 })
    expect(final.initial).toEqual({ opacity: 1, fontWeight: 600 })
    expect(final.animate.fontWeight).toBe(600)
    expect(final.animate.transition).toEqual({ duration: 0 })
  })
})

describe("LF-04 intent launch", () => {
  it("travels from Dock to Heard over the exact 260ms launch duration", () => {
    const full = intentLaunchVariants(false)
    expect(full.initial).toEqual({ opacity: 0, scale: 0.72 })
    expect(full.animate).toEqual({ opacity: [0, 1, 0.82, 0], scale: [0.72, 1.12, 0.9, 0.35] })
    expect(full.transition).toEqual({ duration: INTENT_LAUNCH_DURATION_MS / 1000, ease: [0.22, 1, 0.36, 1] })
  })

  it("reduced motion keeps the accepted state solid and instantaneous", () => {
    const reduced = intentLaunchVariants(true)
    expect(reduced.initial).toEqual({ opacity: 1, scale: 1 })
    expect(reduced.animate).toEqual({ opacity: 1, scale: 1 })
    expect(reduced.transition).toEqual({ duration: 0 })
  })
})

describe("LF-05 context constellation", () => {
  it("uses a 220ms chip settle with no more than a 45ms batch stagger", () => {
    const chip = contextConstellationChipVariants(2, false, true)
    expect(chip.initial).toEqual({ opacity: 0, y: 8, scale: 0.96 })
    expect(chip.animate).toEqual({ opacity: 1, y: 0, scale: 1 })
    expect(chip.transition).toEqual({
      duration: CONTEXT_CONSTELLATION_DURATION_MS / 1000,
      ease: [0.22, 1, 0.36, 1],
      delay: (2 * CONTEXT_CONSTELLATION_STAGGER_MS) / 1000,
    })

    const flight = contextConstellationFlightVariants(1, false)
    expect(flight.transition).toEqual({
      duration: CONTEXT_CONSTELLATION_DURATION_MS / 1000,
      ease: [0.22, 1, 0.36, 1],
      delay: CONTEXT_CONSTELLATION_STAGGER_MS / 1000,
    })
  })

  it("reduced motion shows the same source fact without travel or delay", () => {
    expect(contextConstellationChipVariants(3, true, true)).toMatchObject({
      initial: { opacity: 1, y: 0, scale: 1 },
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0 },
    })
    expect(contextConstellationFlightVariants(3, true)).toMatchObject({
      initial: { opacity: 1, scale: 1 },
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0 },
    })
  })
})

describe("LF-06 plan draw", () => {
  it("resolves a newly observed node in 160ms and its real dependency edge in 240ms without batch delay", () => {
    const node = planDrawNodeVariants(false, true)
    const edge = planDrawEdgeVariants(false, true)

    expect(node.initial).toEqual({ opacity: 0, scale: 0.96, borderColor: "rgba(255,255,255,0.08)" })
    expect(node.animate).toEqual({ opacity: 1, scale: 1, borderColor: "rgba(103,232,249,0.34)" })
    expect(node.transition).toEqual({ duration: PLAN_DRAW_NODE_DURATION_MS / 1000, ease: [0.22, 1, 0.36, 1] })
    expect(edge.transition).toEqual({ duration: PLAN_DRAW_EDGE_DURATION_MS / 1000, ease: [0.65, 0, 0.35, 1] })
    expect(edge.transition).not.toHaveProperty("delay")
  })

  it("treats initial/restore nodes and edges as settled, and reduced motion stays complete", () => {
    const initialNode = planDrawNodeVariants(false, false)
    const reducedNode = planDrawNodeVariants(true, true)
    const initialEdge = planDrawEdgeVariants(false, false)
    const reducedEdge = planDrawEdgeVariants(true, true)

    expect(initialNode.initial).toEqual(initialNode.animate)
    expect(initialNode.transition).toEqual({ duration: 0 })
    expect(reducedNode.initial).toEqual(reducedNode.animate)
    expect(reducedNode.transition).toEqual({ duration: 0 })
    expect(initialEdge.initial).toEqual(initialEdge.animate)
    expect(initialEdge.transition).toEqual({ duration: 0 })
    expect(reducedEdge.initial).toEqual(reducedEdge.animate)
    expect(reducedEdge.transition).toEqual({ duration: 0 })
  })
})

describe("LF-07 question focus", () => {
  it("dims unrelated depth to 42% over 220ms and raises the real question by 8px", () => {
    const layer = questionFocusLayerVariants(false, true)
    const question = questionFocusQuestionVariants(false, true)

    expect(layer.animate).toEqual({ opacity: QUESTION_FOCUS_DIM_OPACITY })
    expect(layer.transition).toEqual({ duration: QUESTION_FOCUS_DURATION_MS / 1000, ease: [0.65, 0, 0.35, 1] })
    expect(question.initial).toEqual({ opacity: 1, y: QUESTION_FOCUS_RISE_PX })
    expect(question.animate).toEqual({ opacity: 1, y: 0 })
    expect(question.transition).toEqual({ duration: QUESTION_FOCUS_DURATION_MS / 1000, ease: [0.22, 1, 0.36, 1] })
  })

  it("reduced motion reaches the same dim/focused state instantly", () => {
    const layer = questionFocusLayerVariants(true, true)
    const question = questionFocusQuestionVariants(true, true)

    expect(layer.transition).toEqual({ duration: 0 })
    expect(layer.animate).toEqual({ opacity: QUESTION_FOCUS_DIM_OPACITY })
    expect(question.initial).toEqual({ opacity: 1, y: 0 })
    expect(question.animate).toEqual({ opacity: 1, y: 0 })
    expect(question.transition).toEqual({ duration: 0 })
  })
})

describe("LF-18 spatial continuity", () => {
  it("uses one 320ms FLIP/layout cadence for Thread block transitions", () => {
    const transition = spatialContinuityTransition(false)
    expect(SPATIAL_CONTINUITY_DURATION_MS).toBe(320)
    expect(transition).toEqual({ duration: 0.32, ease: [0.22, 1, 0.36, 1] })
    expect(threadLayoutTransition(false)).toEqual(transition)

    const body = threadBodyVariants(false)
    expect(body.expanded).toMatchObject({ height: "auto", opacity: 1, transition })
    expect(body.collapsed).toMatchObject({ height: 0, opacity: 0, transition })
  })

  it("reduced motion preserves the mounted end states without a layout tween", () => {
    const transition = { duration: 0 }
    expect(spatialContinuityTransition(true)).toEqual(transition)
    expect(threadLayoutTransition(true)).toEqual(transition)
    const body = threadBodyVariants(true)
    expect(body.expanded).toMatchObject({ height: "auto", opacity: 1, transition })
    expect(body.collapsed).toMatchObject({ height: 0, opacity: 0, transition })
  })
})

describe("P3.T7 restored one-shot motion", () => {
  it("renders restored ThreadBirth, CockpitRise, ReceiptSeal, and BlastRadius at their settled states", () => {
    const birth = threadBirthVariants(false, true)
    const cockpit = cockpitRiseVariants(false, true)
    const receipt = receiptSealVariants(false, true)
    const dot = blastRadiusDotVariants(3, false, true)

    expect(birth.initial).toEqual(birth.animate)
    expect(birth.transition).toEqual({ duration: 0 })
    expect(cockpit.initial).toEqual(cockpit.animate)
    expect(cockpit.transition).toEqual({ duration: 0 })
    expect(receipt.initial).toEqual(receipt.animate)
    expect(receipt.transition).toEqual({ duration: 0 })
    expect(dot.initial).toEqual(dot.animate)
    expect(dot.transition).toEqual({ duration: 0 })
  })

  it("keeps the existing one-shot entry variants for genuinely new presentation edges", () => {
    expect(threadBirthVariants(false, false).initial).not.toEqual(threadBirthVariants(false, false).animate)
    expect(cockpitRiseVariants(false, false).initial).not.toEqual(cockpitRiseVariants(false, false).animate)
    expect(receiptSealVariants(false, false).initial).not.toEqual(receiptSealVariants(false, false).animate)
    expect(blastRadiusDotVariants(3, false, false).initial).not.toEqual(blastRadiusDotVariants(3, false, false).animate)
  })
})

describe("M1 rail commit", () => {
  it("keeps the full commit cadence when motion is allowed", () => {
    expect(railCommitVariants(false).transition).toEqual({ duration: MOTION_SPECS.M1.durationMs / 1000, ease: MOTION_SPECS.M1.easing })
  })

  it("settles the accepted border instantly under reduced motion", () => {
    expect(railCommitVariants(true).transition).toEqual({ duration: 0 })
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

describe("P7 event cues", () => {
  it("promotes the real fault and relight bindings alongside the existing rewind edge", () => {
    expect(P7_PROMOTED_MOTIONS).toEqual(["M13", "M14", "M18"])
  })

  it("uses M14's one-shot shake and keeps the red settled cue for reduced motion", () => {
    const full = faultShakeVariants(false)
    expect(full.animate.x).toEqual([0, -4, 4, -3, 3, 0])
    expect(full.animate.transition).toEqual({ duration: MOTION_SPECS.M14.durationMs / 1000, ease: MOTION_SPECS.M14.easing })
    expect(faultShakeVariants(true).animate).toEqual({ x: 0, opacity: 1, transition: { duration: 0 } })
  })

  it("clears the relight overlay instantly when reduced motion is requested", () => {
    const full = relightVariants(false)
    expect(full.initial).toEqual({ x: "-100%", opacity: 0 })
    expect(full.animate.transition).toEqual({ duration: MOTION_SPECS.M18.durationMs / 1000, ease: MOTION_SPECS.M18.easing })
    expect(relightVariants(true).animate).toEqual({ x: 0, opacity: 0, transition: { duration: 0 } })
  })
})
