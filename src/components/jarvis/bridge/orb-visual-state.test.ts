import { describe, expect, it } from "vitest"
import { deriveOrbVisualState, ORB_VISUAL_STATES } from "./orb-visual-state"
import type { OrbVisualStateInput } from "./orb-visual-state"

const base = (): OrbVisualStateInput => ({
  transport: "live",
  presence: "dormant",
  liveFrame: {
    mode: "ready",
    focus: "presence",
    presence: "dormant",
    energy: 0,
    activity: 0,
    voiceEnergy: 0,
    transportPosture: "healthy",
    activeActionIds: [],
    linkedRunIds: [],
    activeRunIds: [],
    activeStepIds: [],
    latestImpulse: null,
  },
})

describe("deriveOrbVisualState", () => {
  it("reaches every exact visual state", () => {
    const cases: OrbVisualStateInput[] = [
      base(),
      { ...base(), presence: "listening", liveFrame: { ...base().liveFrame, mode: "listening" } },
      { ...base(), instructionState: "captured" },
      { ...base(), instructionState: "planning" },
      { ...base(), answerResult: {} },
      { ...base(), instructionState: "awaiting_approval" },
      { ...base(), instructionId: "i", actions: [{ id: "a", instructionId: "i", status: "blocked_integration_unavailable" }] },
      { ...base(), instructionId: "i", actions: [{ id: "a", instructionId: "i", status: "needs_human_review" }] },
      { ...base(), instructionState: "executing" },
      { ...base(), instructionState: "verifying" },
      { ...base(), instructionState: "failed" },
      { ...base(), instructionState: "cancelled" },
    ]
    expect(new Set(cases.map(deriveOrbVisualState))).toEqual(new Set(ORB_VISUAL_STATES))
  })

  it("does not correlate an unrelated action", () => expect(deriveOrbVisualState({
    ...base(),
    instructionId: "mine",
    actions: [{ id: "other", instructionId: "other", status: "needs_human_review" }],
  })).toBe("idle"))

  it("correlates a current action id even when the row omits instructionId", () => expect(deriveOrbVisualState({
    ...base(),
    instructionId: "mine",
    instructionState: "awaiting_approval",
    currentActionIds: ["current-action"],
    actions: [{ id: "current-action", status: "needs_human_review" }],
  })).toBe("needs-human-review"))

  it("maps understanding to acknowledgement and planning to thinking", () => {
    expect(deriveOrbVisualState({ ...base(), instructionState: "understanding" })).toBe("acknowledged")
    expect(deriveOrbVisualState({ ...base(), instructionState: "planning" })).toBe("thinking")
    expect(deriveOrbVisualState({ ...base(), presence: "hearing" })).toBe("listening")
  })

  it("honors the required precedence", () => {
    expect(deriveOrbVisualState({ ...base(), transport: "offline", answerResult: {}, instructionState: "executing" })).toBe("cancelled-stale")
    expect(deriveOrbVisualState({ ...base(), answerResult: {}, instructionState: "executing" })).toBe("answer-ready")
    expect(deriveOrbVisualState({
      ...base(),
      instructionId: "mine",
      instructionState: "awaiting_approval",
      actions: [{ id: "a", instructionId: "mine", status: "needs_human_review" }, { id: "b", instructionId: "mine", status: "blocked_integration_unavailable" }],
    })).toBe("needs-human-review")
    expect(deriveOrbVisualState({ ...base(), instructionState: "executing", liveFrame: { ...base().liveFrame, mode: "verifying" } })).toBe("executing")
  })
})
