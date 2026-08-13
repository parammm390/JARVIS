"use client"

// jarvis-v3 P5.T8 / P3.T6 — thread stacking (§2.2: "Threads stack
// newest-first; older threads collapse to a single row"). History stays a
// quiet audit trail rather than another panel surface. It still reuses the
// `Thread` component for an explicitly opened historical record — never a
// second rendering implementation. A historical thread's callbacks are
// no-ops: it is a real record of what happened, not a live, actionable one
// (its own clarification, if any, was already superseded by whatever
// instruction replaced it — answering it now would not reach a real backend
// row).

import { useState } from "react"
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion"
import type { Thread as ThreadData } from "../kernel/store"
import { Thread } from "./Thread"
import type { ExecutionWeavePlacement } from "./ThreadBlocks"
import type { LiveFrameIntentLaunch } from "../kernel/liveframe"
import { choreo } from "../ui/motion/choreo"
import { summarizeThreadOutcome, threadRowElementId } from "./thread-presentation"

/** jarvis-v3 P5.T8 — the stable id `RecentThreadsPanel.tsx`'s "select to
 *  jump" scrolls to; kept here (not duplicated in that file) since this file
 *  owns where each thread's own row actually renders. */
function CollapsedThread({ thread }: { thread: ThreadData }) {
  const [expanded, setExpanded] = useState(false)
  const outcome = summarizeThreadOutcome(thread.machine.instructionState)
  const detailsId = `thread-history-details-${thread.id}`

  if (!expanded) {
    return (
      <button
        id={threadRowElementId(thread.id)}
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-controls={detailsId}
        data-thread-history-row
        data-thread-history-id={thread.id}
        data-thread-history-state="collapsed"
        className="j-thread-history__row group"
      >
        <span className="j-thread-history__instruction j-fs-sm">{thread.instructionText}</span>
        <span className="j-thread-history__outcome j-fs-micro">{outcome}</span>
        <span className="j-thread-history__action j-fs-micro">View details</span>
      </button>
    )
  }

  return (
    <div
      id={threadRowElementId(thread.id)}
      tabIndex={-1}
      data-thread-history-row
      data-thread-history-id={thread.id}
      data-thread-history-state="expanded"
      className="j-thread-history__detail"
    >
      <div className="j-thread-history__detail-bar">
        <span className="j-fs-micro text-[color:var(--j-text-faint)]">History detail · read-only</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          aria-controls={detailsId}
          className="j-thread-history__collapse j-fs-micro"
        >
          Collapse
        </button>
      </div>
      <div id={detailsId} aria-label={`Historical thread details for ${thread.instructionText}`}>
        <Thread thread={thread} onCancel={() => {}} onAnswer={() => {}} onSkip={() => {}} onRetry={() => {}} restored />
      </div>
    </div>
  )
}

export function ThreadStack({
  thread,
  threadHistory,
  onCancel,
  onAnswer,
  onSkip,
  onRetry,
  reducedMotion,
  intentLaunch,
  executionWeavePlacement = "document",
  executionEnergy = 0,
  threadRestored = false,
  restoredTraceEventCount = 0,
}: {
  thread: ThreadData
  threadHistory: ThreadData[]
  onCancel: () => void
  onAnswer: (text: string) => void
  onSkip: () => void
  onRetry?: () => void | Promise<void>
  reducedMotion: boolean
  intentLaunch?: LiveFrameIntentLaunch | null
  executionWeavePlacement?: ExecutionWeavePlacement
  executionEnergy?: number
  threadRestored?: boolean
  restoredTraceEventCount?: number
}) {
  const enter = reducedMotion ? choreo.cameraPan.reducedVariants : choreo.cameraPan.variants
  const exit = reducedMotion ? choreo.sceneDockExit.reducedVariants : choreo.sceneDockExit.variants
  const retry = onRetry ?? (() => {})

  return (
    <AnimatePresence initial={false} mode="sync">
      <motion.div
        key={thread.id}
        layout={!reducedMotion}
        className="space-y-3"
        variants={enter}
        initial={threadRestored ? false : "initial"}
        animate="animate"
        exit={exit.animate as TargetAndTransition}
        data-thread-stack-restored={threadRestored ? "true" : "false"}
      >
        <div id={threadRowElementId(thread.id)} tabIndex={-1}>
          <Thread thread={thread} onCancel={onCancel} onAnswer={onAnswer} onSkip={onSkip} onRetry={retry} intentLaunch={intentLaunch} executionWeavePlacement={executionWeavePlacement} executionEnergy={executionEnergy} restored={threadRestored} restoredTraceEventCount={restoredTraceEventCount} />
        </div>
        {threadHistory.length > 0 && (
          <section
            className="j-thread-history mx-auto w-full max-w-[720px] px-4"
            data-thread-history
            data-thread-history-count={threadHistory.length}
            aria-label="Thread history"
          >
            <div className="j-thread-history__heading">
              <span className="j-label">Thread history</span>
              <span className="j-fs-micro text-[color:var(--j-text-faint)]">
                {threadHistory.length} previous {threadHistory.length === 1 ? "thread" : "threads"}
              </span>
            </div>
            <div className="j-thread-history__list" role="list">
              {threadHistory.map((old) => (
                <div key={old.id} className="j-thread-history__item" role="listitem">
                  <CollapsedThread thread={old} />
                </div>
              ))}
            </div>
          </section>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
