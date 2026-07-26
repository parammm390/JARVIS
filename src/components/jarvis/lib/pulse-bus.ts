"use client"

// F2.T1 — pulse-bus: ONE event stream every F2 orb/kinetics behavior subscribes to,
// layered over the EXISTING real sources (data-core.ts's typed `onJarvisEvent`
// emitter, itself fed by the fast/medium-lane diffs against real API responses, and
// ActivityTheater's own live-query arrivals — SSE-first via B1's gateway, honest
// polling fallback). No new transport, no polling of its own: this module only
// republishes what already fires, tagged with a coarse `PulseKind` so a component
// like OrbAuraRipple doesn't need to know data-core's six raw event names.
//
// Also hosts a tiny named-anchor registry (`registerAnchor`/`getAnchorRect`) — the
// real DOM positions EventMeteor (FLOW-39) and ConstellationLink (FLOW-49) draw
// between, since their source/target live in separate Bridge rail components (Orb3D
// in the left rail, ActivityTheater/ApprovalCockpit/PulseBar in the others) with no
// existing shared coordinate space. A component registers its own rect getter on
// mount and unregisters on unmount; nothing here owns layout, it only reads it.

import { onJarvisEvent, type JarvisEventType } from "./data-core"

export type PulseKind = "business-event" | "step" | "run" | "pending" | "decision" | "activity" | "poll"

export interface Pulse {
  kind: PulseKind
  at: number
  detail: unknown
}

type PulseListener = (pulse: Pulse) => void
const pulseListeners = new Set<PulseListener>()

const KIND_BY_EVENT: Record<JarvisEventType, PulseKind> = {
  "new-business-event": "business-event",
  "step-completed": "step",
  "run-completed": "run",
  "new-pending-action": "pending",
  "action-decided": "decision",
  "poll-landed": "poll",
}

function publish(kind: PulseKind, detail: unknown): void {
  const pulse: Pulse = { kind, at: Date.now(), detail }
  pulseListeners.forEach((cb) => cb(pulse))
}

let wired = false
/** data-core's emitter is module-level and already live the moment JarvisDataProvider
 *  mounts (Bridge.tsx wraps its whole tree in one) — wiring lazily on first
 *  subscriber, once, avoids double-subscribing across fast-refresh/remounts. */
function ensureWired(): void {
  if (wired) return
  wired = true
  for (const [event, kind] of Object.entries(KIND_BY_EVENT) as Array<[JarvisEventType, PulseKind]>) {
    onJarvisEvent(event, (detail) => publish(kind, detail))
  }
}

export function onPulse(cb: PulseListener): () => void {
  ensureWired()
  pulseListeners.add(cb)
  return () => {
    pulseListeners.delete(cb)
  }
}

/** ActivityTheater's own live-query arrivals (SSE frame or poll landing a genuinely
 *  new row) aren't a data-core event — separate hook, C1.T2 — so ActivityTheater
 *  calls this directly for each real new item id it renders for the first time. */
export function publishActivityArrival(itemId: string): void {
  publish("activity", itemId)
}

// ---------------------------------------------------------------------------
// Named anchor registry — real DOM rects, nothing fabricated. A rect getter
// returning null (unmounted, not yet laid out) is a legitimate "nothing to draw to"
// state for any consumer, never treated as an error.
// ---------------------------------------------------------------------------

type RectGetter = () => DOMRect | null
const anchors = new Map<string, RectGetter>()

export function registerAnchor(name: string, getRect: RectGetter): () => void {
  anchors.set(name, getRect)
  return () => {
    if (anchors.get(name) === getRect) anchors.delete(name)
  }
}

export function getAnchorRect(name: string): DOMRect | null {
  return anchors.get(name)?.() ?? null
}

// ---------------------------------------------------------------------------
// FLOW-49 ConstellationLink — which KPI is currently hovered, if any. A single
// current value (not a pulse) since it's a hover STATE, not a discrete event; the
// hand-authored KPI→source-panel map itself lives in ConstellationLink.tsx, next to
// the component that actually draws the lines, per the plan's own "documented
// in-file" instruction.
// ---------------------------------------------------------------------------
type HoverListener = (key: string | null) => void
const hoverListeners = new Set<HoverListener>()
let currentHover: string | null = null

export function setLineageHover(key: string | null): void {
  currentHover = key
  hoverListeners.forEach((cb) => cb(key))
}

export function onLineageHover(cb: HoverListener): () => void {
  hoverListeners.add(cb)
  cb(currentHover)
  return () => {
    hoverListeners.delete(cb)
  }
}

/** FLOW-39 EventMeteor's flight duration — shared so ActivityTheater's row-flash and
 *  ParticleField's meteor-draw stay on the same beat without a round-trip "landed"
 *  event (ActivityTheater already knows the moment it renders a new row; it just
 *  schedules its own flash this many ms later, matching the meteor's real travel
 *  time). Also FLOW-38 OrbAuraRipple's minimum throttle window. */
export const METEOR_FLIGHT_MS = 550
export const ORB_AURA_THROTTLE_MS = 3000
