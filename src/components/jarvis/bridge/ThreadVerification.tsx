"use client"

// The Instruction Thread — ⑦ VERIFICATION, predicted <-> actual (plan v3 §6⑦,
// P4.T3). Predicted comes from `simulate()` (already computed and persisted at
// plan-creation time — orchestration/src/planner.ts). Actual comes from the
// field-level diff orchestration/src/prediction-diff.ts's diffPrediction()
// computes once the real execution result exists and persists on
// domain_actions.predictionDiff. This component only renders what the backend
// already computed — no comparison logic lives here.
//
// Also fixes a real, live raw-JSON violation found while building this: this
// session's own binding forbids raw JSON on any customer-facing receipt, and
// `lib/ReceiptDrawer.tsx`'s `JsonBlock` dumped `JSON.stringify(expectedResult/
// actualResult, null, 2)` into a `<pre>` on every receipt — reused by
// ApprovalCockpit's drawer, WorkflowTheater, and DailyBriefing alike.
// `lib/field-format.tsx`'s `FieldList` (shared with P4.T2's approval-card
// predicted-outcome expand) is the designed replacement.

import { motion } from "framer-motion"
import { truthRevealActualVariants, truthRevealRowPulse } from "../kernel/choreography"
import { FieldList, formatFieldValue } from "../lib/field-format"

export interface PredictionDiffField {
  path: string
  predicted: unknown
  actual: unknown
  matched: boolean
}
export interface PredictionDiff {
  compared: number
  matched: number
  accuracy: number | null
  fields: PredictionDiffField[]
}
export type PredictedOutcome = Record<string, unknown>

export { FieldList, flattenForDisplay, formatFieldValue } from "../lib/field-format"

/** M16 TruthReveal (§5.3): predicted column holds, actual column slides in;
 *  matching rows pulse green once, differing rows pulse amber and stay
 *  outlined. §6⑦'s own literal fallback: "the panel is never hidden" — a
 *  domain_action with no real `simulate()` prediction renders the literal
 *  string below rather than disappearing. */
export function ThreadVerification({
  predicted,
  predictionDiff,
  reducedMotion,
}: {
  predicted: PredictedOutcome | null
  predictionDiff: PredictionDiff | null
  reducedMotion: boolean
}) {
  const hasDiff = predictionDiff !== null && predictionDiff.compared > 0
  const hasPredictedOnly = !hasDiff && predicted !== null

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
        <span>Predicted vs actual</span>
        {hasDiff && predictionDiff!.accuracy !== null && (
          <span className="text-[color:var(--j-text-dim)]">{Math.round(predictionDiff!.accuracy * 100)}% matched</span>
        )}
      </div>

      {!hasDiff && !hasPredictedOnly && <p className="text-[11px] text-[color:var(--j-text-dim)]">No prediction was recorded for this action.</p>}

      {hasDiff && (
        <div className="space-y-1 rounded-lg border border-white/8 bg-white/[0.02] p-2">
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[9px] font-black uppercase tracking-wide text-[color:var(--j-text-faint)]">
            <span>Field</span>
            <span>Predicted</span>
            <span>Actual</span>
          </div>
          {predictionDiff!.fields.map((f) => {
            const pulse = truthRevealRowPulse(f.matched, reducedMotion)
            const actualVariants = truthRevealActualVariants(reducedMotion)
            return (
              <motion.div
                key={f.path}
                className={`grid grid-cols-[1fr_1fr_1fr] items-baseline gap-2 rounded-md px-1.5 py-1 text-[11px] ${f.matched ? "" : "border border-amber-300/30"}`}
                initial={pulse.initial}
                animate={pulse.animate}
                transition={pulse.transition}
              >
                <span className="truncate text-[color:var(--j-text-dim)]">{f.path}</span>
                <span className="truncate font-mono text-[color:var(--j-text)]">{formatFieldValue(f.predicted)}</span>
                <motion.span
                  className="truncate font-mono text-[color:var(--j-text)]"
                  initial={actualVariants.initial}
                  animate={actualVariants.animate}
                  transition={actualVariants.transition}
                >
                  {formatFieldValue(f.actual)}
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      )}

      {!hasDiff && hasPredictedOnly && (
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
          <FieldList value={predicted} />
          <p className="mt-2 text-[10px] text-[color:var(--j-text-faint)]">Actual outcome not recorded yet.</p>
        </div>
      )}
    </div>
  )
}
