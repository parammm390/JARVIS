"use client"

// §7.7 — decide() moved from JarvisCommandCenter verbatim in behavior: optimistic
// removal, inflight guard, rollback on error. Gated behind a real sign-in —
// unauthenticated visitors see the queue but Approve/Reject prompts to sign in.
//
// Phase 7 (§7.1, the cockpit's Approval Inbox): each card now also renders its
// embedded DecisionReceipt (policy id+version, risk tier, evidence citations) when
// one exists, a real Escalate verb alongside Approve/Reject, and a "simulated"
// badge for the two action types this tenant's bindings are still emulating
// (payments/esign) — never invented for action types this data can't speak to.

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, X, AlertTriangle, ChevronDown } from "lucide-react"

import { sfx } from "../sound"
import { useJarvis, ageLabel, type PendingAction } from "../lib/data-core"
import { jarvisPost, JarvisApiError } from "../lib/api"
import { hasActiveSession } from "../lib/jarvis-auth"
import { SignInPrompt } from "../lib/SignInPrompt"
import { ReceiptDrawer } from "../lib/ReceiptDrawer"

const RISK_STYLES: Record<string, string> = {
  low: "bg-white/8 text-white/50",
  medium: "bg-amber-300/12 text-amber-200",
  high: "bg-red-400/14 text-red-300",
}

// Action types whose external effect this tenant's bindings still simulate rather
// than genuinely execute — sourced from IntegrationsStatus.bindings, the same real
// field setup/status already reports; only these two are known today (Phase 4's
// remaining emulator bindings), so only these two ever carry the badge.
const SIMULATED_ACTION_TYPES: Record<string, "payments" | "esign"> = {
  create_payment_link: "payments",
  request_signature: "esign",
}

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null)
  const pendingVerb = useRef<{ id: string; verb: "confirm" | "reject" | "escalate" } | null>(null)
  const inflight = useRef<Set<string>>(new Set())

  const visible = data.pendingActions.filter((a) => !hidden.has(a.id))

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function decide(id: string, verb: "confirm" | "reject" | "escalate") {
    if (inflight.current.has(id)) return
    if (!hasActiveSession()) {
      pendingVerb.current = { id, verb }
      setShowKeyPrompt(true)
      return
    }
    inflight.current.add(id)
    // Escalate stays visible in the queue (it's not terminal — the action still
    // needs a human, just flagged) — only confirm/reject remove the card.
    if (verb !== "escalate") setHidden((h) => new Set(h).add(id))
    if (verb === "confirm") sfx.approve()
    else if (verb === "reject") sfx.reject()
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
    <div id="approval-dock" className="j-panel scroll-mt-4">
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
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {a.groundedPayload?.map((g) => <GroundedBadge key={g.field} field={g.field} status={g.status} />)}
                  {a.receipt && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${RISK_STYLES[a.receipt.riskTier] ?? RISK_STYLES.medium}`}>
                      {a.receipt.riskTier} risk
                    </span>
                  )}
                  {a.receipt?.policyApplied && (
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/50">
                      policy v{a.receipt.policyApplied.version}
                    </span>
                  )}
                  {SIMULATED_ACTION_TYPES[a.actionType] && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/12 px-2 py-0.5 text-[9px] font-black text-amber-200">
                      <AlertTriangle className="h-2.5 w-2.5" /> simulated — no real {SIMULATED_ACTION_TYPES[a.actionType] === "payments" ? "charge" : "signature"} yet
                    </span>
                  )}
                  {a.receipt && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(a.id)}
                      className="ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-black text-white/40 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                      aria-expanded={expanded.has(a.id)}
                    >
                      Why? <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded.has(a.id) ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {a.receipt && expanded.has(a.id) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[10px] leading-relaxed text-[color:var(--j-text-dim)]">
                        <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">Objective</div>
                        <div className="mb-2">{a.receipt.objective}</div>
                        {a.receipt.evidence.length > 0 && (
                          <>
                            <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">Evidence</div>
                            <div className="flex flex-wrap gap-1">
                              {a.receipt.evidence.map((e, i) => (
                                <span key={i} title={new Date(e.timestamp).toLocaleString()} className="rounded-full bg-white/6 px-2 py-0.5 text-[9px] text-white/60">
                                  {e.source}:{e.ref}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setOpenReceiptId(a.receipt!.id)}
                          className="mt-2 text-[9px] font-black uppercase tracking-wide text-cyan-300/80 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                        >
                          Open full receipt →
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                  <motion.button
                    onClick={() => decide(a.id, "escalate")}
                    whileTap={{ scale: 0.96 }}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/50 transition hover:-translate-y-0.5 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                  >
                    <AlertTriangle className="h-3 w-3" /> Escalate
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      {showKeyPrompt && (
        <SignInPrompt
          onClose={() => {
            setShowKeyPrompt(false)
            pendingVerb.current = null
          }}
        />
      )}
      {openReceiptId && <ReceiptDrawer receiptId={openReceiptId} onClose={() => setOpenReceiptId(null)} />}
    </div>
  )
}
