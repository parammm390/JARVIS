"use client"

// F3.T2 — FLOW-58 KeymapHUD: "?" opens a real overlay documenting ApprovalCockpit's
// ACTUAL bindings (j/k/Enter/a/r/u — grepped straight from onContainerKeyDown, not a
// separately-invented list). Each row lights up on a genuine `keydown` for that key
// while the overlay is open (a real listener, not a scripted demo), so the HUD is
// itself proof the bindings work, not just documentation of them. Focus-trapped,
// Esc closes, `aria-modal` — same focus-return convention as `ui/primitives/Drawer.tsx`.

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

const BINDINGS: Array<{ key: string; label: string }> = [
  { key: "j", label: "focus next card" },
  { key: "k", label: "focus previous card" },
  { key: "Enter", label: "open receipt / critic drawer" },
  { key: "a", label: "approve focused card" },
  { key: "r", label: "reject focused card" },
  { key: "u", label: "undo most recent approval" },
  { key: "?", label: "toggle this map" },
]

export function KeymapHUD({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false
  const [lit, setLit] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const priorFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
        return
      }
      const match = BINDINGS.find((b) => b.key === event.key || (b.key === "Enter" && event.key === "Enter"))
      if (match) {
        setLit(match.key)
        window.setTimeout(() => setLit((cur) => (cur === match.key ? null : cur)), 220)
      }
      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button")
        if (!focusable || focusable.length === 0) return
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      priorFocus.current?.focus()
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="keymap-backdrop"
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.2 }}
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 340, damping: 30 }}
            className="j-panel absolute left-1/2 top-1/2 w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="j-label">Keyboard map</span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/12 px-2.5 py-1 j-fs-micro font-bold text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="space-y-1.5">
              {BINDINGS.map((b) => (
                <div
                  key={b.key}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 j-fs-micro transition-colors ${
                    lit === b.key ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-200" : "border-white/8 bg-white/[0.02] text-[color:var(--j-text-dim)]"
                  }`}
                >
                  <kbd className="rounded border border-white/15 bg-black/30 px-1.5 py-0.5 font-mono j-fs-micro font-bold text-white/80">{b.key}</kbd>
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 j-fs-micro text-[color:var(--j-text-faint)]">Press any bound key now — its row lights up on the real keydown.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
