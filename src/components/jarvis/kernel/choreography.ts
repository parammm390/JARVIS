// JARVIS kernel — motion choreography (plan v3 §5.3). Motion constants live here
// as data, never inline in a component (P1's own architecture decision, carried
// forward). This module is the ONE place the 18-motion vocabulary is defined;
// `docs/motion-promoted.md` (P7.T8) records which are promoted vs. catalog-only.
//
// P2.T13 wires exactly 11 of the 18 into real components: M1 M2 M3 M5 M6 M7 M9
// M10 M11 M12 M15. M4 (ContextGather) needs real per-event context arrival, M8
// (BlastRadius) needs a real recipient count beyond the golden journey's single
// invoice-count case, and M13/M14/M16/M17/M18 belong to P3/P4/P5/P7 per the plan's
// own phase assignments — none of the 18 is invented here, all 18 specs exist so
// later phases wire the rest from the SAME table rather than re-deriving values.

export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_SPRING = [0.34, 1.56, 0.64, 1] as const
export const EASE_IO = [0.65, 0, 0.35, 1] as const

export type MotionId =
  | "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9" | "M10"
  | "M11" | "M12" | "M13" | "M14" | "M15" | "M16" | "M17" | "M18"

export interface MotionSpec {
  name: string
  firesOn: string
  durationMs: number
  easing: readonly number[] | "spring"
  /** What the same information looks like under prefers-reduced-motion (§5.3's
   *  own binding rule: reduced motion never loses information). */
  reducedMotionEquivalent: string
}

/** The complete 18-motion vocabulary, §5.3 verbatim. Nothing outside this table
 *  may ship (hard rule 5) — a component reaching for an animation not listed here
 *  is off-plan. */
export const MOTION_SPECS: Record<MotionId, MotionSpec> = {
  M1: { name: "RailCommit", firesOn: "final transcript / Enter", durationMs: 320, easing: EASE_OUT, reducedMotionEquivalent: "border goes solid cyan instantly" },
  M2: { name: "ThreadBirth", firesOn: "captured", durationMs: 420, easing: EASE_OUT, reducedMotionEquivalent: "block appears, no transform" },
  M3: { name: "EchoResolve", firesOn: "ACK", durationMs: 520, easing: EASE_OUT, reducedMotionEquivalent: "plain text, no scramble" },
  M4: { name: "ContextGather", firesOn: "understanding", durationMs: 380, easing: EASE_OUT, reducedMotionEquivalent: "chips fade in, staggered 60 ms" },
  M5: { name: "PlanDraw", firesOn: "each action_created", durationMs: 340, easing: EASE_SPRING, reducedMotionEquivalent: "node + solid edge appear" },
  M6: { name: "PolicyClamp", firesOn: "plan requires approval", durationMs: 300, easing: EASE_IO, reducedMotionEquivalent: "static amber left border" },
  M7: { name: "CockpitRise", firesOn: "awaiting_approval", durationMs: 380, easing: EASE_OUT, reducedMotionEquivalent: "panel appears; backdrop dims instantly" },
  M8: { name: "BlastRadius", firesOn: "cockpit opens for a multi-entity action", durationMs: 520, easing: EASE_OUT, reducedMotionEquivalent: "number renders final; dots static" },
  M9: { name: "StampApprove", firesOn: "approve accepted", durationMs: 240, easing: EASE_SPRING, reducedMotionEquivalent: "green 'Approved' chip appears" },
  M10: { name: "ShatterReject", firesOn: "reject accepted", durationMs: 280, easing: EASE_IO, reducedMotionEquivalent: "card fades out 160 ms" },
  M11: { name: "LiquidFill", firesOn: "step leased", durationMs: 0, easing: EASE_IO, reducedMotionEquivalent: "determinate bar + 'step 2 of 3' text" },
  M12: { name: "StepSpark", firesOn: "step completed", durationMs: 300, easing: EASE_IO, reducedMotionEquivalent: "edge and ring go solid green" },
  M13: { name: "DrainBack", firesOn: "run compensating", durationMs: 0, easing: EASE_IO, reducedMotionEquivalent: "amber bar + 'Rolling back'" },
  M14: { name: "FaultShake", firesOn: "step failed", durationMs: 420, easing: EASE_OUT, reducedMotionEquivalent: "red node + reason text" },
  M15: { name: "ReceiptSeal", firesOn: "terminal success", durationMs: 400, easing: EASE_OUT, reducedMotionEquivalent: "green top border + seal dot" },
  M16: { name: "TruthReveal", firesOn: "predicted<->actual arrives", durationMs: 320, easing: EASE_OUT, reducedMotionEquivalent: "two static columns; diffs outlined" },
  M17: { name: "FieldWarm", firesOn: "overdue total changes", durationMs: 900, easing: EASE_IO, reducedMotionEquivalent: "points re-render at new positions" },
  M18: { name: "Relight", firesOn: "transport degraded -> live", durationMs: 700, easing: EASE_OUT, reducedMotionEquivalent: "fog clears instantly" },
}

/** Wired in P2.T13. The rest stay catalog-only (in `/jarvis/stage`) until their
 *  own phase — never promoted here, never silently dropped. */
export const P2_PROMOTED_MOTIONS: MotionId[] = ["M1", "M2", "M3", "M5", "M6", "M7", "M9", "M10", "M11", "M12", "M15"]

const STAGGER_MS = {
  contextGather: 60,
  planDraw: 80,
  reject: 30,
}

/** Framer Motion variants, one per promoted motion, all derived from MOTION_SPECS
 *  above rather than re-stating durations/eases a second time. `reduced=true`
 *  swaps in the static equivalent framer-motion can express (an instant/near-
 *  instant transition to the same end state) — the informational content is
 *  identical either way; only the journey there differs (§5.3's own rule). */
export function railCommitVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M1
  return {
    initial: { borderColor: "rgba(34,211,238,0.25)", borderWidth: 1 },
    animate: { borderColor: "rgba(34,211,238,0.9)", borderWidth: 2 },
    transition: reduced ? { duration: 0 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export function threadBirthVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M2
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 14, scaleY: 0.96 },
    animate: { opacity: 1, y: 0, scaleY: 1 },
    transition: reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
    style: { transformOrigin: "top" },
  }
}

export function planDrawNodeVariants(index: number, reduced: boolean) {
  const spec = MOTION_SPECS.M5
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0 },
    animate: { opacity: 1, scale: 1 },
    transition: reduced
      ? { duration: 0.12, delay: 0 }
      : { duration: spec.durationMs / 1000, ease: spec.easing as number[], delay: (index * STAGGER_MS.planDraw) / 1000 },
  }
}

export function cockpitRiseVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M7
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export function stampApproveVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M9
  return {
    initial: reduced ? { opacity: 0 } : { scale: 1.6, rotate: -8, opacity: 0 },
    animate: { scale: 1, rotate: 0, opacity: 1 },
    transition: reduced ? { duration: 0.1 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export function shatterRejectVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M10
  return {
    exit: reduced
      ? { opacity: 0, transition: { duration: 0.16 } }
      : { opacity: 0, y: 18, transition: { duration: spec.durationMs / 1000, ease: spec.easing as number[] } },
  }
}

export function receiptSealVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M15
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0 },
    animate: { opacity: 1, scale: 1 },
    transition: reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export const CONTEXT_GATHER_STAGGER_MS = STAGGER_MS.contextGather
export const PLAN_DRAW_STAGGER_MS = STAGGER_MS.planDraw
export const REJECT_SLICE_STAGGER_MS = STAGGER_MS.reject
