"use client"

// F3.T1/T2/T5 — FLOW-50..58 (Band F3 — Decision Theater) demoed on the Stage, same
// FlowCard chrome convention as GrammarCatalog/CommandSurfaceCatalog. Every demo here
// reuses the SAME real component the Bridge's ApprovalCockpit mounts (GateValveGlyph,
// RiskChargeOverlay, EscalateBeacon, ConsequenceChip, choreo.inkBleed, the F1 Toast's
// CountdownRing, KeymapHUD) — never a lookalike rebuild for Stage's sake.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { FlowCard, ReplayButton } from "./FlowCard"
import { choreo } from "./choreo"
import { EASE } from "./tokens"
import { GateValveGlyph, RiskChargeOverlay, EscalateBeacon, ConsequenceChip } from "../../bridge/ApprovalCockpit"
import { KeymapHUD } from "../../bridge/KeymapHUD"
import { RiskBadge, type RiskTier } from "../primitives/RiskBadge"
import { CountdownRing } from "../primitives/Toast"

function GateValveDemo() {
  const reduced = useReducedMotion() ?? false
  const [state, setState] = useState<"open" | "seal">("open")
  return (
    <FlowCard id="FLOW-50" title="GateValve" reducedFallback="color swap only, no rotate/seal">
      <div className="flex items-center gap-3">
        <GateValveGlyph variant={state} reduced={reduced} />
        <ReplayButton onClick={() => setState((s) => (s === "open" ? "seal" : "open"))} />
      </div>
    </FlowCard>
  )
}

function InkBleedDemo() {
  const reduced = useReducedMotion() ?? false
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.inkBleed.reducedVariants : choreo.inkBleed.variants
  return (
    <FlowCard id="FLOW-51" title="InkBleed" reducedFallback="border flash only, no 400ms bleed">
      <div className="relative flex items-center gap-3">
        <div className="relative flex h-8 w-28 items-center justify-center rounded-lg bg-teal-300/15 text-[9px] font-black text-teal-200">
          <motion.span key={key} className="absolute inset-0 rounded-lg border-2 border-teal-300/60" variants={v} initial="initial" animate="animate" />
          APPROVED
        </div>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function RiskChargeDemo() {
  const reduced = useReducedMotion() ?? false
  const [tier, setTier] = useState<RiskTier>("high")
  const [active, setActive] = useState(false)
  return (
    <FlowCard id="FLOW-52" title="RiskCharge" reducedFallback="static material, no hover shimmer/sheen">
      <div
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        className="relative flex h-12 w-32 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
      >
        <RiskChargeOverlay tier={tier} active={active} reduced={reduced} />
        <RiskBadge tier={tier} />
      </div>
      <ReplayButton onClick={() => setTier((t) => (t === "high" ? "medium" : t === "medium" ? "low" : "high"))} />
    </FlowCard>
  )
}

function DiffWipeDemo() {
  const reduced = useReducedMotion() ?? false
  const [open, setOpen] = useState(false)
  return (
    <FlowCard id="FLOW-53" title="DiffWipe" reducedFallback="instant swap, no scanline">
      <div className="w-full">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-full bg-amber-300/12 px-2 py-0.5 text-[9px] font-black text-amber-200"
        >
          override · fixture-sku {open ? "▲" : "▼"}
        </button>
        {open && (
          <div className="relative mt-2 flex items-center gap-2 overflow-hidden rounded-lg border border-amber-300/25 bg-amber-300/[0.04] p-2 text-[10px]">
            <motion.div
              aria-hidden
              initial={{ x: "-100%" }}
              animate={{ x: "160%" }}
              transition={{ duration: reduced ? 0 : 0.5, ease: EASE.standard }}
              className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-amber-200/25 to-transparent"
            />
            <span className="text-white/50">price book</span>
            <span className="font-mono font-bold text-white/80">$42.00</span>
            <span className="text-white/30">→</span>
            <span className="font-mono font-bold text-amber-200">$38.50</span>
          </div>
        )}
      </div>
    </FlowCard>
  )
}

function BatchDeckShuffleDemo() {
  const [count, setCount] = useState(3)
  return (
    <FlowCard id="FLOW-54" title="BatchDeckShuffle" reducedFallback="plain list, no fan/magnetize">
      <div className="flex items-center gap-1">
        {Array.from({ length: count }).map((_, i) => (
          <motion.div
            key={i}
            layout
            variants={choreo.deckFan.variants}
            initial="initial"
            animate="animate"
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            style={{ rotate: (i - count / 2) * 6, marginLeft: i === 0 ? 0 : -14 }}
            className="h-7 w-10 rounded-md border border-white/15 bg-white/8"
          />
        ))}
        <ReplayButton onClick={() => setCount((c) => (c >= 5 ? 2 : c + 1))} />
      </div>
    </FlowCard>
  )
}

function ConsequenceTrailDemo() {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [fired, setFired] = useState(0)
  const [chips, setChips] = useState<Array<{ id: number; rect: DOMRect }>>([])
  return (
    <FlowCard id="FLOW-55" title="ConsequenceTrail" reducedFallback="counts update, no flight">
      <div className="flex items-center gap-3">
        <div ref={cardRef} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[10px] text-white/70">
          fixture card
        </div>
        <ReplayButton
          onClick={() => {
            const rect = cardRef.current?.getBoundingClientRect()
            if (rect) setChips((c) => [...c, { id: fired, rect }])
            setFired((n) => n + 1)
          }}
        />
      </div>
      <p className="mt-1 text-[9px] text-white/30">
        No real activity-feed anchor is mounted on Stage — the chip fades in place instead of flying nowhere (honest-absent, same rule the real Bridge uses).
      </p>
      {chips.map((c) => (
        <ConsequenceChip key={c.id} rect={c.rect} label="fixture" reduced={false} />
      ))}
    </FlowCard>
  )
}

function UndoRingDemo() {
  const DURATION_MS = 5000
  const [msLeft, setMsLeft] = useState(DURATION_MS)
  useEffect(() => {
    if (msLeft <= 0) return
    const t = window.setInterval(() => setMsLeft((m) => Math.max(0, m - 200)), 200)
    return () => window.clearInterval(t)
  }, [msLeft])
  return (
    <FlowCard id="FLOW-56" title="UndoRing" reducedFallback="numeric countdown only, no draining ring">
      <div className="flex items-center gap-3">
        <CountdownRing msLeft={msLeft} durationMs={DURATION_MS} />
        <span className="text-[10px] text-white/60">{Math.ceil(msLeft / 1000)}s</span>
        <ReplayButton onClick={() => setMsLeft(DURATION_MS)} />
      </div>
      <p className="mt-1 text-[9px] text-white/30">Shipped early in F1.T2 inside ApprovalCockpit&apos;s UndoToast — this card demos the same real CountdownRing.</p>
    </FlowCard>
  )
}

function EscalateBeaconDemo() {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [fired, setFired] = useState(0)
  const [beacons, setBeacons] = useState<Array<{ id: number; rect: DOMRect }>>([])
  return (
    <FlowCard id="FLOW-57" title="EscalateBeacon" reducedFallback="static chip, no upward travel">
      <div className="flex items-center gap-3">
        <div ref={cardRef} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[10px] text-white/70">
          fixture card
        </div>
        <ReplayButton
          onClick={() => {
            const rect = cardRef.current?.getBoundingClientRect()
            if (rect) setBeacons((b) => [...b, { id: fired, rect }])
            setFired((n) => n + 1)
          }}
        />
      </div>
      {beacons.map((b) => (
        <EscalateBeacon key={b.id} rect={b.rect} reduced={false} />
      ))}
    </FlowCard>
  )
}

function KeymapHUDDemo() {
  const [open, setOpen] = useState(false)
  return (
    <FlowCard id="FLOW-58" title="KeymapHUD" reducedFallback="same overlay, no spring entrance">
      <div className="flex items-center gap-3">
        <ReplayButton onClick={() => setOpen(true)} />
        <span className="text-[9px] text-white/40">or press &quot;?&quot; on the real /jarvis/bridge cockpit</span>
      </div>
      <KeymapHUD open={open} onClose={() => setOpen(false)} />
    </FlowCard>
  )
}

export function DecisionTheaterCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F3">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F3 — Decision Theater (FLOW-50..58)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">9 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Every demo below reuses the same real component the Bridge&apos;s ApprovalCockpit mounts — no Stage-only lookalikes. ConsequenceTrail is honest-absent
        here (no real activity-feed anchor on Stage); see the real chain on <code>/jarvis/bridge</code>.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <GateValveDemo />
        <InkBleedDemo />
        <RiskChargeDemo />
        <DiffWipeDemo />
        <BatchDeckShuffleDemo />
        <ConsequenceTrailDemo />
        <UndoRingDemo />
        <EscalateBeaconDemo />
        <KeymapHUDDemo />
      </div>
    </section>
  )
}
