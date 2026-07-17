"use client"

// Shared owner-key gate for write actions (approve/reject/instruct). The page is
// public and fully readable; anything that writes to the real backend asks once for
// the admin key (kept in localStorage only), never auto-submits, never sent anywhere
// but this page's own /api/jarvis proxy.

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Lock } from "lucide-react"
import { setJarvisKey } from "./api"

export function AdminKeyPrompt({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState("")
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
            <Lock className="h-4 w-4 text-[color:var(--j-cyan)]" /> Owner key required
          </div>
          <p className="mb-3 text-[12px] text-[color:var(--j-text-dim)]">
            This action writes to the real system. Enter the owner key to approve, reject, or instruct — the page stays fully readable without it.
          </p>
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                setJarvisKey(value.trim())
                onSaved()
              }
            }}
            className="mb-3 h-10 w-full rounded-xl border border-white/12 bg-slate-900 px-3 text-[13px] text-white focus:border-[color:var(--j-border-hot)] focus:outline-none"
            placeholder="Owner key"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-full border border-white/12 px-4 py-1.5 text-[11px] font-bold text-white/60 hover:text-white">
              Cancel
            </button>
            <button
              onClick={() => {
                if (!value.trim()) return
                setJarvisKey(value.trim())
                onSaved()
              }}
              className="rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 hover:bg-teal-200"
            >
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
