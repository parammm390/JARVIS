"use client"

// D2 — the physical Approval Cockpit (Bridge's real replacement for the legacy
// ApprovalDock in the strangler's own right rail; ApprovalDock itself is left
// completely untouched — it's still what the legacy /jarvis Shell renders, and C1.T4's
// snapshot suite protects it, per hard rule #8). Mounted only in Bridge.tsx, which
// already gates the whole route behind a real signed-in session — no SignInPrompt
// duplication needed here.
//
// D2.T1: RiskBadge materials (C3), price-book provenance + grounded-payload badges as
// the "diff preview" (see finnor-os/apps/api/lib/price-book-provenance.ts for why this
// is scoped to price-book comparison, not a generic 41-action-type diff engine —
// that's D3's renderer-registry job), critic chip (real, async, honestly null when no
// AWS_BEDROCK_API_KEY is configured), and a real 3D hover tilt. Policy-drift (B6) and
// predicted-receipt (B2) fields don't exist anywhere in this codebase yet (grepped,
// confirmed) — this file renders both as optional-chained no-ops so they light up the
// moment those phases ship, never a fabricated placeholder in the meantime.
//
// D2.T2: FLOW-10 StampApprove on confirm, FLOW-13 FlyToDock (shared layoutId) from the
// card into a small "Executing" dock, FLOW-11 ShatterReject on reject, FLOW-12 DeckFan
// for the batch-select preview strip, FLOW-25 ShakeDeny when Approve is attempted on a
// blocked_integration_unavailable action (the one status decide() will actually 409 on
// — needs_human_review IS approvable, per FinnorOrchestrator.decide()'s own
// fromStatuses, so it does NOT get the shake treatment).
//
// D2.T3: real roving tabindex (a genuinely new pattern in this codebase — grepped,
// confirmed nothing here does this yet; closest precedent, CommandPalette's index-only
// highlight, deliberately not followed since the plan asks for real focus movement).
// j/k move focus, Enter opens the receipt/critic drawer, a/r decide, u undoes the most
// recent approval within its window.
//
// D2.T4: honest undo via POST actions/:id/revert (new route, finnor-os/apps/api/app/
// api/actions/[id]/revert/route.ts). Real, important finding, documented in full in
// the D2 STATE block: FinnorOrchestrator.decide() calls runAction() SYNCHRONOUSLY in
// the same request that approves an action, and runAction()'s own atomic UPDATE claims
// approved -> executing before that request even returns — so for every action type
// today, the "approved and unclaimed" window this button targets is sub-millisecond by
// the time a human could ever click it. This toast/undo is built exactly as specified
// and will almost always, honestly, land on "already claimed" — not a bug, an accurate
// reflection of today's synchronous approve-then-execute architecture (a real subject
// for Param/a future backend phase, not something to improvise around here).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion"
import { Check, X, AlertTriangle, ChevronDown, ShieldAlert, Undo2, Ban } from "lucide-react"

import { sfx } from "../sound"
import { useJarvis, ageLabel, type PendingAction } from "../lib/data-core"
import { jarvisPost, JarvisApiError } from "../lib/api"
import { ReceiptDrawer } from "../lib/ReceiptDrawer"
import { RiskBadge, type RiskTier } from "../ui/primitives/RiskBadge"
import { Flight } from "../ui/motion/primitives"
import { choreo } from "../ui/motion/choreo"

// ---------------------------------------------------------------------------
// Small local helpers (deliberately not imported from ApprovalDock.tsx — that file is
// the legacy panel this session leaves untouched, per hard rule #8).
// ---------------------------------------------------------------------------

function GroundedBadge({ field, status }: { field: string; status: string }) {
  const cls = status === "verified" ? "bg-teal-300/12 text-teal-200" : status === "not_found" ? "bg-red-400/12 text-red-300" : "bg-white/8 text-white/50"
  const mark = status === "verified" ? "✓" : status === "not_found" ? "✗" : "?"
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${cls}`}>
      {mark} {field}
    </span>
  )
}

function riskRank(tier: RiskTier | undefined): number {
  return tier === "high" ? 2 : tier === "medium" ? 1 : 0
}

const RANK_TO_TIER: RiskTier[] = ["low", "medium", "high"]

type Verb = "confirm" | "reject" | "escalate"
type CockpitAction = PendingAction & { kind: "pending" | "blocked" }

// ---------------------------------------------------------------------------
// 3D hover tilt — decorative spectacle, honored reduced-motion by simply never
// engaging the pointer handlers (hard rule #10's spirit: effects pause/disable
// rather than half-animate for a reduced-motion visitor).
// ---------------------------------------------------------------------------
function useTilt(reduced: boolean) {
  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const springX = useSpring(rotateX, { stiffness: 300, damping: 30 })
  const springY = useSpring(rotateY, { stiffness: 300, damping: 30 })

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (reduced) return
      const rect = e.currentTarget.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width - 0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5
      rotateY.set(px * 8)
      rotateX.set(py * -8)
    },
    [reduced, rotateX, rotateY],
  )
  const onMouseLeave = useCallback(() => {
    rotateX.set(0)
    rotateY.set(0)
  }, [rotateX, rotateY])

  return { rotateX: springX, rotateY: springY, onMouseMove, onMouseLeave }
}

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------
function ApprovalCard({
  action,
  index,
  focused,
  batchMode,
  selected,
  shaking,
  onToggleSelect,
  onFocus,
  onDecide,
  onOpenReceipt,
  cardRef,
  reduced,
}: {
  action: CockpitAction
  index: number
  focused: boolean
  batchMode: boolean
  selected: boolean
  shaking: boolean
  onToggleSelect: (id: string) => void
  onFocus: (i: number) => void
  onDecide: (a: CockpitAction, verb: Verb) => void
  onOpenReceipt: (id: string) => void
  cardRef: (el: HTMLDivElement | null) => void
  reduced: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const tilt = useTilt(reduced)
  const tier: RiskTier = (action.receipt?.riskTier as RiskTier) ?? "low"
  const isUnavailable = action.status === "blocked_integration_unavailable"
  const isNeedsReview = action.status === "needs_human_review"

  return (
    <motion.div
      ref={cardRef}
      layoutId={`approval-card-${action.id}`}
      layout
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocus(index)}
      role="group"
      aria-label={`${action.actionType.replaceAll("_", " ")} — ${tier} risk`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -60 }}
      transition={{ duration: 0.3 }}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      style={{ perspective: 800 }}
      className={`relative overflow-hidden rounded-xl border p-3 outline-none transition-colors ${
        focused ? "border-cyan-300/60 ring-2 ring-cyan-300/30" : "border-white/10"
      } ${isUnavailable ? "bg-white/[0.015] opacity-70" : "bg-white/[0.02]"}`}
    >
      <motion.div
        style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformStyle: "preserve-3d" }}
        variants={reduced ? choreo.shakeDeny.reducedVariants : choreo.shakeDeny.variants}
        initial="initial"
        animate={shaking ? "animate" : "initial"}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">
          <span className="flex items-center gap-1.5">
            {batchMode && !isUnavailable && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(action.id)}
                className="h-3 w-3 accent-cyan-400"
                aria-label="Select for batch decision"
              />
            )}
            {action.actionType.replaceAll("_", " ")}
          </span>
          <span>{ageLabel(action.createdAt, Date.now())}</span>
        </div>

        <div className="text-[12px] leading-relaxed text-[color:var(--j-text)]">{action.summary ?? "Drafted action awaiting approval."}</div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <RiskBadge tier={tier} />
          {isNeedsReview && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/12 px-2 py-0.5 text-[9px] font-black text-amber-200">
              <ShieldAlert className="h-2.5 w-2.5" /> needs human review
            </span>
          )}
          {isUnavailable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-400/14 px-2 py-0.5 text-[9px] font-black text-red-300">
              <Ban className="h-2.5 w-2.5" /> integration unavailable
            </span>
          )}
          {action.receipt?.policyApplied && (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/50">policy v{action.receipt.policyApplied.version}</span>
          )}
          {action.critic && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black ${
                action.critic.flagged ? "bg-red-400/14 text-red-300" : "bg-teal-300/12 text-teal-200"
              }`}
              aria-expanded={expanded}
            >
              {action.critic.flagged ? "critic flagged" : "critic cleared"}
              <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {/* B6 policy drift — doesn't exist anywhere in this codebase yet (grepped,
              confirmed); renders the moment that phase adds the field. */}
          {(action as { policyDrift?: { fromVersion: number; toVersion: number } }).policyDrift && (
            <span className="rounded-full bg-violet-400/14 px-2 py-0.5 text-[9px] font-black text-violet-300">policy drift</span>
          )}
          {/* B2 predicted receipt — same honest absence. */}
          {(action.receipt as { predicted?: unknown } | undefined)?.predicted != null && (
            <span className="rounded-full bg-cyan-300/12 px-2 py-0.5 text-[9px] font-black text-cyan-200">predicted totals</span>
          )}
          {action.receipt && (
            <button
              type="button"
              onClick={() => onOpenReceipt(action.receipt!.id)}
              className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-black text-white/40 hover:text-cyan-200"
            >
              Why?
            </button>
          )}
        </div>

        {/* Diff preview: grounded-payload verification + price-book provenance. */}
        {(action.groundedPayload?.length || action.priceBookProvenance?.length) ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {action.groundedPayload?.map((g) => <GroundedBadge key={g.field} field={g.field} status={g.status} />)}
            {action.priceBookProvenance?.map((p) => (
              <span
                key={p.sku}
                title={`price book: $${p.priceBookPriceUsd.toFixed(2)} · proposed: ${p.payloadPriceUsd === null ? "n/a" : `$${p.payloadPriceUsd.toFixed(2)}`}`}
                className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                  p.matches === false ? "bg-amber-300/12 text-amber-200" : "bg-white/8 text-white/50"
                }`}
              >
                {p.matches === false ? "override" : "matches price book"} · {p.sku}
              </span>
            ))}
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {expanded && action.critic && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[10px] leading-relaxed text-[color:var(--j-text-dim)]">
                {action.critic.reason}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!batchMode && (
          <div className="mt-2 flex gap-2">
            <motion.button
              onClick={() => onDecide(action, "confirm")}
              whileTap={{ scale: 0.96 }}
              aria-disabled={isUnavailable}
              title={isUnavailable ? "Integration unavailable — can't execute yet" : undefined}
              className={`inline-flex items-center gap-1 rounded-full bg-teal-300 px-3 py-1 text-[10px] font-black text-slate-950 shadow-[var(--j-glow-teal)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
                isUnavailable ? "opacity-40 hover:translate-y-0" : ""
              }`}
            >
              <Check className="h-3 w-3" /> Approve
            </motion.button>
            <motion.button
              onClick={() => onDecide(action, "reject")}
              whileTap={{ scale: 0.96 }}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/70 transition hover:-translate-y-0.5 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <X className="h-3 w-3" /> Reject
            </motion.button>
            <motion.button
              onClick={() => onDecide(action, "escalate")}
              whileTap={{ scale: 0.96 }}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/50 transition hover:-translate-y-0.5 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <AlertTriangle className="h-3 w-3" /> Escalate
            </motion.button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Executing dock — FLOW-13 FlyToDock landing zone. Items appear here the instant a
// card's layoutId unmounts from the list (shared-layout flight, framer-motion's own
// mechanism), then self-expire ~1.6s later (well past StampApprove's 0.32s + the
// stiff-spring flight settling).
// ---------------------------------------------------------------------------
function ExecutingDock({ flights }: { flights: Array<{ id: string; actionType: string }> }) {
  if (flights.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-teal-300/20 bg-teal-300/[0.04] p-2">
      <span className="w-full text-[8.5px] font-black uppercase tracking-widest text-teal-300/70">Executing</span>
      {flights.map((f) => (
        <Flight key={f.id} layoutId={`approval-card-${f.id}`} className="rounded-full bg-teal-300/15 px-2.5 py-1 text-[9.5px] font-bold text-teal-200">
          {f.actionType.replaceAll("_", " ")}
        </Flight>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reject ghost — FLOW-11 ShatterReject, played over a fixed-position overlay pinned to
// the rejected card's own last screen rect (captured at click time). Kept decoupled
// from AnimatePresence's own array-membership exit (which still plays its own plain
// fade+slide on the real card underneath) because framer-motion's `exit` prop is fixed
// at mount time per child key — there's no clean way to swap it per-verb on a shared
// list item without fighting that, and this session's time is better spent on a
// real, independently-verifiable effect than reverse-engineering framer internals.
// ---------------------------------------------------------------------------
function RejectGhost({ rect, label, reduced }: { rect: DOMRect; label: string; reduced: boolean }) {
  const v = reduced ? choreo.shatterReject.reducedVariants : choreo.shatterReject.variants
  return (
    <motion.div
      variants={v}
      initial="initial"
      animate="animate"
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 55 }}
      className="pointer-events-none flex items-center justify-center rounded-xl border border-red-400/40 bg-red-400/10 text-[11px] font-black text-red-300"
    >
      REJECTED — {label.replaceAll("_", " ")}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Approve stamp — FLOW-10 StampApprove, same fixed-overlay-on-last-rect technique as
// RejectGhost. Plays first (320ms), then the card's shared layoutId flight (FLOW-13)
// carries it into the Executing dock — matching the plan's literal sequence "stamp →
// flight to executing dock."
// ---------------------------------------------------------------------------
function ApproveStamp({ rect, label, reduced }: { rect: DOMRect; label: string; reduced: boolean }) {
  const v = reduced ? choreo.stampApprove.reducedVariants : choreo.stampApprove.variants
  return (
    <motion.div
      variants={v}
      initial="initial"
      animate="animate"
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 55 }}
      className="pointer-events-none flex items-center justify-center rounded-xl border border-teal-300/50 bg-teal-300/15 text-[11px] font-black text-teal-200"
    >
      APPROVED — {label.replaceAll("_", " ")}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Undo toast — D2.T4
// ---------------------------------------------------------------------------
function UndoToast({
  actionType,
  msLeft,
  status,
  onUndo,
}: {
  actionType: string
  msLeft: number
  status: "waiting" | "reverting" | "reverted" | "already-claimed"
  onUndo: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#0a1220] px-4 py-2 text-[11px] font-bold text-white shadow-2xl"
    >
      {status === "waiting" && (
        <>
          <span>
            Approved <span className="text-white/50">{actionType.replaceAll("_", " ")}</span>
          </span>
          <button onClick={onUndo} className="inline-flex items-center gap-1 rounded-full bg-cyan-300/15 px-2.5 py-1 text-cyan-200 hover:bg-cyan-300/25">
            <Undo2 className="h-3 w-3" /> Undo ({Math.ceil(msLeft / 1000)}s)
          </button>
        </>
      )}
      {status === "reverting" && <span className="text-white/60">Undoing…</span>}
      {status === "reverted" && <span className="text-teal-300">Undone — back in the queue.</span>}
      {status === "already-claimed" && <span className="text-amber-300">Already claimed — it&rsquo;s executing, can&rsquo;t undo.</span>}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Cockpit
// ---------------------------------------------------------------------------
const UNDO_WINDOW_MS = 5000

export function ApprovalCockpit() {
  const data = useJarvis()
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false

  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchConfirmText, setBatchConfirmText] = useState("")
  const [flights, setFlights] = useState<Array<{ id: string; actionType: string }>>([])
  const [rejectGhosts, setRejectGhosts] = useState<Array<{ id: string; rect: DOMRect; label: string }>>([])
  const [approveStamps, setApproveStamps] = useState<Array<{ id: string; rect: DOMRect; label: string }>>([])
  const [undo, setUndo] = useState<{ id: string; actionType: string; expiresAt: number; status: "waiting" | "reverting" | "reverted" | "already-claimed" } | null>(
    null,
  )
  const [now, setNow] = useState(Date.now())
  const [shakeId, setShakeId] = useState<string | null>(null)

  const inflight = useRef<Set<string>>(new Set())
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  const items: CockpitAction[] = useMemo(() => {
    const pending = data.pendingActions.filter((a) => !hidden.has(a.id)).map((a) => ({ ...a, kind: "pending" as const }))
    const blocked = data.blockedActions.filter((a) => !hidden.has(a.id)).map((a) => ({ ...a, kind: "blocked" as const }))
    return [...pending, ...blocked].slice(0, 10)
  }, [data.pendingActions, data.blockedActions, hidden])

  useEffect(() => {
    if (focusedIndex >= items.length) setFocusedIndex(Math.max(0, items.length - 1))
  }, [items.length, focusedIndex])

  useEffect(() => {
    cardRefs.current[focusedIndex]?.focus()
  }, [focusedIndex])

  // 5s undo countdown + auto-clear once the window lapses.
  useEffect(() => {
    if (!undo || undo.status !== "waiting") return
    const tick = window.setInterval(() => setNow(Date.now()), 200)
    const expire = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(expire)
    }
  }, [undo])

  // Executing-dock chips self-expire once the flight has clearly landed.
  useEffect(() => {
    if (flights.length === 0) return
    const t = window.setTimeout(() => setFlights((prev) => prev.slice(1)), 1600)
    return () => window.clearTimeout(t)
  }, [flights])

  // Reject ghosts self-expire once the shatter animation has clearly finished.
  useEffect(() => {
    if (rejectGhosts.length === 0) return
    const t = window.setTimeout(() => setRejectGhosts((prev) => prev.slice(1)), reduced ? 250 : 500)
    return () => window.clearTimeout(t)
  }, [rejectGhosts, reduced])

  // Approve stamps self-expire once StampApprove's own animation has finished.
  useEffect(() => {
    if (approveStamps.length === 0) return
    const t = window.setTimeout(() => setApproveStamps((prev) => prev.slice(1)), reduced ? 0 : 320)
    return () => window.clearTimeout(t)
  }, [approveStamps, reduced])

  const decide = useCallback(
    async (action: CockpitAction, verb: Verb) => {
      // FLOW-25 ShakeDeny: confirm() will 409 on a blocked_integration_unavailable
      // action (decide()'s own fromStatuses only ever include pending/needs_human_
      // review — see finnor-os/packages/orchestration/src/index.ts) — caught here,
      // once, so both the mouse Approve button and the keyboard "a" shortcut shake
      // the SAME way instead of one silently no-oping (a real bug this session's live
      // verification caught: a `disabled` button blocks its own click handler, so a
      // shake trigger living only inside that handler was unreachable by mouse at all).
      if (verb === "confirm" && action.status === "blocked_integration_unavailable") {
        setShakeId(action.id)
        window.setTimeout(() => setShakeId((cur) => (cur === action.id ? null : cur)), 260)
        return
      }
      if (inflight.current.has(action.id)) return
      inflight.current.add(action.id)
      if (verb === "confirm") {
        sfx.approve()
        const idx = items.findIndex((x) => x.id === action.id)
        const rect = cardRefs.current[idx]?.getBoundingClientRect()
        if (rect) setApproveStamps((s) => [...s, { id: action.id, rect, label: action.actionType }])
        setFlights((f) => [...f, { id: action.id, actionType: action.actionType }])
      } else if (verb === "reject") {
        sfx.reject()
        const idx = items.findIndex((x) => x.id === action.id)
        const rect = cardRefs.current[idx]?.getBoundingClientRect()
        if (rect) setRejectGhosts((g) => [...g, { id: action.id, rect, label: action.actionType }])
      }
      if (verb !== "escalate") setHidden((h) => new Set(h).add(action.id))
      try {
        await jarvisPost(`actions/${action.id}/${verb}`, {})
        data.recordDecision(verb)
        if (verb === "confirm") {
          setUndo({ id: action.id, actionType: action.actionType, expiresAt: Date.now() + UNDO_WINDOW_MS, status: "waiting" })
        }
      } catch (e) {
        setHidden((h) => {
          const next = new Set(h)
          next.delete(action.id)
          return next
        })
        setFlights((f) => f.filter((x) => x.id !== action.id))
        setError(e instanceof Error ? e.message : "Decision failed — action is back in the queue.")
      } finally {
        inflight.current.delete(action.id)
      }
    },
    [data, items],
  )

  const undoNow = useCallback(async () => {
    if (!undo || undo.status !== "waiting") return
    setUndo((u) => (u ? { ...u, status: "reverting" } : u))
    try {
      await jarvisPost(`actions/${undo.id}/revert`, {})
      data.injectOptimisticPending([
        { id: undo.id, actionType: undo.actionType, summary: null, payload: {}, status: "pending", createdAt: new Date().toISOString() },
      ])
      setUndo((u) => (u ? { ...u, status: "reverted" } : u))
      window.setTimeout(() => setUndo(null), 2000)
    } catch (e) {
      if (e instanceof JarvisApiError && e.status === 409) {
        setUndo((u) => (u ? { ...u, status: "already-claimed" } : u))
      } else {
        setUndo((u) => (u ? { ...u, status: "already-claimed" } : u))
      }
      window.setTimeout(() => setUndo(null), 2500)
    }
  }, [undo, data])

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedItems = items.filter((a) => selected.has(a.id) && a.status !== "blocked_integration_unavailable")
  const batchHighestTier = selectedItems.reduce((acc, a) => Math.max(acc, riskRank(a.receipt?.riskTier as RiskTier | undefined)), 0)
  const batchNeedsTypedConfirm = batchHighestTier === 2 // any selected item is high-tier
  const batchCanSubmit = selectedItems.length > 0 && (!batchNeedsTypedConfirm || batchConfirmText.trim().toUpperCase() === "APPROVE")

  async function submitBatch() {
    if (!batchCanSubmit) return
    const targets = [...selectedItems]
    setSelected(new Set())
    setBatchConfirmText("")
    for (const a of targets) {
      void decide(a, "confirm")
    }
  }

  function onContainerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return
    if (items.length === 0) return
    const current = items[focusedIndex]
    if (e.key === "j") {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === "k") {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (current?.receipt) setOpenReceiptId(current.receipt.id)
    } else if (e.key === "a" && current) {
      e.preventDefault()
      void decide(current, "confirm")
    } else if (e.key === "r" && current) {
      e.preventDefault()
      void decide(current, "reject")
    } else if (e.key === "u") {
      e.preventDefault()
      void undoNow()
    }
  }

  const msLeft = undo ? Math.max(0, undo.expiresAt - now) : 0

  return (
    <div id="approval-cockpit" ref={containerRef} onKeyDown={onContainerKeyDown} className="j-panel scroll-mt-4">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Awaiting Your Approval</span>
        <div className="flex items-center gap-2">
          {items.length > 0 && <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[10px] font-black text-cyan-200">{items.length}</span>}
          <button
            type="button"
            onClick={() => {
              setBatchMode((b) => !b)
              setSelected(new Set())
            }}
            className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
              batchMode ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-200" : "border-white/15 text-white/50 hover:text-white/80"
            }`}
          >
            {batchMode ? "Done" : "Select"}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
        <ExecutingDock flights={flights} />

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {items.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-6 text-center text-[12px] text-[color:var(--j-text-dim)]"
              >
                Nothing needs you. Finnor is holding the line.
              </motion.div>
            )}
            {items.map((a, i) => (
              <ApprovalCard
                key={a.id}
                action={a}
                index={i}
                focused={i === focusedIndex}
                batchMode={batchMode}
                selected={selected.has(a.id)}
                shaking={shakeId === a.id}
                onToggleSelect={toggleSelect}
                onFocus={setFocusedIndex}
                onDecide={decide}
                onOpenReceipt={setOpenReceiptId}
                cardRef={(el) => {
                  cardRefs.current[i] = el
                }}
                reduced={reduced}
              />
            ))}
          </AnimatePresence>
        </div>

        {batchMode && selectedItems.length > 0 && (
          <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.04] p-3">
            <div className="mb-2 flex items-center gap-1">
              {selectedItems.slice(0, 5).map((a, i) => (
                <motion.div
                  key={a.id}
                  variants={reduced ? choreo.deckFan.reducedVariants : choreo.deckFan.variants}
                  initial="initial"
                  animate="animate"
                  style={{ rotate: (i - selectedItems.length / 2) * 6, marginLeft: i === 0 ? 0 : -18 }}
                  className="h-8 w-12 rounded-md border border-white/15 bg-white/8"
                />
              ))}
              <span className="ml-3 text-[11px] font-bold text-white/70">
                {selectedItems.length} selected · <RiskBadge tier={RANK_TO_TIER[batchHighestTier]} />
              </span>
            </div>
            {batchNeedsTypedConfirm && (
              <input
                value={batchConfirmText}
                onChange={(e) => setBatchConfirmText(e.target.value)}
                placeholder='High risk in this batch — type "APPROVE" to continue'
                className="mb-2 w-full rounded-lg border border-amber-300/30 bg-black/30 px-2.5 py-1.5 text-[11px] text-white outline-none placeholder:text-white/30 focus:border-amber-300/60"
              />
            )}
            <button
              type="button"
              onClick={submitBatch}
              disabled={!batchCanSubmit}
              className="rounded-full bg-teal-300 px-4 py-1.5 text-[10px] font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve {selectedItems.length}
            </button>
          </div>
        )}
      </div>

      {openReceiptId && <ReceiptDrawer receiptId={openReceiptId} onClose={() => setOpenReceiptId(null)} />}
      <AnimatePresence>
        {undo && <UndoToast actionType={undo.actionType} msLeft={msLeft} status={undo.status} onUndo={undoNow} />}
      </AnimatePresence>
      <AnimatePresence>
        {rejectGhosts.map((g) => (
          <RejectGhost key={g.id} rect={g.rect} label={g.label} reduced={reduced} />
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {approveStamps.map((s) => (
          <ApproveStamp key={s.id} rect={s.rect} label={s.label} reduced={reduced} />
        ))}
      </AnimatePresence>
    </div>
  )
}
