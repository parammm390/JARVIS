"use client"

// jarvis-v3 P4.T7 — "⌘K → Ops": §2.4 "Ops metrics live behind one deliberate
// ⌘K → Ops destination and are never the landing surface" / §8 PHASE 4: "a
// single deliberate destination with the 4 real counts — never a landing
// page, never a grid on the command path." Reached only from the Command
// Palette's own "Ops" nav item (lib/CommandPaletteV2.tsx) — never mounted on
// `/jarvis/next`'s own render path, never a route.
//
// The 4 counts are the SAME §4.7 golden-journey selectors the rest of the
// Thread already reads via useKernel() — no new fact, no second source of
// truth, rendered through the same Metric component (§5.5 truth grammar), so
// a 401/degraded lane veils here exactly like it does everywhere else.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import { useKernel } from "../kernel/store"
import { mapTruth } from "../kernel/selectors"
import { Metric } from "../lib/Metric"

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

export function OpsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const kernel = useKernel()
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
            aria-label="Ops"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-cyan-300/30 bg-[#07101d] shadow-[0_25px_100px_rgba(0,0,0,.6)]"
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 340, damping: 28 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="j-label">Ops</span>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full border border-white/15 p-1 text-white/50 hover:text-white/80">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              <Metric label="Overdue invoices" value={mapTruth(kernel.overdueInvoices, (v) => v.count)} size="sm" />
              <Metric label="Collected" value={kernel.collectedUsd} format={usd} size="sm" />
              <Metric label="Pending approvals" value={kernel.pendingApprovals} size="sm" />
              <Metric label="Runs in flight" value={kernel.runsInFlight} size="sm" />
            </div>
            <div className="border-t border-white/10 px-4 py-2 j-fs-micro uppercase tracking-widest text-white/35">esc close</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
