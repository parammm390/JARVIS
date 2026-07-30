"use client"

// F1.T2 — FLOW-30 ToastSurface: the one toast shell + manager every jarvis surface
// should use. Extracted from ApprovalCockpit's UndoToast (bridge/ApprovalCockpit.tsx),
// which had this exact bottom-center pill shell inlined, specific to undo. The shell
// (<ToastShell>) now lives here; ApprovalCockpit's UndoToast composes it instead of
// owning its own copy of the chrome — same visual output (identical classNames),
// one implementation. `useToastQueue` adds stack compression + a countdown ring for
// any future generic (non-undo) toast without a second toast system.

import { useCallback, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"

export function ToastShell({
  children,
  index = 0,
}: {
  children: ReactNode
  index?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 1 }}
      animate={{ opacity: 1, y: index * -6, scale: 1 - index * 0.03 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#0a1220] px-4 py-2 j-fs-micro font-bold text-white shadow-2xl"
      style={{ zIndex: 70 - index }}
    >
      {children}
    </motion.div>
  )
}

/** Countdown ring (FLOW-56 UndoRing) — an SVG arc that drains over `durationMs`. */
export function CountdownRing({ msLeft, durationMs, size = 16 }: { msLeft: number; durationMs: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, msLeft / durationMs))
  const r = size / 2 - 1.5
  const c = 2 * Math.PI * r
  const color = pct > 0.5 ? "var(--j-cyan)" : pct > 0.2 ? "var(--j-amber)" : "var(--j-red)"
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.2s linear" }}
      />
    </svg>
  )
}

interface QueuedToast {
  id: number
  content: ReactNode
}

/** Generic toast queue for non-undo surfaces: push(content, ttlMs) shows a stacked,
 * compressed pile of ToastShells that self-clear. Undo keeps its own bespoke state
 * machine in ApprovalCockpit (waiting/reverting/reverted/already-claimed) — this is
 * for one-shot notices, not multi-state flows. */
export function useToastQueue() {
  const [toasts, setToasts] = useState<QueuedToast[]>([])
  const seq = useRef(0)

  const push = useCallback((content: ReactNode, ttlMs = 3000) => {
    const id = seq.current++
    setToasts((prev) => [...prev.slice(-2), { id, content }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttlMs)
  }, [])

  const ToastStack = useCallback(
    () => (
      <AnimatePresence>
        {toasts.map((t, i) => (
          <ToastShell key={t.id} index={toasts.length - 1 - i}>
            {t.content}
          </ToastShell>
        ))}
      </AnimatePresence>
    ),
    [toasts],
  )

  return { push, ToastStack }
}
