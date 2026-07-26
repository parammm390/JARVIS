"use client"

// C3.T2 — ErrorState with a recovery action, per plan spec. The pattern already
// existed inline at several fetch-error call sites (a red-tinted div + message,
// e.g. ReceiptDrawer's `error &&` block, LiveQueryFixtureSection on the Stage) but
// never as a named, reusable component with an actual retry affordance — this adds
// the retry action those inline versions were missing, not just a repackaging.
//
// F6.T2 — FLOW-89 ErrorFracture formalizes this as a named behavior: a hairline
// crack at one border corner (§2's "rejected/destroyed" language borrowed for
// "broken", never a full ShatterReject reuse — that preset is decision-specific) that
// seals shut the instant Retry is pressed, one-shot, ≤400ms, before the real
// `onRetry` actually runs. Reduced motion collapses the seal to an instant swap.

import { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  const reduced = useReducedMotion()
  const [sealing, setSealing] = useState(false)

  function handleRetry() {
    if (!onRetry) return
    if (reduced) {
      onRetry()
      return
    }
    setSealing(true)
    window.setTimeout(onRetry, 320)
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">
      <motion.svg
        aria-hidden
        className="pointer-events-none absolute -left-1 -top-1 h-4 w-4"
        viewBox="0 0 16 16"
        initial={false}
        animate={sealing ? { opacity: 0, pathLength: 0 } : { opacity: 0.8, pathLength: 1 }}
        transition={{ duration: reduced ? 0 : 0.32, ease: "easeInOut" }}
      >
        <motion.path d="M1 1 L7 6 L4 9 L10 15" fill="none" stroke="#f87171" strokeWidth={1.25} />
      </motion.svg>
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry && (
          <button onClick={handleRetry} className="shrink-0 rounded-full border border-red-400/40 px-2.5 py-1 text-[9.5px] font-bold text-red-200 hover:bg-red-400/10">
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
