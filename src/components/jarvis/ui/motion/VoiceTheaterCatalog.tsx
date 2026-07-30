"use client"

// F4.T1/T2/T3 — FLOW-67..73 (Band F4 — Voice Theater) demoed on the Stage, same
// FlowCard chrome convention as GrammarCatalog/CommandSurfaceCatalog/
// DecisionTheaterCatalog/DataVizCatalog. Every demo reuses the SAME real components
// LiveCallPanel.tsx mounts (WaveformStrip/CallOrbitRing/IntentSparkTray) — no
// Stage-only lookalikes — driven by FIXTURE volume/transcript/pending-action data
// since Stage is owner-gated and no TEST_OWNER_EMAIL/PASSWORD exists to drive a real
// Vapi session here (the standing limitation every F-phase carries). FLOW-72
// HoldBreath is honestly `cut` (see flow-index.ts's note) — no card renders for it,
// same convention F5/F6 used for their own graceful-absent/cut entries.

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { FlowCard, ReplayButton } from "./FlowCard"
import { WaveformStrip, CallOrbitRing, IntentSparkTray } from "../../panels/LiveCallPanel"
import { JarvisOrb } from "../../panels/JarvisOrb"
import type { PendingAction } from "../../lib/data-core"

function WaveformTruthDemo() {
  const [active, setActive] = useState(true)
  const [level, setLevel] = useState(0.4)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setLevel(0.15 + Math.abs(Math.sin(Date.now() / 260)) * 0.7), 90)
    return () => clearInterval(t)
  }, [active])
  return (
    <FlowCard id="FLOW-67" title="WaveformTruth" reducedFallback="static level bars, no scroll">
      <div className="flex w-full flex-col items-center gap-2">
        <div className="w-full rounded-xl border border-white/6 bg-black/25 px-2 py-1">
          <WaveformStrip volumeLevel={level} active={active} />
        </div>
        <button onClick={() => setActive((a) => !a)} className="j-chip border border-white/12 text-white/70">
          {active ? "stop (flatline)" : "start"}
        </button>
        <p className="j-fs-micro text-white/30">FIXTURE oscillator here — the real one is LiveCallPanel&apos;s Vapi `local-volume-level`, never synthetic in production.</p>
      </div>
    </FlowCard>
  )
}

function TranscriptTideDemo() {
  const [lines, setLines] = useState<Array<{ role: "you" | "jarvis"; text: string }>>([{ role: "jarvis", text: "How can I help?" }])
  return (
    <FlowCard id="FLOW-68" title="TranscriptTide" reducedFallback="line appears instantly, no enter animation">
      <div className="flex w-full flex-col items-center gap-2">
        <div className="w-full space-y-1.5">
          {lines.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2 j-fs-micro">
              <span className={`shrink-0 font-black ${m.role === "jarvis" ? "text-cyan-300" : "text-white/60"}`}>{m.role === "jarvis" ? "FINNOR" : "YOU"}</span>
              <span className="text-white/80">{m.text}</span>
            </motion.div>
          ))}
        </div>
        <ReplayButton onClick={() => setLines((l) => [...l, { role: l.length % 2 ? "jarvis" : "you", text: "Book a water test Tuesday" }])} />
        <p className="j-fs-micro text-white/30">Real Vapi `message` events carry no per-word timestamps (grepped) — honest line-enter fallback, not fabricated word timing.</p>
      </div>
    </FlowCard>
  )
}

const FIXTURE_ACTIONS: PendingAction[] = [
  { id: "fixture-1", actionType: "schedule_water_test", summary: null, payload: {}, status: "pending", createdAt: new Date(0).toISOString() },
]

function IntentSparkDemo() {
  const sourceRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [since, setSince] = useState<number | null>(null)
  const [actions, setActions] = useState<PendingAction[]>([])
  const replayCountRef = useRef(0)
  return (
    <FlowCard id="FLOW-69" title="IntentSpark" reducedFallback="chip appears in the tray directly, no flight">
      <div className="flex w-full flex-col items-center gap-2">
        <div ref={sourceRef} className="j-fs-micro text-white/50">
          transcript line (spark origin)
        </div>
        <IntentSparkTray pendingActions={actions} sinceMs={since} active={active} sourceRef={sourceRef} />
        <ReplayButton
          onClick={() => {
            replayCountRef.current += 1
            const now = 0
            setSince(now)
            setActive(true)
            setActions(FIXTURE_ACTIONS.map((a) => ({ ...a, id: `fixture-${replayCountRef.current}`, createdAt: new Date(now + 1).toISOString() })))
          }}
        />
        <p className="j-fs-micro text-white/30">FIXTURE action — real tray matches genuine pending domain_actions created since the call started (time-window, no stored call id).</p>
      </div>
    </FlowCard>
  )
}

function CallOrbitDemo() {
  const [active, setActive] = useState(true)
  return (
    <FlowCard id="FLOW-70" title="CallOrbit" reducedFallback="static ring, no rotation">
      <div className="flex w-full flex-col items-center gap-2">
        <div className="relative">
          <CallOrbitRing size={52} active={active} />
          <JarvisOrb size={52} voiceState={active ? "live" : "idle"} volumeLevel={0.3} />
        </div>
        <button onClick={() => setActive((a) => !a)} className="j-chip border border-white/12 text-white/70">
          {active ? "end call" : "start call"}
        </button>
        <p className="j-fs-micro text-white/30">DOM ring (SVG transform), not WebGL — LiveCallPanel&apos;s own orb container, not Bridge&apos;s Orb3D.</p>
      </div>
    </FlowCard>
  )
}

function VoiceMoodWashDemo() {
  const [voice, setVoice] = useState(false)
  return (
    <FlowCard id="FLOW-71" title="VoiceMoodWash" reducedFallback="instant swap, no 2s transition">
      <div className="flex w-full flex-col items-center gap-2">
        <div
          className="h-14 w-full rounded-xl border border-white/10"
          style={{ background: voice ? "rgba(45,212,191,0.28)" : "rgba(34,211,238,0.14)", transition: "background-color 2s ease" }}
        />
        <button onClick={() => setVoice((v) => !v)} className="j-chip border border-white/12 text-white/70">
          toggle mood
        </button>
        <p className="j-fs-micro text-white/30">Real target is `[data-jarvis-atmosphere]`&apos;s own 2s opacity transition, driven by the real `data-mood` attribute (deriveMood()).</p>
      </div>
    </FlowCard>
  )
}

function HangupSettleDemo() {
  const [key, setKey] = useState(0)
  const [flying, setFlying] = useState(false)
  const trayRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<HTMLDivElement>(null)
  return (
    <FlowCard id="FLOW-73" title="HangupSettle" reducedFallback="orbit body fades in place, no flight">
      <div className="flex w-full flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between">
          <div ref={orbRef} className="relative">
            <CallOrbitRing size={40} active={!flying} />
            <JarvisOrb size={40} voiceState="live" volumeLevel={0.3} />
          </div>
          <div ref={trayRef} className="h-8 w-16 rounded-lg border border-white/10 bg-white/5 text-center j-fs-micro leading-8 text-white/40">
            feed
          </div>
        </div>
        {flying && orbRef.current && trayRef.current && (
          <motion.div
            key={key}
            initial={{
              top: orbRef.current.getBoundingClientRect().top + 16,
              left: orbRef.current.getBoundingClientRect().left + 16,
              opacity: 1,
              scale: 1,
            }}
            animate={{
              top: trayRef.current.getBoundingClientRect().top + 12,
              left: trayRef.current.getBoundingClientRect().left + 28,
              opacity: 0,
              scale: 0.3,
            }}
            transition={{ duration: 0.6 }}
            onAnimationComplete={() => setFlying(false)}
            className="pointer-events-none z-50 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.85)]"
            style={{ position: "fixed" }}
          />
        )}
        <button
          onClick={() => {
            setKey((k) => k + 1)
            setFlying(true)
          }}
          className="j-chip border border-white/12 text-white/70"
        >
          hang up
        </button>
        <p className="j-fs-micro text-white/30">Real flight targets ActivityRail&apos;s registered &quot;legacy-activity-rail&quot; anchor (pulse-bus registry, no new transport).</p>
      </div>
    </FlowCard>
  )
}

export function VoiceTheaterCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F4 — Voice Theater (FLOW-67..73)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">6 shipped · 1 cut</span>
      </div>
      <p className="j-fs-micro text-[color:var(--j-text-dim)]">
        Every demo below reuses the SAME real components LiveCallPanel.tsx mounts (WaveformStrip/CallOrbitRing/IntentSparkTray), driven by FIXTURE
        data — Stage is owner-gated and no live Vapi session runs here. FLOW-72 HoldBreath has no card: @vapi-ai/web&apos;s client SDK has no hold
        event, honestly cut (see flow-index.ts).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <WaveformTruthDemo />
        <TranscriptTideDemo />
        <IntentSparkDemo />
        <CallOrbitDemo />
        <VoiceMoodWashDemo />
        <HangupSettleDemo />
      </div>
    </section>
  )
}
