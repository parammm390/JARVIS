// COMMAND CANVAS SCENE DIRECTOR — presentation only.
//
// This projection maps the existing LIVEFRAME output into the seven spatial
// scenes named by the v6 plan. It owns no timers, business transitions, data,
// or authority. The kernel remains the only source of lifecycle truth.

import type { LiveFrameFocus, LiveFrameMode, LiveFrameProjection } from "./liveframe"

export const COMMAND_CANVAS_SCENES = [
  "ready",
  "listening",
  "plan",
  "approval",
  "working",
  "outcome",
  "recovery",
] as const

export type CommandCanvasScene = (typeof COMMAND_CANVAS_SCENES)[number]
export type SceneDominant = "presence" | "dock" | "thread" | "approval" | "weave" | "receipt" | "recovery"
export type SceneOrbPosition = "center" | "docked" | "sentinel"
export type SceneOrbSize = "220-260" | "72-96"
export type SceneRailMode = "full" | "quiet" | "context" | "evidence" | "recovery"
export type ScenePulseMode = "full" | "quiet" | "hidden"
export type SceneThreadMode = "rest" | "listening" | "plan" | "approval" | "weave" | "outcome" | "recovery"
export type SceneDockMode = "primary" | "dominant" | "secondary" | "hidden" | "recovery"
export type SceneFocusTarget = "presence" | "dock" | "thread" | "approval" | "workflow" | "receipt" | "recovery"
export type SceneAnimation = "breathe" | "listen" | "shift" | "gather" | "draw" | "clamp" | "ignite" | "advance" | "settle" | "fracture" | "recover"

export interface SceneDirectorProjection {
  scene: CommandCanvasScene
  sourceMode: LiveFrameMode
  sourceFocus: LiveFrameFocus
  dominant: SceneDominant
  orbPosition: SceneOrbPosition
  orbSize: SceneOrbSize
  orbScale: 1 | 1.06
  nowRail: SceneRailMode
  businessPulse: ScenePulseMode
  thread: SceneThreadMode
  dock: SceneDockMode
  focus: SceneFocusTarget
  allowedAnimations: readonly SceneAnimation[]
}

type SceneTemplate = Omit<SceneDirectorProjection, "sourceMode" | "sourceFocus">

const READY: SceneTemplate = {
  scene: "ready",
  dominant: "presence",
  orbPosition: "center",
  orbSize: "220-260",
  orbScale: 1,
  nowRail: "full",
  businessPulse: "full",
  thread: "rest",
  dock: "primary",
  focus: "presence",
  allowedAnimations: ["breathe"],
}

const LISTENING: SceneTemplate = {
  scene: "listening",
  dominant: "dock",
  orbPosition: "center",
  orbSize: "220-260",
  orbScale: 1.06,
  nowRail: "quiet",
  businessPulse: "quiet",
  thread: "listening",
  dock: "dominant",
  focus: "dock",
  allowedAnimations: ["listen"],
}

const PLAN: SceneTemplate = {
  scene: "plan",
  dominant: "thread",
  orbPosition: "docked",
  orbSize: "72-96",
  orbScale: 1,
  nowRail: "context",
  businessPulse: "hidden",
  thread: "plan",
  dock: "secondary",
  focus: "thread",
  allowedAnimations: ["shift", "gather", "draw"],
}

const APPROVAL: SceneTemplate = {
  scene: "approval",
  dominant: "approval",
  orbPosition: "docked",
  orbSize: "72-96",
  orbScale: 1,
  nowRail: "quiet",
  businessPulse: "hidden",
  thread: "approval",
  dock: "hidden",
  focus: "approval",
  allowedAnimations: ["clamp"],
}

const WORKING: SceneTemplate = {
  scene: "working",
  dominant: "weave",
  orbPosition: "sentinel",
  orbSize: "72-96",
  orbScale: 1,
  nowRail: "evidence",
  businessPulse: "hidden",
  thread: "weave",
  dock: "secondary",
  focus: "workflow",
  allowedAnimations: ["ignite", "advance"],
}

const OUTCOME: SceneTemplate = {
  scene: "outcome",
  dominant: "receipt",
  orbPosition: "sentinel",
  orbSize: "72-96",
  orbScale: 1,
  nowRail: "evidence",
  businessPulse: "hidden",
  thread: "outcome",
  dock: "secondary",
  focus: "receipt",
  allowedAnimations: ["settle"],
}

const RECOVERY: SceneTemplate = {
  scene: "recovery",
  dominant: "recovery",
  orbPosition: "sentinel",
  orbSize: "72-96",
  orbScale: 1,
  nowRail: "recovery",
  businessPulse: "hidden",
  thread: "recovery",
  dock: "recovery",
  focus: "recovery",
  allowedAnimations: ["fracture", "recover"],
}

/** Derive the spatial scene from LIVEFRAME's existing priority result. */
export function deriveSceneDirector(liveframe: LiveFrameProjection): SceneDirectorProjection {
  let template: SceneTemplate
  switch (liveframe.mode) {
    case "ready":
      template = READY
      break
    case "listening":
      template = LISTENING
      break
    case "thinking":
      template = PLAN
      break
    case "decision":
      template = liveframe.focus === "clarification" ? PLAN : APPROVAL
      break
    case "working":
      template = WORKING
      break
    case "verifying":
    case "resolved":
      template = OUTCOME
      break
    case "fault":
      template = RECOVERY
      break
  }
  return {
    ...template,
    sourceMode: liveframe.mode,
    sourceFocus: liveframe.focus,
  }
}

