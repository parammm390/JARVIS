// C2.T1/T2 — choreo.* variant/transition presets for FLOW entries that aren't a
// direct instance of one of the five named primitives (Enter/Stagger/Ticker/Flight/
// Press). Each export is a framer-motion `variants` object consumed as
// `<motion.div variants={choreo.xxx} initial="initial" animate="animate">` — plain
// data, no components, so the Stage can list/label them without extra wrapper JSX
// per entry. Reduced-motion variants are the honest fallback named in the plan's own
// catalog line for each FLOW entry.
//
// SSR-safety rule (found + fixed during C2.T2's reduced-motion verification pass,
// reproduced via Playwright's emulateMedia): `variants.initial` and
// `reducedVariants.initial` must always be IDENTICAL. framer-motion's
// useReducedMotion() resolves to `null` during SSR (no window) and synchronously to
// the real boolean on the client's first render — so a real user with OS-level
// reduced-motion on gets a client `initial` that differs from what SSR produced,
// which is a genuine React hydration-mismatch error, not a cosmetic one. SSR only
// ever serializes `initial` as inline style; `animate`/`transition` are applied
// post-mount and are safe to branch on `reduced`. Every preset below intentionally
// keeps `initial` constant and reaches its reduced end-state via a `duration: 0`
// (or same-tick) `animate` snap instead.

import type { Variants } from "framer-motion"
import { DURATION, EASE } from "./tokens"

interface FlowChoreo {
  variants: Variants
  reducedVariants: Variants
}

// FLOW-05 LiquidFill: vessel + meniscus wobble → bar (reduced)
export const liquidFill: FlowChoreo = {
  variants: {
    initial: { scaleY: 0, originY: 1 },
    animate: { scaleY: 1, transition: { duration: 0.9, ease: EASE.decelerate } },
  },
  reducedVariants: {
    initial: { scaleY: 0, originY: 1 },
    animate: { scaleY: 1, transition: { duration: 0 } },
  },
}

// FLOW-07 ValvePulse: 1.2s glow → accent (reduced: static accent, no pulse)
export const valvePulse: FlowChoreo = {
  variants: {
    initial: { opacity: 0.55 },
    animate: { opacity: [0.55, 1, 0.55], transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" } },
  },
  reducedVariants: {
    initial: { opacity: 0.55 },
    animate: { opacity: 0.85, transition: { duration: 0 } },
  },
}

// FLOW-09 BypassUnfurl: path self-draws 400ms → appears (reduced: instant appear).
// Consumed on an <svg><motion.path variants={choreo.bypassUnfurl.variants}
// pathLength={...}> — pathLength is animated by the caller since it needs the
// actual path element, not this generic opacity/scale variant.
export const bypassUnfurl: FlowChoreo = {
  variants: {
    initial: { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1, transition: { duration: DURATION.slow, ease: EASE.standard } },
  },
  reducedVariants: {
    initial: { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1, transition: { duration: 0 } },
  },
}

// FLOW-10 StampApprove: scale 1.4→1 + 2px/80ms shake + ink → color (reduced)
export const stampApprove: FlowChoreo = {
  variants: {
    initial: { scale: 1.4, opacity: 0 },
    animate: {
      scale: [1.4, 0.98, 1.02, 1],
      x: [0, -2, 2, 0],
      opacity: 1,
      transition: { duration: 0.32, times: [0, 0.5, 0.75, 1], ease: EASE.overshoot },
    },
  },
  reducedVariants: {
    initial: { scale: 1.4, opacity: 0 },
    animate: { scale: 1, opacity: 1, transition: { duration: 0 } },
  },
}

// FLOW-11 ShatterReject: clip-path fragments → slide-away (reduced)
export const shatterReject: FlowChoreo = {
  variants: {
    initial: { opacity: 1, scale: 1, rotate: 0, x: 0 },
    animate: { opacity: 0, scale: 0.85, rotate: -4, transition: { duration: DURATION.slow, ease: EASE.accelerate } },
  },
  reducedVariants: {
    initial: { opacity: 1, scale: 1, rotate: 0, x: 0 },
    animate: { opacity: 0, x: -24, transition: { duration: DURATION.fast } },
  },
}

// FLOW-12 DeckFan: stack→fan → list (reduced). Per-card rotation/offset computed by
// the caller (index-dependent), this supplies the shared transition only.
export const deckFan: FlowChoreo = {
  variants: {
    initial: { scale: 0.94, opacity: 0 },
    animate: { scale: 1, opacity: 1, transition: { duration: DURATION.base, ease: EASE.decelerate } },
  },
  reducedVariants: {
    initial: { scale: 0.94, opacity: 0 },
    animate: { scale: 1, opacity: 1, transition: { duration: DURATION.fast } },
  },
}

// FLOW-15 CameraPan: scale .98 + slide + fade 400ms → crossfade (reduced)
export const cameraPan: FlowChoreo = {
  variants: {
    initial: { opacity: 0, scale: 0.98, x: 16 },
    animate: { opacity: 1, scale: 1, x: 0, transition: { duration: DURATION.slow, ease: EASE.standard } },
  },
  reducedVariants: {
    initial: { opacity: 0, scale: 0.98, x: 16 },
    animate: { opacity: 1, scale: 1, x: 0, transition: { duration: DURATION.base } },
  },
}

// FLOW-19 RadarSweep: waves under cap → count (reduced: static count, no waves).
// Consumed by rendering N staggered copies of this variant as expanding rings.
export const radarSweep: FlowChoreo = {
  variants: {
    initial: { scale: 0.3, opacity: 0.6 },
    animate: { scale: 1.8, opacity: 0, transition: { duration: 1.8, repeat: Infinity, ease: EASE.decelerate } },
  },
  reducedVariants: {
    initial: { scale: 0.3, opacity: 0.6 },
    animate: { scale: 0.3, opacity: 0, transition: { duration: 0 } },
  },
}

// FLOW-20 DrawSpark: 500ms self-draw → drawn (reduced: shown fully drawn)
export const drawSpark: FlowChoreo = {
  variants: {
    initial: { pathLength: 0, opacity: 0.4 },
    animate: { pathLength: 1, opacity: 1, transition: { duration: 0.5, ease: EASE.standard } },
  },
  reducedVariants: {
    initial: { pathLength: 0, opacity: 0.4 },
    animate: { pathLength: 1, opacity: 1, transition: { duration: 0 } },
  },
}

// FLOW-21 RouteDraw: polyline + marker glide → shown (reduced: shown static, no glide)
export const routeDraw: FlowChoreo = {
  variants: {
    initial: { pathLength: 0 },
    animate: { pathLength: 1, transition: { duration: 1.1, ease: EASE.standard } },
  },
  reducedVariants: {
    initial: { pathLength: 0 },
    animate: { pathLength: 1, transition: { duration: 0 } },
  },
}

// FLOW-22 PinAura: pulse → colored pin (reduced: static colored pin, no pulse).
// Distinct name from valvePulse even though the shape rhymes — separate FLOW ids
// with separate honesty labels/consumers (map pins vs. workflow valves).
export const pinAura: FlowChoreo = {
  variants: {
    initial: { scale: 1, opacity: 0.5 },
    animate: { scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5], transition: { duration: 1.6, repeat: Infinity, ease: EASE.decelerate } },
  },
  reducedVariants: {
    initial: { scale: 1, opacity: 0.5 },
    animate: { scale: 1, opacity: 0, transition: { duration: 0 } },
  },
}

// FLOW-24 ThemeTide: 2s crossfade → step (reduced: instant step, no crossfade)
export const themeTide: FlowChoreo = {
  variants: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 2, ease: "linear" } },
  },
  reducedVariants: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0 } },
  },
}

// FLOW-25 ShakeDeny: 4px/200ms → outline flash (reduced: outline flash only, no shake)
export const shakeDeny: FlowChoreo = {
  variants: {
    initial: { x: 0 },
    animate: { x: [0, -4, 4, -4, 4, 0], transition: { duration: 0.2 } },
  },
  reducedVariants: {
    initial: { x: 0 },
    animate: { x: 0, transition: { duration: 0 } },
  },
}

export const choreo = {
  liquidFill,
  valvePulse,
  bypassUnfurl,
  stampApprove,
  shatterReject,
  deckFan,
  cameraPan,
  radarSweep,
  drawSpark,
  routeDraw,
  pinAura,
  themeTide,
  shakeDeny,
}
