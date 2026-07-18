"use client"

// Phase 1.4 replacement for AdminKeyPrompt: writes now require a real signed-in
// session (the backend's own RBAC decides what that user can actually approve),
// not a shared owner key. Sign-in happens on its own page since it's a real
// email+password form, not a single field — this just points there.

import { AnimatePresence, motion } from "framer-motion"
import { Lock } from "lucide-react"
import Link from "next/link"

export function SignInPrompt({ onClose }: { onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl border border-[color:var(--j-border)] bg-slate-950 p-5"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-[color:var(--j-text)]">
            <Lock className="h-4 w-4 text-[color:var(--j-cyan)]" /> Sign in required
          </div>
          <p className="mb-4 text-[12px] text-[color:var(--j-text-dim)]">
            This action writes to the real system — sign in to approve, reject, or instruct. The page stays fully readable without it.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-full border border-white/12 px-4 py-1.5 text-[11px] font-bold text-white/60 hover:text-white">
              Cancel
            </button>
            <Link
              href="/jarvis/login"
              className="rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 hover:bg-teal-200"
            >
              Sign in
            </Link>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
