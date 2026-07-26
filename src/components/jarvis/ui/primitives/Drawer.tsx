"use client"

// C3.T2 — generic slide-in drawer shell, extracted from lib/ReceiptDrawer.tsx (which
// had this exact backdrop+panel shell inlined, specific to receipts). ReceiptDrawer
// now composes this instead of owning its own copy of the shell chrome — same
// visual output, one implementation. Any future D-track drawer (D4's DLQ row
// detail, D5's household-360) should compose this too rather than re-inlining it.

import { useEffect, useRef, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"

export function Drawer({
  title,
  onClose,
  children,
  widthClassName = "max-w-md",
}: {
  title: string
  onClose: () => void
  children: ReactNode
  widthClassName?: string
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key !== "Tab") return
      const focusable = document.querySelectorAll<HTMLElement>("[data-jarvis-drawer] button:not([disabled]), [data-jarvis-drawer] a[href], [data-jarvis-drawer] input:not([disabled]), [data-jarvis-drawer] [tabindex]:not([tabindex='-1'])")
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("keydown", onKeyDown); priorFocus.current?.focus() }
  }, [onClose])
  return (
    <AnimatePresence>
      <motion.div key="backdrop" className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        key="panel"
        data-jarvis-drawer
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed right-0 top-0 z-[61] h-full w-full ${widthClassName} overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5`}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-[color:var(--j-text)]">{title}</h3>
          <button ref={closeRef} onClick={onClose} className="rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 hover:text-white">
            Close
          </button>
        </div>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
