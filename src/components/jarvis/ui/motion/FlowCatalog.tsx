"use client"

// C2.T1 — FLOW-01..13 catalog, demoed on the Stage from fixtures (per the plan's own
// "Catalog ... built on the Stage with FPS meter" instruction — the FPS meter itself
// is a C2.T2 deliverable, paired with FLOW-14..25; this file only needs to exist and
// be inspectable for T1). Each card names its FLOW id, shows the live primitive, and
// states its reduced-motion fallback in words (not just behaviorally) so a reviewer
// can verify the catalog claim without toggling OS settings.
//
// FLOW-06 PipeFlow and FLOW-07 ValvePulse reuse `jarvis-theme.css`'s pre-existing
// `.jarvis-edge-flow`/keyframes rather than re-implementing dash-offset animation a
// second time — that CSS already IS this FLOW entry, just not previously cataloged
// as one. FLOW-08 BurstFail here is a small motion-div stand-in (12 dots), not the
// full canvas particle engine — that's C3.T1's "~100-line canvas" particle engine;
// this demonstrates the choreography (spray + red flash), not the final renderer.

import { useState } from "react"
import { motion, useReducedMotion, AnimatePresence } from "framer-motion"
import { Enter, Stagger, Ticker, Flight, Press } from "./primitives"
import { choreo } from "./choreo"
import { EASE } from "./tokens"
import { FlowCard, ReplayButton } from "./FlowCard"

function PanelSurfaceDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-01" title="PanelSurface" reducedFallback="fade only, no translateY">
      <div className="flex w-full items-center justify-between">
        <Enter key={key} className="j-panel px-4 py-2 text-[11px] text-[color:var(--j-text)]">
          Panel content
        </Enter>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function CascadeStaggerDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-02" title="CascadeStagger" reducedFallback="all items appear at once, no 30ms cascade">
      <div className="flex w-full items-center justify-between gap-2">
        <Stagger key={key} staggerMs={30} className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-6 w-6 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-center text-[10px] leading-6 text-cyan-200">
              {n}
            </div>
          ))}
        </Stagger>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

// Fixed, deterministic delta cycle — no Math.random() (Phase 7 §7.8: nothing in the
// JARVIS cockpit may fake a metric via randomness, demo or not).
const TICKER_DEMO_DELTAS = [180, 45, 320, 90, 260]

function OdometerTickerDemo() {
  const [value, setValue] = useState(1042)
  const [step, setStep] = useState(0)
  return (
    <FlowCard id="FLOW-03" title="OdometerTicker" reducedFallback="value swaps instantly, no 600ms roll">
      <div className="flex w-full items-center justify-between">
        <Ticker value={value} format={(v) => Math.round(v).toLocaleString()} className="font-mono text-lg font-black text-[color:var(--j-text)]" />
        <ReplayButton
          onClick={() => {
            setValue((v) => v + TICKER_DEMO_DELTAS[step % TICKER_DEMO_DELTAS.length]!)
            setStep((s) => s + 1)
          }}
        />
      </div>
    </FlowCard>
  )
}

function RipplePressDemo() {
  return (
    <FlowCard id="FLOW-04" title="RipplePress" reducedFallback="no ripple, caller's own :active state only">
      <Press className="w-full cursor-pointer rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-center text-[11px] text-violet-200">
        Click / tap anywhere
      </Press>
    </FlowCard>
  )
}

function LiquidFillDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.liquidFill.reducedVariants : choreo.liquidFill.variants
  return (
    <FlowCard id="FLOW-05" title="LiquidFill" reducedFallback="static bar, no meniscus wobble">
      <div className="flex w-full items-center justify-between">
        <div className="h-12 w-6 overflow-hidden rounded-b-md border border-teal-400/30 bg-black/30">
          <motion.div key={key} variants={v} initial="initial" animate="animate" className="h-full w-full bg-gradient-to-t from-teal-400 to-cyan-300" />
        </div>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function PipeFlowDemo() {
  return (
    <FlowCard id="FLOW-06" title="PipeFlow" reducedFallback="static highlight, no dash-offset animation (see jarvis-theme.css reduced-motion block)">
      <svg width="140" height="24" viewBox="0 0 140 24">
        <line x1="4" y1="12" x2="136" y2="12" stroke="rgba(148,197,255,0.15)" strokeWidth="4" />
        <line x1="4" y1="12" x2="136" y2="12" stroke="var(--j-cyan)" strokeWidth="4" strokeDasharray="10 8" className="jarvis-edge-flow" />
      </svg>
    </FlowCard>
  )
}

function ValvePulseDemo() {
  const reduced = useReducedMotion()
  const v = reduced ? choreo.valvePulse.reducedVariants : choreo.valvePulse.variants
  return (
    <FlowCard id="FLOW-07" title="ValvePulse" reducedFallback="static accent color, no 1.2s glow pulse">
      <motion.div variants={v} initial="initial" animate="animate" className="h-8 w-8 rounded-full bg-amber-400" style={{ boxShadow: "var(--j-glow-amber)" }} />
    </FlowCard>
  )
}

function BurstFailDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const particles = Array.from({ length: 12 }, (_, i) => i)
  return (
    <FlowCard id="FLOW-08" title="BurstFail" reducedFallback="red flash only, no particle spray (full canvas engine is C3.T1)">
      <div className="relative flex w-full items-center justify-center">
        <div className="relative h-8 w-8">
          <motion.div
            key={`flash-${key}`}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 rounded-full bg-red-400"
          />
          {!reduced &&
            particles.map((i) => {
              const angle = (i / particles.length) * Math.PI * 2
              return (
                <motion.span
                  key={`${key}-${i}`}
                  className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-red-300"
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: Math.cos(angle) * 40, y: Math.sin(angle) * 40, opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE.accelerate }}
                />
              )
            })}
        </div>
        <div className="absolute -bottom-1 right-0"><ReplayButton onClick={() => setKey((k) => k + 1)} /></div>
      </div>
    </FlowCard>
  )
}

function BypassUnfurlDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.bypassUnfurl.reducedVariants : choreo.bypassUnfurl.variants
  return (
    <FlowCard id="FLOW-09" title="BypassUnfurl" reducedFallback="path appears instantly, no self-draw">
      <div className="flex w-full items-center justify-between">
        <svg width="80" height="24" viewBox="0 0 80 24">
          <motion.path key={key} d="M2 12 Q 20 2, 40 12 T 78 12" stroke="var(--j-violet)" strokeWidth="2" fill="none" variants={v} initial="initial" animate="animate" />
        </svg>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function StampApproveDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.stampApprove.reducedVariants : choreo.stampApprove.variants
  return (
    <FlowCard id="FLOW-10" title="StampApprove" reducedFallback="fade to color, no scale-overshoot/shake">
      <div className="flex w-full items-center justify-between">
        <motion.div key={key} variants={v} initial="initial" animate="animate" className="rounded-md border border-green-400/40 bg-green-400/15 px-3 py-1 text-[11px] font-black text-green-300">
          APPROVED
        </motion.div>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function ShatterRejectDemo() {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  const v = reduced ? choreo.shatterReject.reducedVariants : choreo.shatterReject.variants
  return (
    <FlowCard id="FLOW-11" title="ShatterReject" reducedFallback="slides away + fades, no fragment shatter">
      <div className="flex w-full items-center justify-between">
        <AnimatePresence mode="wait">
          {visible ? (
            <motion.div key="card" exit="animate" variants={v} initial="initial" animate="initial" className="rounded-md border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-black text-red-300">
              REJECTED
            </motion.div>
          ) : (
            <div className="text-[10px] text-[color:var(--j-text-faint)]">gone</div>
          )}
        </AnimatePresence>
        <ReplayButton onClick={() => setVisible((v2) => !v2)} />
      </div>
    </FlowCard>
  )
}

function DeckFanDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-12" title="DeckFan" reducedFallback="plain fade, no stack-to-fan rotation">
      <div className="flex w-full items-center justify-between">
        <div className="relative flex h-12 w-20 items-center justify-center">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={`${key}-${i}`}
              variants={choreo.deckFan.variants}
              initial="initial"
              animate="animate"
              style={{ rotate: (i - 1) * 12, translateX: (i - 1) * 14 }}
              className="absolute h-10 w-14 rounded-md border border-white/15 bg-white/5"
            />
          ))}
        </div>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function FlyToDockDemo() {
  const [docked, setDocked] = useState(false)
  return (
    <FlowCard id="FLOW-13" title="FlyToDock" reducedFallback="reposition with plain fade, no shared-layout tween">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex h-12 w-full items-center rounded-lg border border-white/8 bg-black/20 px-3" style={{ justifyContent: docked ? "flex-end" : "flex-start" }}>
          <Flight layoutId="flow-13-demo-chip" className="rounded-full bg-cyan-400/20 px-2.5 py-1 text-[10px] font-bold text-cyan-200">
            item
          </Flight>
        </div>
        <ReplayButton onClick={() => setDocked((d) => !d)} />
      </div>
    </FlowCard>
  )
}

export function FlowCatalogSection() {
  return (
    <section className="j-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="j-label">FLOW catalog — core interaction set (C2.T1, FLOW-01..13)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">13/25</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PanelSurfaceDemo />
        <CascadeStaggerDemo />
        <OdometerTickerDemo />
        <RipplePressDemo />
        <LiquidFillDemo />
        <PipeFlowDemo />
        <ValvePulseDemo />
        <BurstFailDemo />
        <BypassUnfurlDemo />
        <StampApproveDemo />
        <ShatterRejectDemo />
        <DeckFanDemo />
        <FlyToDockDemo />
      </div>
    </section>
  )
}
