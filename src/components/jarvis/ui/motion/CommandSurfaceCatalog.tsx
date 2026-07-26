"use client"

// F2.T3/T5 — FLOW-38..49 (Band F2 — Command Surface) demoed on the Stage, same
// FlowCard chrome convention as GrammarCatalog. FLOW-38 (OrbAuraRipple) and FLOW-39
// (EventMeteor) share ONE real orb anchor + ONE real feed anchor across their two
// cards (a single `fire()` button lives on the orb card) — pulse-bus's anchor
// registry is name-keyed and global by design (matching the real Bridge, where
// there's exactly one orb and one feed), so two independent orb/feed pairs on the
// same page would just overwrite each other's rect getters. This mirrors the real
// mechanism honestly: the meteor genuinely flies across the page from the orb
// card's rect to the feed card's rect, through Stage's own already-mounted
// <ParticleField/> (no second canvas). Deliberately a plain CSS orb, not the real
// bridge/Orb3D.tsx — that file pulls in Three.js, and FLOW-14's own Stage card
// already established the precedent of keeping Three.js out of Stage's bundle.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion, type TargetAndTransition } from "framer-motion"
import { FlowCard, ReplayButton } from "./FlowCard"
import { choreo } from "./choreo"
import { OrbAuraRipple } from "../../bridge/OrbAuraRipple"
import { onPulse, publishActivityArrival, registerAnchor, setLineageHover } from "../../lib/pulse-bus"
import { Ticker } from "./primitives"

function MiniOrb() {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => registerAnchor("orb", () => ref.current?.getBoundingClientRect() ?? null), [])
  return (
    <div ref={ref} className="relative h-12 w-12 rounded-full" style={{ background: "radial-gradient(circle at 38% 32%, rgba(34,211,238,0.9), rgba(34,211,238,0.25) 60%, transparent 80%)" }}>
      <OrbAuraRipple />
    </div>
  )
}

function OrbAuraRippleDemo() {
  const [fired, setFired] = useState(0)
  return (
    <FlowCard id="FLOW-38" title="OrbAuraRipple" reducedFallback="static aura, no expanding ring">
      <div className="flex items-center gap-3">
        <MiniOrb />
        <ReplayButton
          onClick={() => {
            // The SAME real function ActivityTheater calls on a genuine new row —
            // fires both this card's ripple and FLOW-39's meteor in one beat.
            publishActivityArrival(`stage-fixture-${fired}`)
            setFired((n) => n + 1)
          }}
        />
      </div>
    </FlowCard>
  )
}

function EventMeteorDemo() {
  const feedRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [arrivals, setArrivals] = useState(0)

  useEffect(() => registerAnchor("activity-feed", () => feedRef.current?.getBoundingClientRect() ?? null), [])
  useEffect(() => {
    return onPulse((pulse) => {
      if (pulse.kind !== "activity") return
      setArrivals((n) => n + 1)
      window.setTimeout(() => {
        if (rowRef.current) {
          rowRef.current.classList.remove("jarvis-flash")
          void rowRef.current.offsetWidth
          rowRef.current.classList.add("jarvis-flash")
        }
      }, 550) // METEOR_FLIGHT_MS — same beat as the real meteor's arrival
    })
  }, [])

  return (
    <FlowCard id="FLOW-39" title="EventMeteor" reducedFallback="row glow only, no flight/trail">
      <div ref={feedRef} className="w-full space-y-1">
        <div ref={rowRef} className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-white/70">
          fixture activity row — fire FLOW-38 above
        </div>
        <div className="text-[9px] text-white/30">arrivals: <Ticker value={arrivals} /></div>
      </div>
    </FlowCard>
  )
}

function PulseLiquidGaugesDemo() {
  const reduced = useReducedMotion()
  const [depth, setDepth] = useState(6)
  const ratio = Math.max(0, Math.min(1, depth / 20))
  return (
    <FlowCard id="FLOW-40" title="PulseLiquidGauges" reducedFallback="plain bar, no meniscus/fill animation">
      <div className="flex items-center gap-3">
        <span className="relative inline-block h-6 w-3 overflow-hidden rounded-sm border border-white/10 bg-white/[0.03]">
          <motion.span
            initial={{ scaleY: 0 }}
            animate={{ scaleY: ratio, transition: reduced ? { duration: 0 } : (choreo.liquidFill.variants.animate as { transition: object }).transition }}
            className="absolute inset-x-0 bottom-0 origin-bottom"
            style={{ height: "100%", background: "var(--j-cyan)" }}
          />
        </span>
        <span className="text-[11px] text-white/70">queue depth {depth}</span>
        <ReplayButton onClick={() => setDepth((d) => (d >= 18 ? 2 : d + 4))} />
      </div>
    </FlowCard>
  )
}

function NavCurrentDemo() {
  const [hovered, setHovered] = useState(false)
  return (
    <FlowCard id="FLOW-41" title="NavCurrent" reducedFallback="static bar, no flowing dash current">
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className="relative w-32 rounded-lg bg-cyan-400/[0.08] py-2 pl-4 text-[10px] font-bold text-white">
        <span className={`absolute inset-y-1 left-0 w-[3px] rounded-full bg-cyan-300 ${hovered ? "" : "j-selection-current"}`} />
        active scene
      </div>
    </FlowCard>
  )
}

function SceneDockDemo() {
  const reduced = useReducedMotion()
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-42" title="SceneDock" reducedFallback="crossfade only, no shrink-toward-rail">
      <div className="relative h-10 w-32 overflow-hidden">
        <motion.div
          key={key}
          initial={{ opacity: 0, scale: 0.98, x: 16 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={(reduced ? choreo.sceneDockExit.reducedVariants : choreo.sceneDockExit.variants).animate as TargetAndTransition}
          className="absolute inset-0 rounded-md bg-white/5 p-2 text-[10px] text-white/70"
        >
          scene {key}
        </motion.div>
      </div>
      <ReplayButton onClick={() => setKey((k) => k + 1)} />
    </FlowCard>
  )
}

function HeaderTideDemo() {
  return (
    <FlowCard id="FLOW-43" title="HeaderTide" reducedFallback="static caustic opacity, no event-rate coupling">
      <p className="text-[10px] text-white/50">
        Live only on the real Bridge (needs a genuine pulse-bus event rate over a trailing 60s window) — see the header caustic layer on <code>/jarvis/bridge</code>.
      </p>
    </FlowCard>
  )
}

function BridgeBootDemo() {
  const [playing, setPlaying] = useState(false)
  return (
    <FlowCard id="FLOW-44" title="BridgeBoot" reducedFallback="instant, no slide-in/bloom">
      <div className="flex items-center gap-3">
        <div className="relative h-8 w-24 overflow-hidden rounded-md bg-white/[0.02]">
          {playing && (
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              onAnimationComplete={() => setPlaying(false)}
              className="absolute inset-0 flex items-center justify-center text-[9px] text-cyan-200"
            >
              rails + orb bloom
            </motion.div>
          )}
        </div>
        <ReplayButton onClick={() => setPlaying(true)} />
      </div>
    </FlowCard>
  )
}

function VitalsBreathDemo() {
  const reduced = useReducedMotion()
  const [healthy, setHealthy] = useState(true)
  return (
    <FlowCard id="FLOW-45" title="VitalsBreath" reducedFallback="static dot color, no breathing/flatline">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex h-1.5 w-1.5">
          <motion.span
            className={`absolute inline-flex h-full w-full rounded-full ${healthy ? "bg-[#2dd4bf]" : "bg-amber-400"}`}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={reduced ? { scale: 1, opacity: 0.3 } : healthy ? { scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] } : { scaleX: [0.2, 1, 0.2] }}
            transition={reduced ? { duration: 0 } : { duration: healthy ? 1.6 : 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${healthy ? "bg-[#2dd4bf]" : "bg-amber-400"}`} />
        </span>
        <ReplayButton onClick={() => setHealthy((h) => !h)} />
      </div>
    </FlowCard>
  )
}

function OrbSpeechSyncDemo() {
  return (
    <FlowCard id="FLOW-46" title="OrbSpeechSync" reducedFallback="state color only, no amplitude-driven energy">
      <p className="text-[10px] text-white/50">
        Real Vapi <code>volume-level</code> (via <code>useVapiSession().volumeLevel</code>) blends into the Orb&apos;s shader energy while speaking — see the amplitude slider on the real <code>/jarvis/bridge</code> orb.
      </p>
    </FlowCard>
  )
}

function TickerGlideDemo() {
  const [paused, setPaused] = useState(false)
  const [i, setI] = useState(0)
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setI((n) => n + 1), 1200)
    return () => clearInterval(t)
  }, [paused])
  return (
    <FlowCard id="FLOW-47" title="TickerGlide" reducedFallback="hard step, no glide">
      <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="w-40 overflow-hidden rounded-md border border-white/8 bg-white/[0.02] px-2 py-1.5 text-[10px] text-white/70">
        item {i % 5}
      </div>
    </FlowCard>
  )
}

function CommandGravityDemo() {
  return (
    <FlowCard id="FLOW-48" title="CommandGravity" reducedFallback="no lift/glow on focus">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 transition-[box-shadow,transform] duration-200 focus-within:-translate-y-px focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.5),0_0_28px_-6px_rgba(34,211,238,0.35)]">
        <input placeholder="focus me" className="bg-transparent text-[11px] text-white outline-none placeholder:text-white/35" />
      </div>
    </FlowCard>
  )
}

function ConstellationLinkDemo() {
  const [hover, setHover] = useState(false)
  return (
    <FlowCard id="FLOW-49" title="ConstellationLink" reducedFallback="highlight only, no drawn line">
      <button
        onMouseEnter={() => { setHover(true); setLineageHover("stage-fixture") }}
        onMouseLeave={() => { setHover(false); setLineageHover(null) }}
        className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold ${hover ? "border-cyan-300/50 text-cyan-200" : "border-white/10 text-white/60"}`}
      >
        hover this KPI
      </button>
      <p className="mt-1 text-[9px] text-white/30">Live version draws real lines to the KPI&apos;s hand-authored source panel(s) on <code>/jarvis/bridge</code> — see KPI_LINEAGE in ConstellationLink.tsx.</p>
    </FlowCard>
  )
}

export function CommandSurfaceCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F2">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F2 — Command Surface (FLOW-38..49)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">12 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        pulse-bus-driven orb/feed causality (FLOW-38/39 share one real anchor pair below — fire FLOW-38 to see FLOW-39&apos;s row flash), real vitals gauges, and real focus/hover state. HeaderTide/OrbSpeechSync are Bridge-only (need a real event-rate window / real Vapi session) — linked instead of faked here.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <OrbAuraRippleDemo />
        <EventMeteorDemo />
        <PulseLiquidGaugesDemo />
        <NavCurrentDemo />
        <SceneDockDemo />
        <HeaderTideDemo />
        <BridgeBootDemo />
        <VitalsBreathDemo />
        <OrbSpeechSyncDemo />
        <TickerGlideDemo />
        <CommandGravityDemo />
        <ConstellationLinkDemo />
      </div>
    </section>
  )
}
