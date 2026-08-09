import { describe, expect, it } from "vitest"
import { deriveSceneDirector, COMMAND_CANVAS_SCENES, type SceneDirectorProjection } from "./scene-director"
import type { LiveFrameProjection } from "./liveframe"

function liveframe(mode: LiveFrameProjection["mode"], focus: LiveFrameProjection["focus"]): LiveFrameProjection {
  return {
    mode,
    focus,
    presence: "dormant",
    energy: 0.12,
    activity: 0,
    voiceEnergy: 0,
    transportPosture: "healthy",
    activeActionIds: [],
    linkedRunIds: [],
    activeRunIds: [],
    activeStepIds: [],
    latestImpulse: null,
  }
}

const expected: Record<string, Partial<SceneDirectorProjection>> = {
  ready: { scene: "ready", dominant: "presence", orbPosition: "center", orbSize: "220-260", nowRail: "full", businessPulse: "full", thread: "rest", dock: "primary", focus: "presence", allowedAnimations: ["breathe"] },
  listening: { scene: "listening", dominant: "dock", orbPosition: "center", orbSize: "220-260", orbScale: 1.06, nowRail: "quiet", businessPulse: "quiet", thread: "listening", dock: "dominant", focus: "dock", allowedAnimations: ["listen"] },
  plan: { scene: "plan", dominant: "thread", orbPosition: "docked", orbSize: "72-96", nowRail: "context", businessPulse: "hidden", thread: "plan", dock: "secondary", focus: "thread", allowedAnimations: ["shift", "gather", "draw"] },
  approval: { scene: "approval", dominant: "approval", orbPosition: "docked", orbSize: "72-96", nowRail: "quiet", businessPulse: "hidden", thread: "approval", dock: "hidden", focus: "approval", allowedAnimations: ["clamp"] },
  working: { scene: "working", dominant: "weave", orbPosition: "sentinel", orbSize: "72-96", nowRail: "evidence", businessPulse: "hidden", thread: "weave", dock: "secondary", focus: "workflow", allowedAnimations: ["ignite", "advance"] },
  outcome: { scene: "outcome", dominant: "receipt", orbPosition: "sentinel", orbSize: "72-96", nowRail: "evidence", businessPulse: "hidden", thread: "outcome", dock: "secondary", focus: "receipt", allowedAnimations: ["settle"] },
  recovery: { scene: "recovery", dominant: "recovery", orbPosition: "sentinel", orbSize: "72-96", nowRail: "recovery", businessPulse: "hidden", thread: "recovery", dock: "recovery", focus: "recovery", allowedAnimations: ["fracture", "recover"] },
}

describe("scene-director", () => {
  it("exposes exactly the seven v6 Command Canvas scenes", () => {
    expect(COMMAND_CANVAS_SCENES).toEqual(["ready", "listening", "plan", "approval", "working", "outcome", "recovery"])
  })

  it.each([
    ["ready", liveframe("ready", "presence")],
    ["listening", liveframe("listening", "presence")],
    ["plan", liveframe("thinking", "thread")],
    ["approval", liveframe("decision", "approval")],
    ["working", liveframe("working", "workflow")],
    ["outcome", liveframe("verifying", "receipt")],
    ["outcome", liveframe("resolved", "receipt")],
    ["recovery", liveframe("fault", "recovery")],
  ] as const)("maps LIVEFRAME to %s without adding a lifecycle state", (name, current) => {
    expect(deriveSceneDirector(current)).toMatchObject(expected[name])
    expect(deriveSceneDirector(current).sourceMode).toBe(current.mode)
    expect(deriveSceneDirector(current).sourceFocus).toBe(current.focus)
  })

  it("keeps clarification in the plan scene and reserves approval for authority", () => {
    expect(deriveSceneDirector(liveframe("decision", "clarification"))).toMatchObject(expected.plan)
    expect(deriveSceneDirector(liveframe("decision", "approval"))).toMatchObject(expected.approval)
  })

  it("allows no ambient loop in scenes that are not Ready", () => {
    for (const current of [
      liveframe("listening", "presence"),
      liveframe("thinking", "thread"),
      liveframe("decision", "approval"),
      liveframe("working", "workflow"),
      liveframe("verifying", "receipt"),
      liveframe("fault", "recovery"),
    ]) {
      expect(deriveSceneDirector(current).allowedAnimations).not.toContain("breathe")
    }
  })
})
