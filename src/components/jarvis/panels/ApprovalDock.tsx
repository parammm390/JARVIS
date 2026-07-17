"use client"

// §7.7 — decide() moved from JarvisCommandCenter verbatim in behavior: optimistic
// removal, inflight guard, rollback on error. Gated behind the owner admin key —
// unauthenticated visitors see the queue but Approve/Reject prompts for the key.

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, X } from "lucide-react"
 
import { sfx } from "../sound"
import { useJarvis, ageLabel, type PendingAction } from "../lib/data-core"
import { jarvisPost, getJarvisKey, JarvisApiError } from "../lib/api"
import { AdminKeyPrompt } from "../lib/AdminKeyPrompt"

function NewCardScanline() {
  const [show, setShow] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 800)
    return () => clearTimeout(t)
  }, [])
  if (!show) return null
  return <span aria-hidden className="jarvis-scanline pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
}

function GroundedBadge({ field, status }: { field: string; status: string }) {
  const cls = status === "verified" ? "bg-teal-300/12 text-teal-200" : status === "not_found" ? "bg-red-400/12 text-red-300" : "bg-white/8 text-white/50"
  const mark = status === "verified" ? "✓" : status === "not_found" ? "✗" : "?"
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${cls}`}>{mark} {field}</span>
}

export function ApprovalDock() {
  const data = useJarvis()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const pendingVerb = useRef<{ id: string; verb: "confirm" | "reject" } | null>(null)
  const inflight = useRef<Set<string>>(new Set())

  const visible = data.pendingActions.filter((a) => !hidden.has(a.id))

  async function decide(id: string, verb: "confirm" | "reject") {
    if (inflight.current.has(id)) return
    if (!getJarvisKey()) {
      pendingVerb.current = { id, verb }
      setShowKeyPrompt(true)
      return
    }
    inflight.current.add(id)
    setHidden((h) => new Set(h).add(id))
    verb === "confirm" ? sfx.approve() : sfx.reject()
    try {
      await jarvisPost(`actions/${id}/${verb}`, {})
      data.recordDecision(verb)
    } catch (e) {
      setHidden((h) => {
        const next = new Set(h)
        next.delete(id)
        return next
      })
      if (e instanceof JarvisApiError && e.status === 401) {
        pendingVerb.current = { id, verb }
        setShowKeyPrompt(true)
      } else {
        setError(e instanceof Error ? e.message : "Decision failed — action is back in the queue.")
      }
    } finally {
      inflight.current.delete(id)
    }
  }

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Awaiting Your Approval</span>
        {visible.length > 0 && <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[10px] font-black text-cyan-200">{visible.length}</span>}
      </div>
      <div className="px-4 py-3">
        {error && (
          <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>
        )}
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]">
                Nothing needs you. Finnor is holding the line.
              </motion.div>
            )}
            {visible.slice(0, 5).map((a: PendingAction) => (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -60 }}
                transition={{ duration: 0.3 }}
                className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <NewCardScanline />
                <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
                  <span>{a.actionType.replaceAll("_", " ")}</span>
                  <span>{ageLabel(a.createdAt, data.now)}</span>
                </div>
                <div className="text-[12px] leading-relaxed text-[color:var(--j-text)]">{a.summary ?? "Drafted action awaiting approval."}</div>
                {a.groundedPayload && a.groundedPayload.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.groundedPayload.map((g) => (
                      <GroundedBadge key={g.field} field={g.field} status={g.status} />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <motion.button
                    onClick={() => decide(a.id, "confirm")}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-300 px-3 py-1 text-[10px] font-black text-slate-950 shadow-[var(--j-glow-teal)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                  >
                    <Check className="h-3 w-3" /> Approve
                  </motion.button>
                  <motion.button
                    onClick={() => decide(a.id, "reject")}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/70 transition hover:-translate-y-0.5 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                  >
                    <X className="h-3 w-3" /> Reject
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      {showKeyPrompt && (
        <AdminKeyPrompt
          onClose={() => {
            setShowKeyPrompt(false)
            pendingVerb.current = null
          }}
          onSaved={() => {
            setShowKeyPrompt(false)
            const p = pendingVerb.current
            pendingVerb.current = null
            if (p) void decide(p.id, p.verb)
          }}
        />
      )}
    </div>
  )
}
