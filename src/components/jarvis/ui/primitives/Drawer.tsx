"use client"

// C3.T2 — generic slide-in drawer shell, extracted from lib/ReceiptDrawer.tsx (which
// had this exact backdrop+panel shell inlined, specific to receipts). ReceiptDrawer
// now composes this instead of owning its own copy of the shell chrome — same
// visual output, one implementation. Any future D-track drawer (D4's DLQ row
// detail, D5's household-360) should compose this too rather than re-inlining it.

import type { ReactNode } from "react"
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
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className={`fixed right-0 top-0 z-[61] h-full w-full ${widthClassName} overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5`}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-[color:var(--j-text)]">{title}</h3>
          <button onClick={onClose} className="rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 hover:text-white">
            Close
          </button>
        </div>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
