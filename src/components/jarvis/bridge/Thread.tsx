"use client"

// The Instruction Thread — depth 1, the document column (plan v3 §2.2/§2.3, P2.T5).
//
// "An instruction never navigates away. It expands in place, downward, through
// six blocks... Blocks never disappear. They collapse to a 40 px summary row
// when the next block opens, and re-expand on click." This file owns exactly
// that mechanic; the blocks themselves live in `ThreadBlocks.tsx`.

import { useMemo, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import type { Thread as ThreadData } from "../kernel/store"
import { useKernel } from "../kernel/store"
import { threadBirthVariants } from "../kernel/choreography"
import { ThreadClarify, ThreadExecution, ThreadHeard, ThreadPlan, ThreadReceipt, ThreadUnderstood } from "./ThreadBlocks"
import type { InstructionState } from "../kernel/types"

type BlockKey = "heard" | "understood" | "plan" | "execution" | "receipt"

/** Which block is the CURRENTLY ACTIVE one for a given instruction state —
 *  everything before it collapses to a summary row by default (still
 *  click-to-expand); everything after it does not exist yet. */
function activeBlock(state: InstructionState): BlockKey {
  switch (state) {
    case "idle":
    case "captured":
      return "heard"
    case "understanding":
      return "understood"
    case "planning":
    case "clarifying":
    case "awaiting_approval":
      return "plan"
    case "executing":
    case "verifying":
      return "execution"
    case "completed":
    case "partial":
    case "failed":
    case "cancelled":
      return "receipt"
    default:
      return "heard"
  }
}

const BLOCK_ORDER: BlockKey[] = ["heard", "understood", "plan", "execution", "receipt"]

function BlockShell({
  title,
  collapsedSummary,
  collapsed,
  onToggle,
  children,
}: {
  title: string
  collapsedSummary: string
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="j-panel flex h-10 w-full items-center justify-between rounded-xl border border-white/8 px-3 text-left"
      >
        <span className="j-fs-sm text-[color:var(--j-text-dim)]">{title}</span>
        <span className="j-fs-sm truncate pl-3 text-[color:var(--j-text-faint)]">{collapsedSummary}</span>
      </button>
    )
  }
  return <div className="j-panel-hot rounded-xl border border-white/10 p-4">{children}</div>
}

export function Thread({ thread, onCancel, onAnswer, onSkip }: { thread: ThreadData; onCancel: () => void; onAnswer: (text: string) => void; onSkip: () => void }) {
  const reducedMotionRaw = useReducedMotion()
  const reducedMotion = reducedMotionRaw ?? false
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<BlockKey>>(new Set())
  const active = activeBlock(thread.machine.instructionState)
  const activeIndex = BLOCK_ORDER.indexOf(active)

  const toggle = (key: BlockKey) =>
    setManuallyExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const heardCollapsed = activeIndex > 0 ? !manuallyExpanded.has("heard") : false
  const understoodExists = thread.machine.instructionState !== "captured" && thread.machine.instructionState !== "idle"
  const understoodCollapsed = understoodExists && activeIndex > 1 ? !manuallyExpanded.has("understood") : false
  const planExists = activeIndex >= 2
  const planCollapsed = planExists && activeIndex > 2 ? !manuallyExpanded.has("plan") : false
  // `thread.everExecuted`, NOT "reached any terminal state" — a rejected or
  // user-cancelled thread reaches a terminal state (§4.4) without ever
  // executing anything. Found via a real live test: a rejected approval still
  // showed a collapsed "Execution: Executed" row, claiming something happened
  // that didn't — exactly the kind of thing this whole plan exists to prevent.
  const executionExists = thread.everExecuted
  const executionCollapsed = executionExists && activeIndex > 3 ? !manuallyExpanded.has("execution") : false

  const heardSummary = thread.instructionText
  const understoodSummary = "Context reviewed"
  const planSummary = thread.clarification ? "Clarifying" : `${thread.nodes.length} action${thread.nodes.length === 1 ? "" : "s"}`
  const executionSummary = "Executed"

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-3 px-4 pb-40 pt-24">
      <motion.div key={thread.id} {...threadBirthVariants(reducedMotion)}>
        <BlockShell title="Heard" collapsedSummary={heardSummary} collapsed={heardCollapsed} onToggle={() => toggle("heard")}>
          <ThreadHeard thread={thread} onCancel={onCancel} />
        </BlockShell>
      </motion.div>

      <AnimatePresence>
        {understoodExists && (
          <motion.div key="understood" {...threadBirthVariants(reducedMotion)}>
            <BlockShell title="Understood" collapsedSummary={understoodSummary} collapsed={understoodCollapsed} onToggle={() => toggle("understood")}>
              <ThreadUnderstood thread={thread} />
            </BlockShell>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {planExists && (
          <motion.div key="plan" {...threadBirthVariants(reducedMotion)}>
            <BlockShell title={thread.clarification ? "Clarify" : "Plan"} collapsedSummary={planSummary} collapsed={planCollapsed} onToggle={() => toggle("plan")}>
              {thread.clarification ? <ThreadClarify thread={thread} onAnswer={onAnswer} onSkip={onSkip} onCancel={onCancel} /> : <ThreadPlan thread={thread} reducedMotion={reducedMotion} />}
            </BlockShell>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {executionExists && (
          <motion.div key="execution" {...threadBirthVariants(reducedMotion)}>
            <BlockShell title="Execution" collapsedSummary={executionSummary} collapsed={executionCollapsed} onToggle={() => toggle("execution")}>
              <ThreadExecution thread={thread} />
            </BlockShell>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeIndex >= 4 && (
          <motion.div key="receipt" {...threadBirthVariants(reducedMotion)}>
            <div className="j-panel-hot rounded-xl border border-white/10 p-4">
              <ThreadReceipt thread={thread} reducedMotion={reducedMotion} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function useThreadKernel() {
  return useKernel()
}
