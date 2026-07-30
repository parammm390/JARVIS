"use client"

// jarvis-v3 P5.T8 — thread stacking (§2.2: "Threads stack newest-first;
// older threads collapse to a single row"). Reuses `Thread.tsx`'s own
// existing 40px-collapsed-row visual language (`BlockShell`) at the
// whole-thread level, and reuses the `Thread` component itself for a
// re-expanded historical thread — never a second rendering implementation.
// A historical thread's callbacks are no-ops: it is a real record of what
// happened, not a live, actionable one (its own clarification, if any, was
// already superseded by whatever instruction replaced it — answering it now
// would not reach a real backend row).

import { useState } from "react"
import type { Thread as ThreadData } from "../kernel/store"
import { Thread } from "./Thread"
import type { InstructionState } from "../kernel/types"

/** jarvis-v3 P5.T8 — the stable id `RecentThreadsPanel.tsx`'s "select to
 *  jump" scrolls to; kept here (not duplicated in that file) since this file
 *  owns where each thread's own row actually renders. */
export function threadRowElementId(threadId: string): string {
  return `thread-row-${threadId}`
}

/** Pure — directly unit-testable (BLOCKER B-1 means the component around it
 *  isn't). Never claims "Done" for a thread abandoned mid-flight. */
export function summarizeThreadOutcome(state: InstructionState): string {
  switch (state) {
    case "completed":
      return "Done"
    case "partial":
      return "Partial"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    default:
      return "Left in progress"
  }
}

function CollapsedThread({ thread }: { thread: ThreadData }) {
  const [expanded, setExpanded] = useState(false)

  if (!expanded) {
    return (
      <button
        id={threadRowElementId(thread.id)}
        type="button"
        onClick={() => setExpanded(true)}
        className="j-panel flex h-10 w-full items-center justify-between rounded-xl border border-white/8 px-3 text-left opacity-70 transition-opacity hover:opacity-100"
      >
        <span className="j-fs-sm truncate text-[color:var(--j-text-dim)]">{thread.instructionText}</span>
        <span className="j-fs-sm shrink-0 pl-3 text-[color:var(--j-text-faint)]">{summarizeThreadOutcome(thread.machine.instructionState)}</span>
      </button>
    )
  }

  return (
    <div id={threadRowElementId(thread.id)}>
      <button type="button" onClick={() => setExpanded(false)} className="j-fs-micro mb-1 text-[color:var(--j-text-faint)] underline">
        Collapse
      </button>
      <Thread thread={thread} onCancel={() => {}} onAnswer={() => {}} onSkip={() => {}} />
    </div>
  )
}

export function ThreadStack({
  thread,
  threadHistory,
  onCancel,
  onAnswer,
  onSkip,
}: {
  thread: ThreadData
  threadHistory: ThreadData[]
  onCancel: () => void
  onAnswer: (text: string) => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-3">
      <div id={threadRowElementId(thread.id)}>
        <Thread thread={thread} onCancel={onCancel} onAnswer={onAnswer} onSkip={onSkip} />
      </div>
      {threadHistory.length > 0 && (
        <div className="mx-auto w-full max-w-[720px] space-y-2 px-4">
          {threadHistory.map((old) => (
            <CollapsedThread key={old.id} thread={old} />
          ))}
        </div>
      )}
    </div>
  )
}
