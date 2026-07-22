"use client"

// D1.T1 — the Command Bridge: left rail (nav + Orb + pulse), center stage
// (contextual scene, FLOW-15 CameraPan transitions — one continuous space), right
// rail (activity theater + approvals dock). New route (/jarvis/bridge), NOT a
// replacement of the existing /jarvis Shell — hard rule #8 (strangler per panel, no
// panel refactors before snapshots exist): C1.T4's snapshot suite covers the ~15
// existing panels as they are today, so this session builds the new Bridge alongside
// them rather than rewriting Shell in place. Center-stage scenes progressively pull in
// REAL existing panels (KpiStrip, DailyBriefing, WorkflowTheater — unmodified, same
// components /jarvis already renders) rather than re-implementing them; more panels
// migrate to scenes in later D-track sessions (D3's renderer registry, D4's Pipeline
// Theater), never all at once.

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import { LayoutGrid, Workflow as WorkflowIcon } from "lucide-react"
import "../jarvis-theme.css"
import { ConsoleAtmosphere, LiveDot } from "../atmosphere"
import { JarvisDataProvider, useJarvis } from "../lib/data-core"
import { JarvisAuthProvider, useJarvisAuth } from "../lib/jarvis-auth"
import { useVapiSession } from "../lib/useVapiSession"
import { KpiStrip } from "../panels/KpiStrip"
import { DailyBriefing } from "../panels/DailyBriefing"
import { WorkflowTheater } from "../panels/WorkflowTheater"
import { ApprovalCockpit } from "./ApprovalCockpit"
import { GridBackdrop } from "../ui/fx/GridBackdrop"
import { choreo } from "../ui/motion/choreo"
import { PulseBar } from "./PulseBar"
import { ActivityTheater } from "./ActivityTheater"
import { Orb3D, type OrbState } from "./Orb3D"

const ParticleField = dynamic(() => import("../panels/ParticleField").then((m) => m.ParticleField), { ssr: false })

type SceneId = "overview" | "pipeline"
const SCENES: { id: SceneId; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "pipeline", label: "Pipeline", icon: WorkflowIcon },
]

// FLOW-24 ThemeTide — real device clock, four honest buckets, never a fabricated
// cycle. Re-checked every 5 minutes (a plain JS interval, not a render loop — doesn't
// count against hard rule #10's ≤2-ambient-loops-per-viewport budget).
function getDaypart(): "dawn" | "day" | "dusk" | "night" {
  const h = new Date().getHours()
  if (h >= 5 && h < 8) return "dawn"
  if (h >= 8 && h < 18) return "day"
  if (h >= 18 && h < 21) return "dusk"
  return "night"
}

function useOrbLiveState(): { state: OrbState; activeRunCount: number } {
  const data = useJarvis()
  const session = useVapiSession()
  return useMemo(() => {
    const activeRunCount = data.runs.length
    const blocked = data.stats?.blocked ?? 0
    let state: OrbState = "idle"
    if (data.statsDegraded) state = "error"
    else if (session.voiceState === "speaking" || activeRunCount > 0) state = "executing"
    else if (session.voiceState === "connecting" || session.voiceState === "live") state = "planning"
    else if (blocked > 0) state = "blocked"
    return { state, activeRunCount }
  }, [data.statsDegraded, data.runs.length, data.stats?.blocked, session.voiceState])
}

function CausticHeader() {
  return (
    <svg aria-hidden className="jarvis-caustic-layer pointer-events-none absolute -inset-6 h-[calc(100%+3rem)] w-[calc(100%+3rem)] opacity-25">
      <filter id="bridge-caustic-turb">
        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.06" numOctaves="2" seed="9" result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.13  0 0 0 0 0.83  0 0 0 0 0.93  0 0 0 0.45 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#bridge-caustic-turb)" />
    </svg>
  )
}

function LeftRail({ scene, setScene }: { scene: SceneId; setScene: (s: SceneId) => void }) {
  const orbLive = useOrbLiveState()
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-white/6 bg-[#05090f]/85 backdrop-blur-xl">
      <Link href="/jarvis" className="flex items-center gap-3 px-5 pb-3 pt-6">
        <div className="h-9 w-9 shrink-0">
          <Orb3D live={orbLive} />
        </div>
        <div>
          <div className="text-[15px] font-black tracking-tight text-[color:var(--j-text)]">JARVIS</div>
          <div className="text-[8.5px] font-bold uppercase tracking-[0.28em] text-[color:var(--j-text-faint)]">Command Bridge</div>
        </div>
      </Link>

      <nav className="mt-2 space-y-0.5 px-3">
        {SCENES.map(({ id, label, icon: Icon }) => {
          const active = scene === id
          return (
            <button
              key={id}
              onClick={() => setScene(id)}
              className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-bold transition ${
                active ? "bg-cyan-400/[0.08] text-[color:var(--j-text)]" : "text-[color:var(--j-text-dim)] hover:bg-white/[0.04] hover:text-[color:var(--j-text)]"
              }`}
            >
              {active && <motion.span layoutId="bridge-nav-glow" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />}
              <Icon className={`h-4 w-4 transition-colors duration-200 ${active ? "text-cyan-300" : ""}`} />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />
      <div className="space-y-3 px-4 pb-5">
        <PulseBar />
      </div>
    </aside>
  )
}

function CenterStage({ scene }: { scene: SceneId }) {
  return (
    <main className="relative min-w-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <GridBackdrop />
      </div>
      <div className="relative border-b border-white/6 px-6 py-4">
        <CausticHeader />
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="text-base font-black text-[color:var(--j-text)]">Command Bridge</h1>
            <p className="text-[11px] text-[color:var(--j-text-dim)]">D1 — real vitals, real activity, one continuous space</p>
          </div>
          <span className="j-chip bg-cyan-400/10 text-cyan-200">
            <LiveDot /> live
          </span>
        </div>
      </div>
      <div className="relative p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={scene}
            variants={choreo.cameraPan.variants}
            initial="initial"
            animate="animate"
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="space-y-4"
          >
            {scene === "overview" && (
              <>
                <DailyBriefing />
                <KpiStrip />
              </>
            )}
            {scene === "pipeline" && <WorkflowTheater />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

function RightRail() {
  return (
    <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col gap-4 border-l border-white/6 bg-[#05090f]/85 p-4 backdrop-blur-xl">
      <div className="min-h-0 flex-1">
        <ActivityTheater />
      </div>
      <div className="max-h-[45vh] overflow-y-auto">
        <ApprovalCockpit />
      </div>
    </aside>
  )
}

function BridgeShell() {
  const [scene, setScene] = useState<SceneId>("overview")
  const [daypart, setDaypart] = useState<ReturnType<typeof getDaypart>>("day")
  const [mounted, setMounted] = useState(false)
  const { session, loading } = useJarvisAuth()

  useEffect(() => {
    setMounted(true)
    setDaypart(getDaypart())
    const id = window.setInterval(() => setDaypart(getDaypart()), 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070f]">
        <div className="flex items-center gap-3 text-lg font-black tracking-tight text-white">
          <span className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-cyan-400/20 text-xs font-black text-cyan-200 shadow-lg">F</span>
          Waking the Bridge…
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070f] px-6 text-center">
        <h1 className="text-lg font-black text-white">Sign in required</h1>
        <p className="max-w-sm text-[12px] text-[color:var(--j-text-dim)]">The Command Bridge shows real vitals, activity, and approvals for your own tenant.</p>
        <Link href="/jarvis/login" className="rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 hover:bg-teal-200">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="jarvis-cursor-zone jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]" data-mood="idle" data-daypart={daypart}>
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        style={{ opacity: "var(--aurora-opacity)", backgroundColor: "var(--day-tint)", transition: "background-color 2s ease" }}
      >
        <ConsoleAtmosphere />
      </div>
      <ParticleField />
      <div className="relative flex">
        <LeftRail scene={scene} setScene={setScene} />
        <CenterStage scene={scene} />
        <RightRail />
      </div>
    </div>
  )
}

export function Bridge() {
  return (
    <JarvisAuthProvider>
      <JarvisDataProvider>
        <BridgeShell />
      </JarvisDataProvider>
    </JarvisAuthProvider>
  )
}
