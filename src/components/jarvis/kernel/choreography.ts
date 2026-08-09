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

import { SIGNATURE_MOMENTS, type SignatureMomentId } from "./signature-moments"

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

/** jarvis-v3 P3.T7: M4 needed real per-event context arrival (P2's own note above)
 *  — now real, via `instruction_events.context_retrieved` + the 400ms trace poll.
 *  M5 PlanDraw is ALSO now driven by real per-event `action_created` arrival
 *  (previously all-at-once from the POST response) — same motion, not newly
 *  promoted, so it stays in `P2_PROMOTED_MOTIONS` rather than duplicated here. */
export const P3_PROMOTED_MOTIONS: MotionId[] = ["M4"]

const STAGGER_MS = {
  contextGather: 60,
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

export function threadBirthVariants(reduced: boolean, restored = false) {
  const spec = MOTION_SPECS.M2
  return {
    initial: restored ? { opacity: 1, y: 0, scaleY: 1 } : reduced ? { opacity: 0 } : { opacity: 0, y: 14, scaleY: 0.96 },
    animate: { opacity: 1, y: 0, scaleY: 1 },
    transition: restored ? { duration: 0 } : reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
    style: { transformOrigin: "top" },
  }
}

/** LF-18 Spatial Continuity (§4.2): the document uses one FLIP/layout cadence
 *  for causal block/focus transitions. 320ms is inside the plan's 260–380ms
 *  contract and is deliberately separate from M2's 420ms ThreadBirth motion.
 *  Reduced motion keeps the same geometry without a layout tween. */
export const SPATIAL_CONTINUITY_DURATION_MS = 320

export function spatialContinuityTransition(reduced: boolean) {
  return reduced
    ? { duration: 0 }
    : { duration: SPATIAL_CONTINUITY_DURATION_MS / 1000, ease: [...EASE_OUT] }
}

export function threadLayoutTransition(reduced: boolean) {
  return spatialContinuityTransition(reduced)
}

/** The body never leaves the document when a block collapses. Keeping it
 *  mounted preserves local form state and prevents lifecycle cues from replaying
 *  when an older block is re-expanded. `visibility` is applied by the caller to
 *  keep collapsed controls out of keyboard navigation during the same layout
 *  transition. */
export function threadBodyVariants(reduced: boolean) {
  const transition = threadLayoutTransition(reduced)
  return {
    expanded: { height: "auto", opacity: 1, transition },
    collapsed: { height: 0, opacity: 0, transition },
  }
}

/** M4 ContextGather (§5.3, wired P3.T7): each real context chip flies in,
 *  staggered 60ms — reduced motion fades in at the same stagger, no fly-from-field
 *  transform (§5.3's own reduced-motion equivalent: "chips fade in, staggered 60 ms"). */
export function contextGatherChipVariants(index: number, reduced: boolean) {
  const spec = MOTION_SPECS.M4
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
    transition: reduced
      ? { duration: 0.12, delay: (index * STAGGER_MS.contextGather) / 1000 }
      : { duration: spec.durationMs / 1000, ease: spec.easing as number[], delay: (index * STAGGER_MS.contextGather) / 1000 },
  }
}

export const PLAN_DRAW_NODE_DURATION_MS = 160
export const PLAN_DRAW_EDGE_DURATION_MS = 240

/** LF-06 Plan Draw: a real node resolves in 160ms. `entering` comes from the
 *  real node-id arrival set; a restored/initial node is already settled. There
 *  is intentionally no index delay: nodes delivered in one trace batch render
 *  together instead of pretending to have streamed separately. */
export function planDrawNodeVariants(reduced: boolean, entering: boolean) {
  const settledBorder = "rgba(103,232,249,0.34)"
  const quietBorder = "rgba(255,255,255,0.08)"
  return {
    initial: reduced || !entering ? { opacity: 1, scale: 1, borderColor: settledBorder } : { opacity: 0, scale: 0.96, borderColor: quietBorder },
    animate: { opacity: 1, scale: 1, borderColor: settledBorder },
    transition: reduced || !entering ? { duration: 0 } : { duration: PLAN_DRAW_NODE_DURATION_MS / 1000, ease: [...EASE_OUT] },
  }
}

/** LF-06 dependency edge: the actual endpoint relationship is supplied by the
 *  planner's `dependsOn` facts; the caller does not create missing endpoints. */
export function planDrawEdgeVariants(reduced: boolean, entering: boolean) {
  const settledBorder = "rgba(103,232,249,0.38)"
  return {
    initial: reduced || !entering ? { opacity: 1, scaleY: 1, borderColor: settledBorder } : { opacity: 0, scaleY: 0, borderColor: "rgba(103,232,249,0)" },
    animate: { opacity: 1, scaleY: 1, borderColor: settledBorder },
    style: { transformOrigin: "top" },
    transition: reduced || !entering ? { duration: 0 } : { duration: PLAN_DRAW_EDGE_DURATION_MS / 1000, ease: [...EASE_IO] },
  }
}

/** M6 PolicyClamp: only the real awaiting_approval edge gets the entrance
 * motion. Planning/terminal snapshots keep the amber policy evidence settled;
 * restored approval snapshots do not replay it. */
export function policyClampVariants(reduced: boolean, active: boolean, restored = false) {
  const spec = MOTION_SPECS.M6
  const settled = reduced || !active || restored
  return {
    initial: settled ? { x: 0 } : { x: -4 },
    animate: { x: 0 },
    transition: settled ? { duration: 0 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export function policyClampBracketVariants(reduced: boolean, active: boolean, restored = false) {
  const spec = MOTION_SPECS.M6
  const settled = reduced || !active || restored
  return {
    initial: settled ? { scaleY: 1 } : { scaleY: 0 },
    animate: { scaleY: 1 },
    transition: settled ? { duration: 0 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

/** A small one-shot cue used for the Ready → Listening wake edge. The
 * source-specific surfaces use their existing motion variants; this helper
 * supplies only the shared launch grammar for the presence ring. */
export function signatureMomentRingVariants(moment: SignatureMomentId, reduced: boolean) {
  const spec = SIGNATURE_MOMENTS[moment]
  const durationMs = Math.round((spec.durationMs[0] + spec.durationMs[1]) / 2)
  return {
    initial: { opacity: 0, scale: 0.78 },
    animate: reduced
      ? { opacity: 0.72, scale: 1, transition: { duration: 0 } }
      : { opacity: [0, 0.72, 0], scale: [0.78, 1.05, 1.28], transition: { duration: durationMs / 1000, ease: [...spec.easing] } },
  }
}

export function cockpitRiseVariants(reduced: boolean, restored = false) {
  const spec = MOTION_SPECS.M7
  return {
    initial: restored ? { opacity: 1, y: 0 } : reduced ? { opacity: 0 } : { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: restored ? { duration: 0 } : reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

/** LF-08 Gate Rise (§4.2): the approval surface expands from the active plan
 * boundary in 280ms. Restored approval state is already settled and never
 * replays the rise on refresh. */
export const LF08_GATE_RISE_MS = 280

export function gateRiseVariants(reduced: boolean, restored = false) {
  return {
    initial: restored ? { opacity: 1, y: 0 } : reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: restored ? { duration: 0 } : reduced ? { duration: 0 } : { duration: LF08_GATE_RISE_MS / 1000, ease: [0.22, 1, 0.36, 1] as number[] },
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

export function receiptSealVariants(reduced: boolean, restored = false) {
  const spec = MOTION_SPECS.M15
  return {
    initial: restored ? { opacity: 1, scale: 1 } : reduced ? { opacity: 0 } : { opacity: 0, scale: 0 },
    animate: { opacity: 1, scale: 1 },
    transition: restored ? { duration: 0 } : reduced ? { duration: 0.12 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

export const CONTEXT_GATHER_STAGGER_MS = STAGGER_MS.contextGather
/** Retained as a named compatibility constant: LF-06 deliberately has no
 *  per-index batch stagger. */
export const PLAN_DRAW_STAGGER_MS = 0
export const REJECT_SLICE_STAGGER_MS = STAGGER_MS.reject

/** LF-03 Transcript Ink (§4.2): partial text cross-fades on each real Vapi
 * replacement; the final transcript gets a longer lock-in and a settled
 * weight. Reduced motion keeps the same text and final weight, but replaces
 * both the outgoing and incoming ink instantly. */
export type TranscriptInkPhase = "partial" | "final"
export const TRANSCRIPT_PARTIAL_CROSSFADE_MS = 90
export const TRANSCRIPT_FINAL_LOCK_MS = 180
export const INTENT_LAUNCH_DURATION_MS = 260

/** LF-05 Context Constellation (§4.2): a real context fact travels from the
 *  Signal Field to its source-labelled chip in 220ms. Facts that arrive in one
 *  trace batch use append order with a bounded 45ms stagger; the delay is a
 *  presentation detail and never claims those facts arrived as separate events. */
export const CONTEXT_CONSTELLATION_DURATION_MS = 220
export const CONTEXT_CONSTELLATION_STAGGER_MS = 45

export function contextConstellationChipVariants(index: number, reduced: boolean, entering: boolean) {
  const delay = entering ? (index * CONTEXT_CONSTELLATION_STAGGER_MS) / 1000 : 0
  return {
    initial: !entering || reduced ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: reduced
      ? { duration: 0 }
      : { duration: CONTEXT_CONSTELLATION_DURATION_MS / 1000, ease: [...EASE_OUT], delay },
  }
}

export function contextConstellationFlightVariants(index: number, reduced: boolean) {
  return {
    initial: reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.72 },
    animate: reduced
      ? { opacity: 1, scale: 1 }
      : { opacity: [0, 1, 1, 0], scale: [0.72, 1.08, 0.9, 0.42] },
    transition: reduced
      ? { duration: 0 }
      : {
          duration: CONTEXT_CONSTELLATION_DURATION_MS / 1000,
          ease: [...EASE_OUT],
          delay: (index * CONTEXT_CONSTELLATION_STAGGER_MS) / 1000,
        },
  }
}

/** LF-07 Question Focus (§4.2): a real clarification decision makes the
 * unrelated canvas depth recede to 42% over 220ms while the question settles
 * upward by 8px. The caller supplies the real LIVEFRAME focus; this helper
 * owns no state and cannot invent a question or a decision. Reduced motion
 * reaches the same dim/focused end state without travel. */
export const QUESTION_FOCUS_DURATION_MS = 220
export const QUESTION_FOCUS_DIM_OPACITY = 0.42
export const QUESTION_FOCUS_RISE_PX = 8

export function questionFocusLayerVariants(reduced: boolean, focused: boolean) {
  return {
    initial: { opacity: 1 },
    animate: { opacity: focused ? QUESTION_FOCUS_DIM_OPACITY : 1 },
    transition: reduced
      ? { duration: 0 }
      : { duration: QUESTION_FOCUS_DURATION_MS / 1000, ease: [...EASE_IO] },
  }
}

export function questionFocusQuestionVariants(reduced: boolean, focused: boolean) {
  return {
    initial: reduced || !focused ? { opacity: 1, y: 0 } : { opacity: 1, y: QUESTION_FOCUS_RISE_PX },
    animate: { opacity: 1, y: focused ? 0 : QUESTION_FOCUS_RISE_PX },
    transition: reduced
      ? { duration: 0 }
      : { duration: QUESTION_FOCUS_DURATION_MS / 1000, ease: [...EASE_OUT] },
  }
}

export function transcriptInkVariants(phase: TranscriptInkPhase, reduced: boolean) {
  const durationMs = phase === "final" ? TRANSCRIPT_FINAL_LOCK_MS : TRANSCRIPT_PARTIAL_CROSSFADE_MS
  const weight = phase === "final" ? 600 : 400
  const transition = reduced
    ? { duration: 0 }
    : { duration: durationMs / 1000, ease: [...EASE_IO] }
  return {
    initial: reduced ? { opacity: 1, fontWeight: weight } : { opacity: 0, fontWeight: weight },
    animate: { opacity: 1, fontWeight: weight, transition },
    exit: {
      opacity: 0,
      transition: reduced ? { duration: 0 } : { duration: TRANSCRIPT_PARTIAL_CROSSFADE_MS / 1000, ease: [...EASE_IO] },
    },
  }
}

/** LF-04 Intent Launch (§4.2): one accepted-submit impulse travels from the
 * Dock toward the Heard anchor. Reduced motion keeps the accepted state solid;
 * the caller supplies the real source/target coordinates. */
export function intentLaunchVariants(reduced: boolean) {
  return {
    initial: reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.72 },
    animate: reduced
      ? { opacity: 1, scale: 1 }
      : { opacity: [0, 1, 0.82, 0], scale: [0.72, 1.12, 0.9, 0.35] },
    transition: reduced
      ? { duration: 0 }
      : { duration: INTENT_LAUNCH_DURATION_MS / 1000, ease: [...EASE_OUT] },
  }
}

/** M16 TruthReveal (§5.3, wired P4.T3): "predicted column holds; actual column
 *  slides in from x:12px 320 ms" — the Actual cell's own entrance, once a real
 *  `predictionDiff` arrives. Reduced motion: "two static columns", i.e. no slide. */
export function truthRevealActualVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M16
  return {
    initial: reduced ? { opacity: 1 } : { opacity: 0, x: 12 },
    animate: { opacity: 1, x: 0 },
    transition: reduced ? { duration: 0 } : { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
  }
}

/** M16's row-level outcome cue: "matching rows pulse green once (140 ms),
 *  differing rows pulse amber and stay outlined." A one-shot background pulse
 *  that settles — matched rows settle to transparent, differing rows settle to
 *  a faint, lasting amber wash (the "stay outlined" half of the spec; the
 *  persistent border itself is a static class, not motion). Reduced motion:
 *  "diffs outlined" — the settled end-state renders immediately, no pulse. */
export function truthRevealRowPulse(matched: boolean, reduced: boolean) {
  const settled = matched ? "rgba(52,211,153,0)" : "rgba(245,185,66,0.08)"
  if (reduced) return { initial: { backgroundColor: settled }, animate: { backgroundColor: settled }, transition: { duration: 0 } }
  const peak = matched ? "rgba(52,211,153,0.22)" : "rgba(245,185,66,0.22)"
  return { initial: { backgroundColor: peak }, animate: { backgroundColor: settled }, transition: { duration: 0.14, ease: "easeOut" as const } }
}

/** M17 FieldWarm (§5.3, wired P4.T5): "field points re-target over 900 ms
 *  EASE_IO" — the Field's own reactivity (bridge/ThreadField.tsx renders
 *  `overdueInvoices.value.count` points, already re-rendering the instant a
 *  payment lands and the count drops via P4.T5's cross-surface invalidation)
 *  needed one real thing added: a point that disappears fades out over M17's
 *  own duration instead of vanishing on the next paint. Reduced motion: "points
 *  re-render at new positions" — no fade, which is already this array's default
 *  behavior with no exit animation at all. */
export function fieldWarmExitVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M17
  return { exit: reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: { duration: spec.durationMs / 1000, ease: spec.easing as number[] } } }
}

/** Wired P4.T3/T5. */
export const P4_PROMOTED_MOTIONS: MotionId[] = ["M16", "M17"]

/** M8 BlastRadius (§5.3, wired P5.T3): "N dots bloom outward from it, 24 ms
 *  stagger, capped at 60 rendered." The count-up itself reuses the existing
 *  `<Ticker>` primitive (ui/motion/primitives.tsx) — mount at 0, then set the
 *  real count, and its own spring animates between them; this is the dots-
 *  only half of the spec. Reduced motion: "number renders final; dots
 *  static" — dots render at their end state with no stagger, no entrance. */
export function blastRadiusDotVariants(index: number, reduced: boolean, restored = false) {
  const spec = MOTION_SPECS.M8
  return {
    initial: restored || reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 },
    animate: { opacity: 1, scale: 1 },
    transition: restored || reduced
      ? { duration: 0 }
      : { duration: 0.24, ease: spec.easing as number[], delay: (index * BLAST_RADIUS_DOT_STAGGER_MS) / 1000 },
  }
}
export const BLAST_RADIUS_DOT_STAGGER_MS = 24
export const BLAST_RADIUS_DOT_CAP = 60

/** Wired P5.T3. */
export const P5_PROMOTED_MOTIONS: MotionId[] = ["M8"]

/** M14 FaultShake (§5.3): a real failed workflow step gets one restrained
 *  4px shake. The node's red tone and terminal reason remain the durable truth;
 *  this is only the event cue, and it is never mounted for an already-failed
 *  step discovered on first render. Reduced motion keeps the settled red cue. */
export function faultShakeVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M14
  return {
    initial: { x: 0, opacity: 0 },
    animate: reduced
      ? { x: 0, opacity: 1, transition: { duration: 0 } }
      : {
          x: [0, -4, 4, -3, 3, 0],
          opacity: [0, 1, 1, 1, 1, 0],
          transition: { duration: spec.durationMs / 1000, ease: spec.easing as number[] },
        },
  }
}

/** M18 Relight (§5.3): the transport's real degraded -> live edge gets one
 *  700ms sweep. The surrounding fog/color transition is CSS and settles to the
 *  live state immediately under reduced motion; this overlay carries no data. */
export function relightVariants(reduced: boolean) {
  const spec = MOTION_SPECS.M18
  return {
    initial: { x: "-100%", opacity: 0 },
    animate: reduced
      ? { x: 0, opacity: 0, transition: { duration: 0 } }
      : { x: "100%", opacity: [0, 0.34, 0], transition: { duration: spec.durationMs / 1000, ease: spec.easing as number[] } },
  }
}

/** P7 motion promotion: execution faults and transport recovery now have real
 *  owner-journey bindings. M13's reverse graph edge was already production-wired
 *  by the workflow theater, so keep it in the same phase ledger. */
export const P7_PROMOTED_MOTIONS: MotionId[] = ["M13", "M14", "M18"]
