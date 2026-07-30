"use client"

// F1.T2 — FLOW-32 TooltipBloom: hover/focus 400ms delay, scales 0.9->1 from the
// anchor. Reduced motion: appears instantly, no scale. ~80-line hand-roll per the
// plan's own spec (no Radix/Headless UI import — jarvis has none in-tree and this
// doesn't need one).

import { useId, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

export function Tooltip({
  label,
  children,
  side = "top",
  delayMs = 400,
}: {
  label: string
  children: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  delayMs?: number
}) {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  function show() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), reduced ? 0 : delayMs)
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  const position =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : side === "bottom"
        ? "top-full left-1/2 -translate-x-1/2 mt-1.5"
        : side === "left"
          ? "right-full top-1/2 -translate-y-1/2 mr-1.5"
          : "left-full top-1/2 -translate-y-1/2 ml-1.5"

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            className={`pointer-events-none absolute z-[30] whitespace-nowrap rounded-lg border border-white/12 bg-[#0a1220] px-2 py-1 j-fs-micro font-bold text-white shadow-xl ${position}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
