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
import { ToastShell, CountdownRing } from "../ui/primitives/Toast"
import { Flight, Ticker } from "../ui/motion/primitives"
import { choreo } from "../ui/motion/choreo"
import { EASE } from "../ui/motion/tokens"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { FieldList } from "../lib/field-format"
import { BorderBeam } from "../ui/fx/BorderBeam"
import { registerAnchor, getAnchorRect } from "../lib/pulse-bus"
import { KeymapHUD } from "./KeymapHUD"
import { EmptyState } from "../ui/primitives/EmptyState"
import { ErrorState } from "../ui/primitives/ErrorState"
import { useHapticsEnabled, vibrateIfEnabled, HAPTIC_PATTERNS } from "../lib/haptics"

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

// ---------------------------------------------------------------------------
// F3.T1 — FLOW-50 GateValve: a valve glyph mounted on ApproveStamp/RejectGhost (the
// same fixed-rect overlays that already play at decide-time, since the real card
// they cover unmounts almost immediately once decide() hides it — see D2.T4's
// synchronous-execution finding). Approve rotates the bar open; reject seals it shut.
// ---------------------------------------------------------------------------
export function GateValveGlyph({ variant, reduced }: { variant: "open" | "seal"; reduced: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <motion.line
        x1="2" y1="7" x2="12" y2="7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        initial={{ rotate: 0, opacity: 1 }}
        animate={
          variant === "open"
            ? { rotate: 90, opacity: 1 }
            : { rotate: 0, opacity: reduced ? 0.4 : [1, 0.9, 0.3] }
        }
        transition={{ duration: reduced ? 0 : 0.32, ease: EASE.overshoot }}
        style={{ transformOrigin: "7px 7px" }}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// F3.T1 — FLOW-52 RiskCharge: the card's own RiskBadge material (green glass / amber
// steel / red obsidian, C3) animates ONLY while the card is genuinely hovered or
// keyboard-focused — an ambient-budget-respecting one-shot per hover, never a
// standing loop (hard rule F4). Static at rest, matching the plan's own wording.
// ---------------------------------------------------------------------------
const RISK_CHARGE_GRADIENT: Record<RiskTier, string> = {
  low: "linear-gradient(120deg, transparent, rgba(52,211,153,0.16), transparent)",
  medium: "linear-gradient(120deg, transparent, rgba(245,185,66,0.22), transparent)",
  high: "linear-gradient(120deg, transparent, rgba(248,113,113,0.2), transparent)",
}
export function RiskChargeOverlay({ tier, active, reduced }: { tier: RiskTier; active: boolean; reduced: boolean }) {
  if (!active || reduced) return null
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-xl"
      style={{ background: RISK_CHARGE_GRADIENT[tier], backgroundSize: "200% 100%" }}
      initial={{ backgroundPositionX: "0%", opacity: 0 }}
      animate={{ backgroundPositionX: "100%", opacity: [0, 1, 0] }}
      transition={{ duration: 1.1, ease: "easeInOut" }}
    />
  )
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
  onActivateMobile,
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
  onActivateMobile: (id: string) => void
  cardRef: (el: HTMLDivElement | null) => void
  reduced: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [predictedExpanded, setPredictedExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [diffOpenSku, setDiffOpenSku] = useState<string | null>(null)
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        tilt.onMouseLeave()
      }}
      style={{ perspective: 800 }}
      className={`relative overflow-hidden rounded-xl border p-3 outline-none transition-colors ${
        focused ? "border-cyan-300/60 ring-2 ring-cyan-300/30" : "border-white/10"
      } ${isUnavailable ? "bg-white/[0.015] opacity-70" : "bg-white/[0.02]"}`}
    >
      {/* FLOW-52 RiskCharge: the tier material animates only while genuinely
          hovered/focused — static at rest, per the plan's ambient-budget wording. */}
      <RiskChargeOverlay tier={tier} active={hovered || focused} reduced={reduced} />
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

        {/* D3.T1 — the renderer registry's real scene for this action's payload,
            same ActionRenderer component the Activity Theater (feed) and
            ReceiptDrawer (receipt) contexts use — the plan's own "same renderer
            proven in feed + approval + receipt" wording, not three lookalikes. */}
        <div className="mt-2">
          <ActionRenderer actionType={action.actionType} payload={action.payload} />
        </div>

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
          {/* jarvis-v3 P4.T2 (§6⑤ "predicted outcome from simulate()") — real,
              server-computed prediction, honestly absent for the ~36 action types
              with no flagship simulate(). Expands the same way the critic chip
              already does, not a second new interaction pattern. */}
          {action.predicted != null && (
            <button
              type="button"
              onClick={() => setPredictedExpanded((e) => !e)}
              className="inline-flex items-center gap-1 rounded-full bg-cyan-300/12 px-2 py-0.5 text-[9px] font-black text-cyan-200"
              aria-expanded={predictedExpanded}
            >
              predicted outcome
              <ChevronDown className={`h-2.5 w-2.5 transition-transform ${predictedExpanded ? "rotate-180" : ""}`} />
            </button>
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
            {action.priceBookProvenance?.map((p) =>
              p.matches === false ? (
                // FLOW-53 DiffWipe: an "override" is the one real before/after this
                // cockpit has (D2.T1's own scoped price-book diff) — clicking it wipes
                // in the price-book value vs. the proposed value with a scanline.
                <button
                  key={p.sku}
                  type="button"
                  onClick={() => setDiffOpenSku((cur) => (cur === p.sku ? null : p.sku))}
                  className="rounded-full bg-amber-300/12 px-2 py-0.5 text-[9px] font-black text-amber-200"
                  aria-expanded={diffOpenSku === p.sku}
                >
                  override · {p.sku} {diffOpenSku === p.sku ? "▲" : "▼"}
                </button>
              ) : (
                <span key={p.sku} title={`price book: $${p.priceBookPriceUsd.toFixed(2)}`} className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/50">
                  matches price book · {p.sku}
                </span>
              ),
            )}
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {diffOpenSku &&
            action.priceBookProvenance
              ?.filter((p) => p.sku === diffOpenSku)
              .map((p) => (
                <motion.div key={p.sku} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="relative mt-2 flex items-center gap-3 overflow-hidden rounded-lg border border-amber-300/25 bg-amber-300/[0.04] p-2 text-[11px]">
                    <motion.div
                      aria-hidden
                      initial={{ x: "-100%" }}
                      animate={{ x: "160%" }}
                      transition={{ duration: reduced ? 0 : 0.5, ease: EASE.standard }}
                      className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-amber-200/25 to-transparent"
                    />
                    <span className="text-white/50">price book</span>
                    <span className="font-mono font-bold text-white/80">${p.priceBookPriceUsd.toFixed(2)}</span>
                    <span className="text-white/30">→</span>
                    <span className="text-white/50">proposed</span>
                    <span className="font-mono font-bold text-amber-200">{p.payloadPriceUsd === null ? "n/a" : `$${p.payloadPriceUsd.toFixed(2)}`}</span>
                  </div>
                </motion.div>
              ))}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {expanded && action.critic && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[10px] leading-relaxed text-[color:var(--j-text-dim)]">
                {action.critic.reason}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {predictedExpanded && action.predicted != null && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.03] p-2">
                <FieldList value={action.predicted} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!batchMode && (
          <>
            {/* Desktop: the original 3-pill row, unchanged, precision pointer input. */}
            <div className="mt-2 hidden gap-2 lg:flex">
              <motion.button
                onClick={() => onDecide(action, "confirm")}
                whileTap={{ scale: 0.96 }}
                aria-disabled={isUnavailable}
                title={isUnavailable ? "Integration unavailable — can't execute yet" : undefined}
                className={`inline-flex items-center gap-1 rounded-full bg-teal-300 px-3 py-1 text-[10px] font-black text-slate-950 shadow-[var(--j-glow-teal)] transition hover:-translate-y-0.5 focus-visible:outline-none ${
                  isUnavailable ? "opacity-40 hover:translate-y-0" : ""
                }`}
              >
                <Check className="h-3 w-3" /> Approve
              </motion.button>
              <motion.button
                onClick={() => onDecide(action, "reject")}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/70 transition hover:-translate-y-0.5 hover:text-red-300 focus-visible:outline-none"
              >
                <X className="h-3 w-3" /> Reject
              </motion.button>
              <motion.button
                onClick={() => onDecide(action, "escalate")}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-[10px] font-black text-white/50 transition hover:-translate-y-0.5 hover:text-amber-200 focus-visible:outline-none"
              >
                <AlertTriangle className="h-3 w-3" /> Escalate
              </motion.button>
            </div>
            {/* F10.T2 — mobile one-thumb decisive actions: below `lg`, 3 small pills
                packed together is a precision-pointer layout, not a thumb one. This
                single full-width control replaces them, opening the fixed bottom
                sheet (rendered once in ApprovalCockpit) with the SAME `onDecide`
                calls and the SAME high-risk typed-confirm rule the batch bar already
                enforces — never a second, looser decision path. */}
            <button
              type="button"
              onClick={() => onActivateMobile(action.id)}
              disabled={isUnavailable}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] py-2.5 text-[11px] font-black text-white/80 disabled:opacity-40 lg:hidden"
            >
              Decide <ChevronDown className="h-3 w-3" />
            </button>
          </>
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
    <BorderBeam className="mb-2 rounded-lg"><div className="flex flex-wrap gap-1.5 rounded-lg border border-teal-300/20 bg-teal-300/[0.04] p-2">
      <span className="w-full text-[8.5px] font-black uppercase tracking-widest text-teal-300/70">Executing</span>
      {flights.map((f) => (
        <Flight key={f.id} layoutId={`approval-card-${f.id}`} className="rounded-full bg-teal-300/15 px-2.5 py-1 text-[9.5px] font-bold text-teal-200">
          {f.actionType.replaceAll("_", " ")}
        </Flight>
      ))}
    </div></BorderBeam>
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
      className="pointer-events-none flex items-center justify-center gap-1.5 rounded-xl border border-red-400/40 bg-red-400/10 text-[11px] font-black text-red-300"
    >
      <GateValveGlyph variant="seal" reduced={reduced} />
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
  const inkV = reduced ? choreo.inkBleed.reducedVariants : choreo.inkBleed.variants
  return (
    <motion.div
      variants={v}
      initial="initial"
      animate="animate"
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 55 }}
      className="pointer-events-none flex items-center justify-center gap-1.5 rounded-xl bg-teal-300/15 text-[11px] font-black text-teal-200"
    >
      {/* FLOW-51 InkBleed: the stamp's border bleeds in after the punch settles, then
          crystallizes (holds, no further motion) — a separate layered border so the
          punch (scale/shake) and the bleed (opacity ramp) don't fight the same prop. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-xl border-2 border-teal-300/60"
        variants={inkV}
        initial="initial"
        animate="animate"
      />
      <GateValveGlyph variant="open" reduced={reduced} />
      APPROVED — {label.replaceAll("_", " ")}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// F3.T1 — FLOW-57 EscalateBeacon: a beacon pulse travels from the escalated card
// upward, toward the top of the cockpit's own rail — same fixed-rect-overlay
// technique as ApproveStamp/RejectGhost, pinned at click time, self-expiring once
// the travel finishes.
// ---------------------------------------------------------------------------
export function EscalateBeacon({ rect, reduced }: { rect: DOMRect; reduced: boolean }) {
  const v = reduced ? choreo.escalateBeacon.reducedVariants : choreo.escalateBeacon.variants
  return (
    <motion.div
      variants={v}
      initial="initial"
      animate="animate"
      style={{ position: "fixed", top: rect.top + rect.height / 2 - 4, left: rect.left + 10, zIndex: 55 }}
      className="pointer-events-none flex h-2 w-2 items-center justify-center rounded-full bg-amber-300 shadow-[var(--j-glow-amber)]"
    />
  )
}

// ---------------------------------------------------------------------------
// F3.T1 — FLOW-55 ConsequenceTrail: once an approval lands, a small receipt chip
// flies from the card's own last rect to the real ActivityTheater feed anchor
// (pulse-bus's named registry — the same real "activity-feed" rect EventMeteor
// already draws to), while the header's pending-count Ticker decrements in the same
// beat (the real optimistic hide + eventual refetch, not a fabricated countdown).
// Honest-absent when no feed anchor is mounted (e.g. this component alone on Stage,
// outside the real Bridge) — fades in place instead of flying nowhere.
// ---------------------------------------------------------------------------
export function ConsequenceChip({ rect, label, reduced }: { rect: DOMRect; label: string; reduced: boolean }) {
  const target = getAnchorRect("activity-feed")
  const dx = target ? target.left + target.width / 2 - (rect.left + rect.width / 2) : 0
  const dy = target ? target.top + target.height / 2 - (rect.top + rect.height / 2) : -12
  return (
    <motion.div
      initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      animate={reduced ? { opacity: 0 } : { opacity: [1, 1, 0], x: dx, y: dy, scale: 0.5 }}
      transition={{ duration: reduced ? 0.2 : 0.55, ease: EASE.accelerate }}
      style={{ position: "fixed", top: rect.top + rect.height / 2 - 8, left: rect.left + rect.width / 2 - 8, zIndex: 56 }}
      className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-full bg-cyan-300/80 text-[7px] font-black text-slate-950"
      title={label}
    >
      ✓
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
  durationMs = 5000,
}: {
  actionType: string
  msLeft: number
  status: "waiting" | "reverting" | "reverted" | "already-claimed"
  onUndo: () => void
  durationMs?: number
}) {
  // F1.T2 — shell extracted to ui/primitives/Toast.tsx (ToastShell); identical
  // classNames/output to the pre-F1 inline motion.div, now shared with any future
  // toast consumer. FLOW-56 UndoRing: CountdownRing replaces the plain "(Ns)" text
  // with a draining ring that shifts cyan -> amber -> red; numeric fallback preserved
  // alongside it for reduced-motion/at-a-glance precision (plan's own instruction).
  return (
    <ToastShell>
      {status === "waiting" && (
        <>
          <span>
            Approved <span className="text-white/50">{actionType.replaceAll("_", " ")}</span>
          </span>
          <button onClick={onUndo} className="inline-flex items-center gap-1.5 rounded-full bg-cyan-300/15 px-2.5 py-1 text-cyan-200 hover:bg-cyan-300/25">
            <CountdownRing msLeft={msLeft} durationMs={durationMs} />
            <Undo2 className="h-3 w-3" /> Undo ({Math.ceil(msLeft / 1000)}s)
          </button>
        </>
      )}
      {status === "reverting" && <span className="text-white/60">Undoing…</span>}
      {status === "reverted" && <span className="text-teal-300">Undone — back in the queue.</span>}
      {status === "already-claimed" && <span className="text-amber-300">Already claimed — it&rsquo;s executing, can&rsquo;t undo.</span>}
    </ToastShell>
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
  const [escalateBeacons, setEscalateBeacons] = useState<Array<{ id: string; rect: DOMRect }>>([])
  const [consequenceChips, setConsequenceChips] = useState<Array<{ id: string; rect: DOMRect; label: string }>>([])
  const [keymapOpen, setKeymapOpen] = useState(false)
  const [undo, setUndo] = useState<{ id: string; actionType: string; expiresAt: number; status: "waiting" | "reverting" | "reverted" | "already-claimed" } | null>(
    null,
  )
  const [now, setNow] = useState(Date.now())
  const [shakeId, setShakeId] = useState<string | null>(null)
  // F10.T2 — mobile one-thumb bottom sheet: which single action (if any) is
  // being decided via the mobile-only "Decide" affordance, plus its own typed-
  // confirm text mirroring batchConfirmText's real high-risk gate below.
  const [mobileActiveId, setMobileActiveId] = useState<string | null>(null)
  const [mobileConfirmText, setMobileConfirmText] = useState("")
  const hapticsEnabled = useHapticsEnabled()

  const inflight = useRef<Set<string>>(new Set())
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  // F2.T3 — FLOW-49 ConstellationLink's real target anchor for the "approvals" KPI
  // card (see ConstellationLink.tsx's hand-authored lineage map).
  useEffect(() => registerAnchor("approval-cockpit", () => containerRef.current?.getBoundingClientRect() ?? null), [])

  const items: CockpitAction[] = useMemo(() => {
    const pending = data.pendingActions.filter((a) => !hidden.has(a.id)).map((a) => ({ ...a, kind: "pending" as const }))
    const blocked = data.blockedActions.filter((a) => !hidden.has(a.id)).map((a) => ({ ...a, kind: "blocked" as const }))
    return [...pending, ...blocked].slice(0, 10)
  }, [data.pendingActions, data.blockedActions, hidden])

  useEffect(() => {
    if (focusedIndex >= items.length) setFocusedIndex(Math.max(0, items.length - 1))
  }, [items.length, focusedIndex])

  // B8/D6: the service worker opens /jarvis?approval=<id>. Resolve that opaque id
  // against the live pending list and put keyboard focus on the exact card; a stale
  // notification simply leaves the normal cockpit intact.
  useEffect(() => {
    const approvalId = new URLSearchParams(window.location.search).get("approval")
    if (!approvalId) return
    const index = items.findIndex((item) => item.id === approvalId)
    if (index >= 0) {
      setFocusedIndex(index)
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [items])

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
    // FLOW-51 InkBleed extends the stamp's own life from 320ms to 420ms so the
    // border-bleed-then-crystallize sequence (0.4s) is never cut off mid-animation.
    const t = window.setTimeout(() => setApproveStamps((prev) => prev.slice(1)), reduced ? 0 : 420)
    return () => window.clearTimeout(t)
  }, [approveStamps, reduced])

  // FLOW-57 EscalateBeacon self-expires once its travel animation has finished.
  useEffect(() => {
    if (escalateBeacons.length === 0) return
    const t = window.setTimeout(() => setEscalateBeacons((prev) => prev.slice(1)), reduced ? 300 : 900)
    return () => window.clearTimeout(t)
  }, [escalateBeacons, reduced])

  // FLOW-55 ConsequenceTrail's chip self-expires once its flight has landed.
  useEffect(() => {
    if (consequenceChips.length === 0) return
    const t = window.setTimeout(() => setConsequenceChips((prev) => prev.slice(1)), reduced ? 200 : 550)
    return () => window.clearTimeout(t)
  }, [consequenceChips, reduced])

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
      const idx = items.findIndex((x) => x.id === action.id)
      const cardRect = cardRefs.current[idx]?.getBoundingClientRect() ?? null
      if (verb === "confirm") {
        sfx.approve()
        // F11.T2 — real approve pattern (plan §5: "approve 10ms"). Pref-gated
        // (D6.T1's real `notificationPreferences.haptics`), default off.
        vibrateIfEnabled(hapticsEnabled, HAPTIC_PATTERNS.approve)
        if (cardRect) setApproveStamps((s) => [...s, { id: action.id, rect: cardRect, label: action.actionType }])
        setFlights((f) => [...f, { id: action.id, actionType: action.actionType }])
      } else if (verb === "reject") {
        sfx.reject()
        // F11.T2 — real reject pattern (plan §5: "reject 30ms").
        vibrateIfEnabled(hapticsEnabled, HAPTIC_PATTERNS.reject)
        if (cardRect) setRejectGhosts((g) => [...g, { id: action.id, rect: cardRect, label: action.actionType }])
      } else if (verb === "escalate") {
        if (cardRect) setEscalateBeacons((b) => [...b, { id: action.id, rect: cardRect }])
      }
      if (verb !== "escalate") setHidden((h) => new Set(h).add(action.id))
      try {
        await jarvisPost(`actions/${action.id}/${verb}`, {})
        data.recordDecision(verb)
        if (verb === "confirm") {
          setUndo({ id: action.id, actionType: action.actionType, expiresAt: Date.now() + UNDO_WINDOW_MS, status: "waiting" })
          // FLOW-55 ConsequenceTrail: only once the approval has genuinely landed
          // (this POST resolved) does the receipt chip fly toward the real activity
          // feed — never on the optimistic hide alone.
          if (cardRect) setConsequenceChips((c) => [...c, { id: action.id, rect: cardRect, label: action.actionType }])
        }
      } catch (e) {
        setHidden((h) => {
          const next = new Set(h)
          next.delete(action.id)
          return next
        })
        setFlights((f) => f.filter((x) => x.id !== action.id))
        setError(e instanceof Error ? e.message : "Decision failed — action is back in the queue.")
        // F11.T2 — real error pattern (plan §5: "error 10-30-10").
        vibrateIfEnabled(hapticsEnabled, HAPTIC_PATTERNS.error)
      } finally {
        inflight.current.delete(action.id)
      }
    },
    [data, items, hapticsEnabled],
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

  // F10.T2 — the mobile bottom sheet's own target + the SAME typed-confirm rule
  // (riskRank tier "high") batchNeedsTypedConfirm already enforces, applied at
  // the single-action level so moving decisive actions into this sheet on
  // mobile never loosens what desktop's batch bar already requires.
  const mobileActiveAction = items.find((a) => a.id === mobileActiveId) ?? null
  const mobileNeedsTypedConfirm = riskRank(mobileActiveAction?.receipt?.riskTier as RiskTier | undefined) === 2
  const mobileCanApprove = !mobileNeedsTypedConfirm || mobileConfirmText.trim().toUpperCase() === "APPROVE"
  function decideMobile(verb: Verb) {
    if (!mobileActiveAction) return
    void decide(mobileActiveAction, verb)
    setMobileActiveId(null)
    setMobileConfirmText("")
  }

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
    // FLOW-58 KeymapHUD: real keydown, independent of whether any card is focused.
    if (e.key === "?") {
      e.preventDefault()
      setKeymapOpen(true)
      return
    }
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
          {items.length > 0 && (
            <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[10px] font-black text-cyan-200">
              {/* FLOW-55 ConsequenceTrail: the pending-count odometer, real refetch-driven */}
              <Ticker value={items.length} />
            </span>
          )}
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
        {/* F6.T3 — FLOW-89 ErrorFracture: real decide()-POST failure. "Retry" dismisses
            the banner rather than replaying the POST itself — the failed action is
            already restored to the visible queue above (the `hidden` rollback a few
            lines up), so the honest next step is a fresh click, not a hidden re-fire. */}
        {error && <ErrorState message={error} onRetry={() => setError(null)} />}
        <ExecutingDock flights={flights} />

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {items.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <EmptyState family="approvals" title="Nothing needs you" description="Finnor is holding the line — approvals land here the moment something needs a human." />
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
                onActivateMobile={(id) => {
                  setMobileActiveId(id)
                  setMobileConfirmText("")
                }}
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
                // FLOW-54 BatchDeckShuffle: `layout` (on top of D2's own DeckFan
                // scale/opacity variant) springs each card into its new fanned slot
                // as the real selection set changes — the "magnetize together" the
                // plan asks for, driven by genuine (de)selection, not a scripted demo.
                <motion.div
                  key={a.id}
                  layout
                  variants={reduced ? choreo.deckFan.reducedVariants : choreo.deckFan.variants}
                  initial="initial"
                  animate="animate"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 30 }}
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

      {/* F10.T2 — mobile one-thumb bottom sheet. `lg:hidden` (desktop never
          mounts this, even if `mobileActiveId` were somehow set); real actions
          only, same `decide()` as every other entry point (keyboard j/k/Enter/
          a/r/u, mouse pills, batch bar). */}
      <AnimatePresence>
        {mobileActiveAction && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Decide: ${mobileActiveAction.actionType.replaceAll("_", " ")}`}
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-white/12 bg-[#05090f] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[0_-8px_30px_rgba(0,0,0,0.5)] lg:hidden"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">{mobileActiveAction.actionType.replaceAll("_", " ")}</div>
                <div className="mt-0.5 text-[12px] text-[color:var(--j-text)]">{mobileActiveAction.summary ?? "Drafted action awaiting approval."}</div>
              </div>
              <button type="button" onClick={() => setMobileActiveId(null)} aria-label="Close" className="shrink-0 rounded-full border border-white/15 p-1 text-white/50">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {mobileNeedsTypedConfirm && (
              <input
                autoFocus
                value={mobileConfirmText}
                onChange={(e) => setMobileConfirmText(e.target.value)}
                placeholder='High risk — type "APPROVE" to continue'
                className="mb-2 w-full rounded-lg border border-amber-300/30 bg-black/30 px-2.5 py-2 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-amber-300/60"
              />
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => decideMobile("confirm")}
                disabled={!mobileCanApprove}
                className="flex items-center justify-center gap-1 rounded-xl bg-teal-300 py-3 text-[12px] font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-4 w-4" /> Approve
              </button>
              <button
                type="button"
                onClick={() => decideMobile("reject")}
                className="flex items-center justify-center gap-1 rounded-xl border border-white/15 py-3 text-[12px] font-black text-white/80"
              >
                <X className="h-4 w-4" /> Reject
              </button>
              <button
                type="button"
                onClick={() => decideMobile("escalate")}
                className="flex items-center justify-center gap-1 rounded-xl border border-white/15 py-3 text-[12px] font-black text-white/60"
              >
                <AlertTriangle className="h-4 w-4" /> Escalate
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {openReceiptId && <ReceiptDrawer receiptId={openReceiptId} onClose={() => setOpenReceiptId(null)} />}
      <AnimatePresence>
        {undo && <UndoToast actionType={undo.actionType} msLeft={msLeft} status={undo.status} onUndo={undoNow} durationMs={UNDO_WINDOW_MS} />}
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
      <AnimatePresence>
        {escalateBeacons.map((b) => (
          <EscalateBeacon key={b.id} rect={b.rect} reduced={reduced} />
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {consequenceChips.map((c) => (
          <ConsequenceChip key={c.id} rect={c.rect} label={c.label} reduced={reduced} />
        ))}
      </AnimatePresence>
      <KeymapHUD open={keymapOpen} onClose={() => setKeymapOpen(false)} />
    </div>
  )
}
