"use client"

// jarvis-v3 P5.T8 — "⌘K → recent threads" (§8 P5.T8). Same posture as
// P4.T7's OpsPanel: a single deliberate overlay, never a route, reached only
// from the Command Palette's own nav item. Lists the real active thread plus
// `kernel.threadHistory` (newest-first, already ordered by the kernel — see
// store.tsx's own push-on-new-submission comment); selecting one scrolls the
// real page to that thread's own row (`ThreadStack.tsx` gives every row a
// stable `id`) rather than duplicating its content in a second place.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import type { Thread as ThreadData } from "../kernel/store"
import { summarizeThreadOutcome, threadRowElementId } from "./ThreadStack"

function scrollToThread(threadId: string) {
  document.getElementById(threadRowElementId(threadId))?.scrollIntoView({ behavior: "smooth", block: "start" })
}

export function RecentThreadsPanel({
  open,
  onClose,
  thread,
  threadHistory,
}: {
  open: boolean
  onClose: () => void
  thread: ThreadData | null
  threadHistory: ThreadData[]
}) {
  const reduced = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const all = thread ? [{ ...thread, __active: true } as ThreadData & { __active?: boolean }, ...threadHistory] : threadHistory

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[16vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Recent threads"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-cyan-300/30 bg-[#07101d] shadow-[0_25px_100px_rgba(0,0,0,.6)]"
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 340, damping: 28 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="j-label">Recent threads</span>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full border border-white/15 p-1 text-white/50 hover:text-white/80">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-[55vh] space-y-1 overflow-y-auto p-3">
              {all.length === 0 ? (
                <div className="px-2 py-3 j-fs-micro text-white/45">No threads yet this session.</div>
              ) : (
                all.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      scrollToThread(t.id)
                      onClose()
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-cyan-300/10"
                  >
                    <span className="truncate j-fs-sm text-white">{t.instructionText}</span>
                    <span className="shrink-0 j-fs-micro font-black uppercase tracking-wide text-white/40">
                      {(t as ThreadData & { __active?: boolean }).__active ? "Active" : summarizeThreadOutcome(t.machine.instructionState)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-white/10 px-4 py-2 j-fs-micro uppercase tracking-widest text-white/35">esc close · select to jump</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
