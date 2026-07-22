"use client"

// C2.T2 — FLOW-14..25 (ambient/scene set), demoed on the Stage from fixtures,
// mirroring FlowCatalog.tsx's FLOW-01..13 pattern. FPS meter harness lives in
// FpsMeter.tsx and is mounted once by Stage.tsx (not per-card — it measures the
// whole page's real frame rate while these ambient loops run, which is what the
// plan's "FPS ≥55 on the worst one" exit-gate bullet actually needs to prove).
//
// FLOW-14 OrbStates is explicitly a placeholder here, labeled as such in its own
// card: D1 (the real Three.js particle-sphere Orb) hasn't shipped yet. This
// demonstrates the FIVE STATE NAMES and their relative motion character (idle
// breathing / planning spin-up / executing pulse / blocked hold / error fracture) on
// a plain 2D shape, not the genuine GPU particle system D1.T4 builds — never
// presented as the real Orb.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { choreo } from "./choreo"
import { FlowCard, ReplayButton } from "./FlowCard"

const ORB_STATES = ["idle", "planning", "executing", "blocked", "error"] as const
type OrbState = (typeof ORB_STATES)[number]
const ORB_COLOR: Record<OrbState, string> = {
  idle: "var(--j-cyan)",
  planning: "var(--j-violet)",
  executing: "var(--j-teal)",
  blocked: "var(--j-amber)",
  error: "var(--j-red)",
}

function OrbStatesDemo() {
  const reduced = useReducedMotion()
  const [stateIdx, setStateIdx] = useState(0)
  const state = ORB_STATES[stateIdx]!
  return (
    <FlowCard id="FLOW-14" title="OrbStates (placeholder — D1 builds the real Three.js orb)" reducedFallback="static orb, no breathing/spin/pulse animation">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.div
            animate={reduced ? { scale: 1 } : state === "idle" ? { scale: [1, 1.05, 1] } : state === "planning" ? { rotate: 360 } : state === "executing" ? { scale: [1, 1.15, 1] } : state === "blocked" ? { scale: 0.9 } : { scale: [1, 0.7, 1.1, 1], rotate: [0, 8, -8, 0] }}
            transition={reduced ? { duration: 0 } : state === "planning" ? { duration: 1.4, repeat: Infinity, ease: "linear" } : { duration: state === "executing" ? 0.9 : 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="h-9 w-9 rounded-full"
            style={{ background: ORB_COLOR[state], boxShadow: `0 0 24px ${ORB_COLOR[state]}` }}
          />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--j-text-dim)]">{state}</span>
        </div>
        <ReplayButton onClick={() => setStateIdx((i) => (i + 1) % ORB_STATES.length)} />
      </div>
    </FlowCard>
  )
}

function CameraPanDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.cameraPan.reducedVariants : choreo.cameraPan.variants
  return (
    <FlowCard id="FLOW-15" title="CameraPan" reducedFallback="plain crossfade, no scale/slide">
      <div className="flex w-full items-center justify-between">
        <motion.div key={key} variants={v} initial="initial" animate="animate" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] text-[color:var(--j-text)]">
          scene B
        </motion.div>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

const TYPE_SPEECH_TEXT = "Draft ready for approval."
function TypeSpeechDemo() {
  const reduced = useReducedMotion()
  const [chars, setChars] = useState(reduced ? TYPE_SPEECH_TEXT.length : 0)
  const [key, setKey] = useState(0)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) {
      setChars(TYPE_SPEECH_TEXT.length)
      return
    }
    setChars(0)
    let i = 0
    intervalRef.current = window.setInterval(() => {
      i += 1
      setChars(i)
      if (i >= TYPE_SPEECH_TEXT.length && intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
      }
    }, 20)
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
    }
  }, [key, reduced])

  return (
    <FlowCard id="FLOW-16" title="TypeSpeech" reducedFallback="full text shown immediately, no 20ms/char reveal">
      <div className="flex w-full items-center justify-between">
        <span className="font-mono text-[11px] text-[color:var(--j-text)]">
          {TYPE_SPEECH_TEXT.slice(0, chars)}
          {chars < TYPE_SPEECH_TEXT.length && <span className="jarvis-cursor">▍</span>}
        </span>
        <div className="flex gap-1.5">
          <button onClick={() => setChars(TYPE_SPEECH_TEXT.length)} className="rounded-full border border-white/12 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/60 hover:border-cyan-400/40 hover:text-cyan-200">
            Skip
          </button>
          <ReplayButton onClick={() => setKey((k) => k + 1)} />
        </div>
      </div>
    </FlowCard>
  )
}

function BorderBeamDemo() {
  return (
    <FlowCard id="FLOW-17" title="BorderBeam" reducedFallback="static border, no 3s conic-gradient loop">
      <div className="jarvis-border-beam w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-center text-[11px] text-[color:var(--j-text)]">
        executing…
      </div>
    </FlowCard>
  )
}

function CausticHeaderDemo() {
  return (
    <FlowCard id="FLOW-18" title="CausticHeader" reducedFallback="static SVG-turbulence texture, no drift animation">
      <div className="relative h-14 w-full overflow-hidden rounded-lg border border-white/10 bg-[color:var(--j-bg-deep)]">
        <svg className="jarvis-caustic-layer absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)] opacity-40" aria-hidden>
          <filter id="flow18-turb">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.08" numOctaves="2" seed="4" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.13  0 0 0 0 0.83  0 0 0 0 0.93  0 0 0 0.5 0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#flow18-turb)" />
        </svg>
      </div>
    </FlowCard>
  )
}

function RadarSweepDemo() {
  const reduced = useReducedMotion()
  const v = reduced ? choreo.radarSweep.reducedVariants : choreo.radarSweep.variants
  return (
    <FlowCard id="FLOW-19" title="RadarSweep" reducedFallback="static count, no expanding waves">
      <div className="relative flex h-14 w-14 items-center justify-center">
        {!reduced &&
          [0, 0.6, 1.2].map((delay) => (
            <motion.span
              key={delay}
              variants={v}
              initial="initial"
              animate="animate"
              transition={{ delay, duration: 1.8, repeat: Infinity, ease: [0, 0, 0.2, 1] }}
              className="absolute h-10 w-10 rounded-full border border-cyan-400/50"
            />
          ))}
        <span className="z-10 font-mono text-[13px] font-black text-[color:var(--j-text)]">7</span>
      </div>
    </FlowCard>
  )
}

function DrawSparkDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.drawSpark.reducedVariants : choreo.drawSpark.variants
  return (
    <FlowCard id="FLOW-20" title="DrawSpark" reducedFallback="shown fully drawn instantly, no 500ms self-draw">
      <div className="flex w-full items-center justify-between">
        <svg width="28" height="28" viewBox="0 0 28 28">
          <motion.path key={key} d="M14 2 L17 11 L26 14 L17 17 L14 26 L11 17 L2 14 L11 11 Z" stroke="var(--j-amber)" strokeWidth="1.5" fill="none" variants={v} initial="initial" animate="animate" />
        </svg>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function RouteDrawDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.routeDraw.reducedVariants : choreo.routeDraw.variants
  return (
    <FlowCard id="FLOW-21" title="RouteDraw" reducedFallback="polyline shown static, no marker glide">
      <div className="flex w-full items-center justify-between">
        <svg width="100" height="30" viewBox="0 0 100 30">
          <motion.polyline key={key} points="4,26 30,10 60,20 96,4" stroke="var(--j-teal)" strokeWidth="2" fill="none" variants={v} initial="initial" animate="animate" />
        </svg>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function PinAuraDemo() {
  const reduced = useReducedMotion()
  const v = reduced ? choreo.pinAura.reducedVariants : choreo.pinAura.variants
  return (
    <FlowCard id="FLOW-22" title="PinAura" reducedFallback="static colored pin, no pulse ring">
      <div className="relative flex h-10 w-10 items-center justify-center">
        {!reduced && <motion.span variants={v} initial="initial" animate="animate" className="absolute h-8 w-8 rounded-full bg-teal-400/40" />}
        <span className="z-10 h-3 w-3 rounded-full bg-teal-300" style={{ boxShadow: "var(--j-glow-teal)" }} />
      </div>
    </FlowCard>
  )
}

const DIGEST_TEXT = "3 approvals cleared while you were away."
function DigestCinematicDemo() {
  const reduced = useReducedMotion()
  const [playing, setPlaying] = useState(!reduced)
  return (
    <FlowCard id="FLOW-23" title="DigestCinematic" reducedFallback="text shown immediately, no 3–5s cinematic reveal">
      <div className="flex w-full items-center justify-between">
        {playing ? (
          <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 3 }} onAnimationComplete={() => setPlaying(false)} className="text-[11px] text-[color:var(--j-text)]">
            {DIGEST_TEXT}
          </motion.span>
        ) : (
          <span className="text-[11px] text-[color:var(--j-text)]">{DIGEST_TEXT}</span>
        )}
        <ReplayButton onClick={() => setPlaying(true)} />
      </div>
    </FlowCard>
  )
}

const THEME_PALETTES = [
  { name: "day", bg: "#0a1730" },
  { name: "dusk", bg: "#1a0f2e" },
]
function ThemeTideDemo() {
  const reduced = useReducedMotion()
  const [idx, setIdx] = useState(0)
  const v = reduced ? choreo.themeTide.reducedVariants : choreo.themeTide.variants
  const palette = THEME_PALETTES[idx % THEME_PALETTES.length]!
  return (
    <FlowCard id="FLOW-24" title="ThemeTide" reducedFallback="instant step change, no 2s crossfade">
      <div className="flex w-full items-center justify-between">
        <motion.div key={idx} variants={v} initial="initial" animate="animate" className="rounded-lg border border-white/10 px-4 py-2 text-[11px] text-[color:var(--j-text)]" style={{ background: palette.bg }}>
          {palette.name}
        </motion.div>
        <ReplayButton onClick={() => setIdx((i) => i + 1)} />
      </div>
    </FlowCard>
  )
}

function ShakeDenyDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  const v = reduced ? choreo.shakeDeny.reducedVariants : choreo.shakeDeny.variants
  return (
    <FlowCard id="FLOW-25" title="ShakeDeny" reducedFallback="outline flash only, no 4px/200ms shake">
      <div className="flex w-full items-center justify-between">
        <motion.button
          key={key}
          variants={v}
          initial="initial"
          animate="animate"
          onAnimationComplete={() => {}}
          className="jarvis-flash rounded-md border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-black text-red-300"
        >
          DENIED
        </motion.button>
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

export function FlowCatalogAmbientSection() {
  return (
    <section className="j-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="j-label">FLOW catalog — ambient/scene set (C2.T2, FLOW-14..25)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">25/25</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <OrbStatesDemo />
        <CameraPanDemo />
        <TypeSpeechDemo />
        <BorderBeamDemo />
        <CausticHeaderDemo />
        <RadarSweepDemo />
        <DrawSparkDemo />
        <RouteDrawDemo />
        <PinAuraDemo />
        <DigestCinematicDemo />
        <ThemeTideDemo />
        <ShakeDenyDemo />
      </div>
    </section>
  )
}
