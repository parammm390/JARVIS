"use client"

// P2.T8 — C-07's fix: `clarification_request` had NO registry entry at all, so
// `ActionRenderer` fell through to `FallbackRenderer` — the amber "unmapped
// action type" card the plan calls "the single worst bug in the product".
//
// This is the GENERIC, read-only rendering of a clarification wherever
// `ActionRenderer` is used (approvals feed, receipts, the Stage catalog) —
// `ActionRendererProps` carries no callback slots by design (payload -> display
// only, the same contract every other registered type honors). It never shows
// Approve/Reject affordances, because a clarification is a question, not a
// gated business action — that distinction is the whole point of C-07.
//
// The Instruction Thread's own interactive Answer/Skip/Cancel form is a
// SEPARATE, Thread-specific component (`bridge/ThreadBlocks.tsx`'s
// `ThreadClarify`) — block ④ itself, not this generic display.

import { HelpCircle } from "lucide-react"
import type { ActionRendererProps } from "./types"

interface ClarificationPayload {
  question?: string
  missingFields?: string[]
  context?: string
}

export function ClarificationScene({ payload, compact }: ActionRendererProps) {
  const p = (payload ?? {}) as ClarificationPayload
  const question = typeof p.question === "string" ? p.question : "JARVIS needs one more thing."
  const missingFields = Array.isArray(p.missingFields) ? p.missingFields.filter((f): f is string => typeof f === "string") : []

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-[color:var(--j-text)]">
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-[color:var(--j-amber)]" />
        <span className="j-fs-sm truncate">{question}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-300/20 bg-amber-400/[.04] p-4">
      <div className="mb-2 flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-[color:var(--j-amber)]" />
        <span className="j-label text-[color:var(--j-amber)]">Question, not an approval</span>
      </div>
      <p className="j-fs-base font-bold text-[color:var(--j-text)]">{question}</p>
      {missingFields.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {missingFields.map((field) => (
            <li key={field} className="j-fs-sm text-[color:var(--j-text-dim)]">
              · {field}
            </li>
          ))}
        </ul>
      )}
      <p className="j-fs-sm mt-3 text-[color:var(--j-text-faint)]">Answer this in the Instruction Thread — not something to approve or reject.</p>
    </div>
  )
}

export default ClarificationScene
