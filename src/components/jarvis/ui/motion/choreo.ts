// C2.T1 — choreo.* variant/transition presets for the FLOW-05..12 catalog entries
// that aren't a direct instance of one of the five named primitives (Enter/Stagger/
// Ticker/Flight/Press). Each export is a framer-motion `variants` object consumed as
// `<motion.div variants={choreo.xxx} initial="initial" animate="animate">` — plain
// data, no components, so the Stage can list/label them without extra wrapper JSX
// per entry. Reduced-motion variants are the honest fallback named in the plan's own
// catalog line for each FLOW entry.

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
    animate: {
      scaleY: 1,
      transition: { duration: 0.9, ease: EASE.decelerate },
    },
  },
  reducedVariants: {
    initial: { scaleY: 1 },
    animate: { scaleY: 1, transition: { duration: 0 } },
  },
}

// FLOW-07 ValvePulse: 1.2s glow → accent (reduced: static accent, no pulse)
export const valvePulse: FlowChoreo = {
  variants: {
    initial: { opacity: 0.55 },
    animate: {
      opacity: [0.55, 1, 0.55],
      transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
    },
  },
  reducedVariants: {
    initial: { opacity: 0.85 },
    animate: { opacity: 0.85 },
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
    initial: { pathLength: 1, opacity: 1 },
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
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: DURATION.fast } },
  },
}

// FLOW-11 ShatterReject: clip-path fragments → slide-away (reduced)
export const shatterReject: FlowChoreo = {
  variants: {
    initial: { opacity: 1, scale: 1, rotate: 0 },
    animate: {
      opacity: 0,
      scale: 0.85,
      rotate: -4,
      transition: { duration: DURATION.slow, ease: EASE.accelerate },
    },
  },
  reducedVariants: {
    initial: { opacity: 1, x: 0 },
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
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: DURATION.fast } },
  },
}

export const choreo = { liquidFill, valvePulse, bypassUnfurl, stampApprove, shatterReject, deckFan }
