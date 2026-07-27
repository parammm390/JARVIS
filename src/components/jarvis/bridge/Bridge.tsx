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

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion"
import { LayoutGrid, Volume2, VolumeX, Workflow as WorkflowIcon } from "lucide-react"
import "../jarvis-theme.css"
import { ConsoleAtmosphere, LiveDot } from "../atmosphere"
import { JarvisDataProvider, useJarvis } from "../lib/data-core"
import { JarvisAuthProvider, useJarvisAuth } from "../lib/jarvis-auth"
import { useVapiSession } from "../lib/useVapiSession"
import { deriveMood } from "../lib/mood"
import { KpiStrip } from "../panels/KpiStrip"
import { DailyBriefing } from "../panels/DailyBriefing"
import { CertificationStatus } from "../panels/CertificationStatus"
import { SinceYouWereAway } from "../SinceYouWereAway"
import { GridBackdrop } from "../ui/fx/GridBackdrop"
import { choreo } from "../ui/motion/choreo"
import { PulseBar } from "./PulseBar"
import { Orb3D, type OrbState } from "./Orb3D"
import { OrbAuraRipple } from "./OrbAuraRipple"
import { ConstellationLink } from "./ConstellationLink"
import { onPulse } from "../lib/pulse-bus"
import { onReceiptSceneRequest, type ReceiptSceneRequest } from "../lib/receipt-nav"
import { ReceiptContent } from "../lib/ReceiptDrawer"
import { rankPanels, recordPanelOpen, type FrecencyLedger } from "../lib/frecency"
import { CommandPaletteV2, useCommandPaletteV2 } from "../lib/CommandPaletteV2"
import { jarvisClient } from "@/lib/jarvis-client"
import { jarvisGet, jarvisPut } from "../lib/api"
import { setMuted } from "../sound"
import { QueryFpsMeterHud } from "../ui/motion/FpsMeter"
import { initialLowPowerMode, persistLowPowerMode } from "../lib/low-power"

const ParticleField = dynamic(() => import("../panels/ParticleField").then((m) => m.ParticleField), { ssr: false })
// D9: the expensive theater and live rails are separate client chunks. They are only
// requested after the authenticated Bridge shell is interactive.
const WorkflowTheater = dynamic(() => import("../panels/WorkflowTheater").then((m) => m.WorkflowTheater), { ssr: false })
const ApprovalCockpit = dynamic(() => import("./ApprovalCockpit").then((m) => m.ApprovalCockpit), { ssr: false })
const ActivityTheater = dynamic(() => import("./ActivityTheater").then((m) => m.ActivityTheater), { ssr: false })

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

function useOrbLiveState(): { state: OrbState; activeRunCount: number; voiceAmplitude?: number } {
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
    // FLOW-46 OrbSpeechSync — only the real Vapi output level, only while genuinely
    // speaking; every other moment leaves this undefined, never a fabricated 0.
    const voiceAmplitude = session.voiceState === "speaking" ? session.volumeLevel : undefined
    return { state, activeRunCount, voiceAmplitude }
  }, [data.statsDegraded, data.runs.length, data.stats?.blocked, session.voiceState, session.volumeLevel])
}

// F6.T2 — FLOW-90 OfflineDrift formalizes the legacy Shell's own "standalone" mood
// (jarvis-theme.css's `[data-mood="standalone"]` already dims `--aurora-opacity` to
// 0.45 and swaps the accent to amber — real, shipped CSS, just never wired into the
// Bridge, which hardcoded `data-mood="idle"` unconditionally). Reuses that existing
// system rather than inventing a second "degraded" visual language: real signal is
// `data.statsDegraded` (the fast lane's own API-unreachable truth, already what
// useOrbLiveState above keys its "error" orb state on). Adds the one genuinely new
// piece the legacy Shell never had — a one-shot "relight" cascade on the transition
// BACK to reachable, so recovery reads as an event, not a silent color swap.
function useOfflineDrift(): { mood: ReturnType<typeof deriveMood>; relighting: boolean } {
  const data = useJarvis()
  const session = useVapiSession()
  const voiceLive = session.voiceState === "live" || session.voiceState === "speaking"
  const mood = deriveMood({ voiceLive, degraded: data.statsDegraded })
  const [relighting, setRelighting] = useState(false)
  const wasDegradedRef = useRef(data.statsDegraded)
  useEffect(() => {
    if (wasDegradedRef.current && !data.statsDegraded) {
      setRelighting(true)
      const t = window.setTimeout(() => setRelighting(false), 900)
      wasDegradedRef.current = data.statsDegraded
      return () => window.clearTimeout(t)
    }
    wasDegradedRef.current = data.statsDegraded
  }, [data.statsDegraded])
  return { mood, relighting }
}

// FLOW-43 HeaderTide — caustic intensity follows the REAL rate of pulse-bus events
// (itself layered over data-core's ring-buffer-fed emitter, plan's own "events/min
// from the ring buffer" data source) over a trailing 60s window, clamped to a sane
// visual range. "poll-landed" is excluded for the same honesty reason OrbAuraRipple
// excludes it — a fixed 4s tick isn't a real event rate. Recomputed on a 5s interval
// (a plain timer, not a render loop) rather than every pulse, so a burst of real
// events doesn't thrash React state.
const CAUSTIC_MIN_OPACITY = 0.14
const CAUSTIC_MAX_OPACITY = 0.42
const CAUSTIC_WINDOW_MS = 60_000

function useEventRateOpacity(): number {
  const timestampsRef = useRef<number[]>([])
  const [opacity, setOpacity] = useState(CAUSTIC_MIN_OPACITY)
  useEffect(() => {
    const off = onPulse((pulse) => {
      if (pulse.kind === "poll") return
      timestampsRef.current.push(pulse.at)
    })
    const recompute = () => {
      const cutoff = Date.now() - CAUSTIC_WINDOW_MS
      timestampsRef.current = timestampsRef.current.filter((t) => t >= cutoff)
      const perMinute = timestampsRef.current.length
      const ratio = Math.min(1, perMinute / 12)
      setOpacity(CAUSTIC_MIN_OPACITY + ratio * (CAUSTIC_MAX_OPACITY - CAUSTIC_MIN_OPACITY))
    }
    const id = window.setInterval(recompute, 5000)
    recompute()
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [])
  return opacity
}

function CausticHeader() {
  const opacity = useEventRateOpacity()
  return (
    <svg
      aria-hidden
      className="jarvis-caustic-layer pointer-events-none absolute -inset-6 h-[calc(100%+3rem)] w-[calc(100%+3rem)] transition-opacity duration-1000"
      style={{ opacity }}
    >
      <filter id="bridge-caustic-turb">
        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.06" numOctaves="2" seed="9" result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.13  0 0 0 0 0.83  0 0 0 0 0.93  0 0 0 0.45 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#bridge-caustic-turb)" />
    </svg>
  )
}

function SoundPreferenceToggle() {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    void jarvisGet<{ prefs: { soundEnabled: boolean } }>("user-prefs")
      .then(({ prefs }) => { if (!cancelled) { setEnabled(prefs.soundEnabled); setMuted(!prefs.soundEnabled) } })
      .catch(() => { if (!cancelled) setMuted(true) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])
  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    setMuted(!next)
    void jarvisPut("user-prefs", { soundEnabled: next }).catch(() => {
      // Keep sound fail-closed if the durable preference cannot be saved.
      setEnabled(false)
      setMuted(true)
    })
  }
  return <button type="button" onClick={toggle} disabled={!loaded} className="j-chip flex items-center gap-1.5 border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)] disabled:opacity-50" aria-pressed={enabled} aria-label={enabled ? "Turn off JARVIS sounds" : "Turn on JARVIS sounds"}>{enabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}{enabled ? "Sound on" : "Sound off"}</button>
}

function LeftRail({ scene, setScene, orderedScenes, unopened, forceLowPower, bootBloom = false }: { scene: SceneId; setScene: (s: SceneId) => void; orderedScenes: SceneId[]; unopened: SceneId[]; forceLowPower: boolean; bootBloom?: boolean }) {
  const orbLive = useOrbLiveState()
  // FLOW-41 NavCurrent — real state, not decoration: the active scene's own glow bar
  // flows only while it's genuinely idle-active; hovering it (about to switch away,
  // or just inspecting) stills the current, per the plan's own spec.
  const [hoveredNav, setHoveredNav] = useState<SceneId | null>(null)
  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-white/6 bg-[#05090f]/85 backdrop-blur-xl lg:sticky lg:top-0 lg:flex">
      <Link href="/jarvis" className="flex items-center gap-3 px-5 pb-3 pt-6">
        <div className="relative h-9 w-9 shrink-0">
          <Orb3D live={orbLive} forceLowPower={forceLowPower} />
          {!forceLowPower && <OrbAuraRipple />}
          {/* FLOW-44 BridgeBoot — the orb's one real ignition bloom, once per cold
              session boot, distinct from OrbAuraRipple's per-event rings above. */}
          {bootBloom && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-[-10px] rounded-full border-2 border-cyan-300/70"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 2.6, opacity: [0, 0.8, 0] }}
              transition={{ duration: 1.1, ease: [0, 0, 0.2, 1] }}
            />
          )}
        </div>
        <div>
          <div className="text-[15px] font-black tracking-tight text-[color:var(--j-text)]">JARVIS</div>
          <div className="text-[8.5px] font-bold uppercase tracking-[0.28em] text-[color:var(--j-text-faint)]">Command Bridge</div>
        </div>
      </Link>

      <nav className="mt-2 space-y-0.5 px-3">
        {orderedScenes.map((id) => {
          const { label, icon: Icon } = SCENES.find((candidate) => candidate.id === id)!
          const active = scene === id
          return (
            <button
              key={id}
              onClick={() => setScene(id)}
              onMouseEnter={() => setHoveredNav(id)}
              onMouseLeave={() => setHoveredNav((h) => (h === id ? null : h))}
              aria-current={active ? "page" : undefined}
              className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-bold transition ${
                active ? "bg-cyan-400/[0.08] text-[color:var(--j-text)]" : "text-[color:var(--j-text-dim)] hover:bg-white/[0.04] hover:text-[color:var(--j-text)]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="bridge-nav-glow"
                  className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.8)] ${hoveredNav === id ? "" : "j-selection-current"}`}
                />
              )}
              <Icon className={`h-4 w-4 transition-colors duration-200 ${active ? "text-cyan-300" : ""}`} />
              {label}
            </button>
          )
        })}
      </nav>

      {unopened.length > 0 && <div className="mx-3 mt-3 border-t border-white/8 pt-3"><div className="j-label mb-2">Ready next</div><div className="flex flex-wrap gap-1.5">{unopened.map((id) => <button key={id} onClick={() => setScene(id)} className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)] hover:text-cyan-100">{SCENES.find((candidate) => candidate.id === id)!.label}</button>)}</div></div>}

      <div className="flex-1" />
      <div className="space-y-3 px-4 pb-5">
        <PulseBar />
      </div>
    </aside>
  )
}

// F7.T2 — FLOW-95 DrawerToPage: the receipt scene reuses `ReceiptContent` (the same
// fetch+render body ReceiptDrawer.tsx's side-panel `<Drawer>` wraps for every other
// caller, unmodified in this phase) inside CenterStage's own scroll container
// instead of a separate right-side panel — "scroll preserved" because this is a
// client-side state swap within the already-mounted page, not a route navigation,
// so the window never re-scrolls to the top the way a real page nav would.
function ReceiptScene({ receiptId, rowLayoutId, onBack }: { receiptId: string; rowLayoutId: string; onBack: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onBack])
  return (
    <div className="space-y-3">
      {/* F7.T2 — FLOW-97 BackTrace: the only way back to the prior scene is this
          real click (or Escape above) — CenterStage below mirrors FLOW-15
          CameraPan's own transform for the return trip, driven by this same
          onBack call, not a scripted demo. */}
      <button
        type="button"
        onClick={onBack}
        className="j-chip flex items-center gap-1.5 border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)] hover:text-cyan-100"
      >
        ← Back
      </button>
      <div className="j-panel p-5">
        <ReceiptContent receiptId={receiptId} headerLayoutId={rowLayoutId} />
      </div>
    </div>
  )
}

function CenterStage({
  scene,
  forceLowPower,
  onToggleLowPower,
  receiptScene,
  onCloseReceipt,
}: {
  scene: SceneId
  forceLowPower: boolean
  onToggleLowPower: () => void
  receiptScene: ReceiptSceneRequest | null
  onCloseReceipt: () => void
}) {
  const { role } = useJarvisAuth()
  const reducedMotion = useReducedMotion()
  const data = useJarvis()
  // F7.T2 — FLOW-97 BackTrace: the incoming transform mirrors direction. Entering
  // the receipt scene is a forward hop (the existing FLOW-15 CameraPan transform,
  // unchanged); leaving it back to whichever scene was active before is the SAME
  // transform run in reverse (choreo.backTrace) — a real "previous key" ref, not a
  // hardcoded guess, so scene<->scene nav (overview/pipeline) still always reads
  // forward like it did before this phase.
  const activeKey = receiptScene ? "receipt" : scene
  const prevKeyRef = useRef(activeKey)
  const returning = prevKeyRef.current === "receipt" && activeKey !== "receipt"
  useEffect(() => {
    prevKeyRef.current = activeKey
  }, [activeKey])
  const enterChoreo = activeKey === "receipt" ? choreo.cameraPan : returning ? choreo.backTrace : choreo.cameraPan
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
          <div className="flex items-center gap-2">
            <SoundPreferenceToggle />
            <button type="button" onClick={onToggleLowPower} aria-pressed={forceLowPower} className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">
              {forceLowPower ? "Low power on" : "Low power off"}
            </button>
            {/* F6.T2 — FLOW-90 OfflineDrift's honest banner half: this chip used to
                read a hardcoded "live" regardless of reality. Now it names the real
                fast-lane reachability signal Orb3D's "error" state already keys on. */}
            {data.statsDegraded ? (
              <span className="j-chip bg-amber-400/12 text-amber-200">reconnecting</span>
            ) : (
              <span className="j-chip bg-cyan-400/10 text-cyan-200"><LiveDot /> live</span>
            )}
          </div>
        </div>
      </div>
      <div className="relative p-6 pb-24 [content-visibility:auto] [contain-intrinsic-size:1px_900px] lg:pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeKey}
            variants={reducedMotion ? enterChoreo.reducedVariants : enterChoreo.variants}
            initial="initial"
            animate="animate"
            // FLOW-42 SceneDock — the outgoing scene shrinks toward the nav rail
            // (choreo.sceneDockExit) instead of a plain fade; the incoming scene's
            // own `animate` (cameraPan forward or backTrace mirrored, both real)
            // reads as the unfurl.
            exit={(reducedMotion ? choreo.sceneDockExit.reducedVariants : choreo.sceneDockExit.variants).animate as TargetAndTransition}
            className="space-y-4"
          >
            {activeKey === "receipt" && receiptScene && (
              <ReceiptScene receiptId={receiptScene.receiptId} rowLayoutId={receiptScene.rowLayoutId} onBack={onCloseReceipt} />
            )}
            {activeKey !== "receipt" && scene === "overview" && (
              <>
                <SinceYouWereAway />
                <DailyBriefing />
                <KpiStrip />
                {role === "owner" && <CertificationStatus />}
              </>
            )}
            {activeKey !== "receipt" && scene === "pipeline" && <WorkflowTheater />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

function RightRail() {
  return (
    <aside className="sticky top-0 hidden h-screen w-80 shrink-0 flex-col gap-4 border-l border-white/6 bg-[#05090f]/85 p-4 backdrop-blur-xl lg:flex">
      <div className="min-h-0 flex-1">
        <ActivityTheater />
      </div>
      <div className="max-h-[45vh] overflow-y-auto">
        <ApprovalCockpit />
      </div>
    </aside>
  )
}

// F2.T4 — below `lg` (D1's own §1 finding: the fixed-width rails break under
// ~1100px) the left rail collapses to a top bar (orb + scene tabs) and the right
// rail collapses to a bottom dock sheet trigger with real badge counts — SAME
// underlying components (Orb3D/ActivityTheater/ApprovalCockpit), no duplicated
// data, no information loss, just a different real-estate arrangement.
function MobileTopBar({ scene, setScene, orderedScenes, forceLowPower }: { scene: SceneId; setScene: (s: SceneId) => void; orderedScenes: SceneId[]; forceLowPower: boolean }) {
  const orbLive = useOrbLiveState()
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/6 bg-[#05090f]/90 px-3 py-2 backdrop-blur-xl lg:hidden">
      <Link href="/jarvis" className="relative h-7 w-7 shrink-0">
        <Orb3D live={orbLive} forceLowPower={forceLowPower} />
      </Link>
      <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
        {orderedScenes.map((id) => {
          const { label, icon: Icon } = SCENES.find((candidate) => candidate.id === id)!
          const active = scene === id
          return (
            <button
              key={id}
              onClick={() => setScene(id)}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                active ? "bg-cyan-400/[0.12] text-cyan-200" : "text-[color:var(--j-text-dim)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function MobileDockTrigger({ onOpen }: { onOpen: () => void }) {
  const data = useJarvis()
  const pending = data.stats?.pending ?? 0
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-between rounded-full border border-white/10 bg-[#05090f]/95 px-4 py-3 text-[11px] font-bold text-[color:var(--j-text)] shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:hidden"
    >
      <span className="flex items-center gap-2"><LiveDot /> Activity &amp; Approvals</span>
      {pending > 0 && <span className="j-chip bg-cyan-400/12 text-cyan-200">{pending} pending</span>}
    </button>
  )
}

function MobileDockSheet({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="fixed inset-0 z-30 flex flex-col justify-end bg-black/60 lg:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Activity and approvals"
        className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#05090f] p-4"
        initial={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
        animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 340, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="j-label">Bridge dock</span>
          <button type="button" onClick={onClose} className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">
            Close
          </button>
        </div>
        <div className="min-h-[240px]">
          <ActivityTheater />
        </div>
        <ApprovalCockpit />
      </motion.div>
    </motion.div>
  )
}

// F2.T3 — FLOW-44 BridgeBoot: sessionStorage-gated like BootSequence's own
// `shouldShowBoot` convention (lib/BootSequence.tsx), but its OWN key — this is a
// separate, ≤1.4s Bridge-only intro (rails slide in, orb blooms once), not the
// legacy Shell's 2.5s full-screen checklist. Fires once per browser session on the
// first real `/jarvis/bridge` visit after sign-in, never again until a new session.
const BRIDGE_BOOT_SESSION_KEY = "jarvis_bridge_boot_shown"

function BridgeShell() {
  const [ledger, setLedger] = useState<FrecencyLedger>({})
  const orderedScenes = rankPanels(SCENES.map((entry) => entry.id), ledger, Date.now())
  const [scene, setScene] = useState<SceneId>("overview")
  const [daypart, setDaypart] = useState<ReturnType<typeof getDaypart>>("day")
  const [mounted, setMounted] = useState(false)
  const [forceLowPower, setForceLowPower] = useState(false)
  const [playBoot, setPlayBoot] = useState(false)
  const { session, loading } = useJarvisAuth()
  const palette = useCommandPaletteV2()
  const reducedMotion = useReducedMotion()
  const { mood, relighting } = useOfflineDrift()
  const [receiptScene, setReceiptScene] = useState<ReceiptSceneRequest | null>(null)

  // F7.T2 — FLOW-95 DrawerToPage: subscribes to real requests from ActivityTheater
  // (the only Bridge-side row source wired to this in this phase — ApprovalCockpit
  // keeps its existing side <ReceiptDrawer>, a deliberate scope narrowing to avoid
  // touching D2's sub-millisecond-undo keyboard/decision machinery in the same
  // session; noted in F-STATE as a Deviation, not silently dropped).
  useEffect(() => onReceiptSceneRequest(setReceiptScene), [])

  useEffect(() => {
    setMounted(true)
    setDaypart(getDaypart())
    setForceLowPower(initialLowPowerMode())
    let alreadyBooted = false
    try {
      alreadyBooted = window.sessionStorage.getItem(BRIDGE_BOOT_SESSION_KEY) === "1"
    } catch {
      alreadyBooted = false
    }
    setPlayBoot(!alreadyBooted)
    const id = window.setInterval(() => setDaypart(getDaypart()), 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  const skipBoot = () => {
    setPlayBoot(false)
    try {
      window.sessionStorage.setItem(BRIDGE_BOOT_SESSION_KEY, "1")
    } catch {
      // sessionStorage unavailable (private mode) — the boot simply replays next
      // visit, an honest degradation rather than a crash.
    }
  }
  useEffect(() => {
    if (!playBoot) return
    const t = window.setTimeout(skipBoot, 1400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playBoot])
  useEffect(() => {
    const raw = window.localStorage.getItem("finnor.jarvis.panel-frecency.v1")
    let prior: FrecencyLedger = {}
    if (raw) {
      try { prior = JSON.parse(raw) as FrecencyLedger } catch { window.localStorage.removeItem("finnor.jarvis.panel-frecency.v1") }
    }
    // Rendering the default overview is an actual open, so it earns one visit too.
    const initial = recordPanelOpen(prior, "overview", Date.now())
    window.localStorage.setItem("finnor.jarvis.panel-frecency.v1", JSON.stringify(initial))
    setLedger(initial)
  }, [])
  useEffect(() => {
    // Prefetch only actual authenticated APIs. A failure is deliberately ignored here:
    // the mounted panel retains its own honest loading/error state.
    const likely = orderedScenes[0]
    if (likely === "overview") void jarvisClient.overview()
    if (likely === "pipeline") void jarvisClient.workflowRuns()
  }, [orderedScenes])
  const chooseScene = (next: SceneId) => {
    setScene(next)
    setLedger((current) => {
      const updated = recordPanelOpen(current, next, Date.now())
      window.localStorage.setItem("finnor.jarvis.panel-frecency.v1", JSON.stringify(updated))
      return updated
    })
  }
  const toggleLowPower = () => {
    setForceLowPower((current) => {
      const next = !current
      persistLowPowerMode(next)
      return next
    })
  }
  const [dockOpen, setDockOpen] = useState(false)

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

  // F2.T3 — hard rule #10's ≤2-continuous-ambient-loops-per-viewport, ruled per Bridge
  // state (D1's own Orb-alone/full-Bridge FPS proof already measured the idle
  // baseline at ≥55; this documents which loops are allowed to be the "≤2" in each
  // state rather than letting every continuous loop run unconditionally forever):
  //   idle (no voice, nothing executing) — Orb3D's rAF wobble + ConsoleAtmosphere's
  //     aurora are the 2 that win; GridBackdrop's CSS scan/gridfloor are cheap
  //     transform/opacity loops layered UNDER them (same budget line C3/D1 already
  //     accepted), ParticleField's canvas idles at near-zero cost with 0 sparks/
  //     meteors in flight.
  //   executing (a real run in flight OR voiceState speaking) — Orb3D (now driven by
  //     real run/ring-dot count, and by real voice amplitude per FLOW-46) + the
  //     PulseLiquidGauges/VitalsBreath-visible PulseBar are the 2 that matter;
  //     ConsoleAtmosphere continues but is visually secondary at this point.
  //   blocked/error — Orb3D's own state color read is the signal; no NEW ambient
  //     loop is added by F2 for these states (HeaderTide/VitalsBreath already exist
  //     and simply change color/period, not loop count).
  // Every F2 addition here is either one-shot (OrbAuraRipple, EventMeteor, BootBloom,
  // SceneDock) or a 5s-interval-recomputed style value (HeaderTide, VitalsBreath's
  // heartbeatPeriodSec) — none of them are a NEW standing rAF/CSS-infinite loop.
  return (
    <div
      className="jarvis-cursor-zone jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]"
      data-mood={mood}
      data-relighting={relighting || undefined}
      data-daypart={daypart}
      data-low-power={forceLowPower || undefined}
    >
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        data-jarvis-atmosphere
        style={{ opacity: "var(--aurora-opacity)", backgroundColor: "var(--day-tint)", transition: "background-color 2s ease" }}
      >
        {!forceLowPower && <ConsoleAtmosphere />}
      </div>
      {/* F6.T2 — FLOW-90 OfflineDrift's "reconnect relights in cascade" half: a single
          one-shot light sweep left->right the instant `data.statsDegraded` flips back
          to false, formalizing the mood-driven aurora dim above (which fades back on
          the real `[data-jarvis-atmosphere]` 2s opacity transition F4.T3/FLOW-71 added
          — this comment previously claimed that transition already existed at 0.6s;
          re-probed while building F4 and it didn't, jarvis-theme.css now genuinely
          has it) with a real "this just recovered" event rather than a silent color
          settle. GPU-safe transform/opacity only; reduced motion collapses to an
          instant flash via useOfflineDrift keeping the same 900ms window either way
          (AnimatePresence unmount handles it). */}
      {relighting && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-10"
          initial={reducedMotion ? { opacity: 0.5 } : { opacity: 0, x: "-100%" }}
          animate={reducedMotion ? { opacity: 0 } : { opacity: [0, 0.35, 0], x: "100%" }}
          transition={{ duration: reducedMotion ? 0.3 : 0.9, ease: "easeOut" }}
          style={{ background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.5), transparent)" }}
        />
      )}
      <ParticleField disabled={forceLowPower} />
      <MobileTopBar scene={scene} setScene={chooseScene} orderedScenes={orderedScenes} forceLowPower={forceLowPower} />
      {/* FLOW-44 BridgeBoot — `onClick` only ever shortens an already-running boot
          (playBoot false is a no-op call); it never intercepts normal interaction. */}
      <div className="relative flex" onClick={playBoot ? skipBoot : undefined}>
        <motion.div
          initial={playBoot && !reducedMotion ? { opacity: 0, x: -24 } : { opacity: 1, x: 0 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, ease: [0, 0, 0.2, 1] }}
        >
          <LeftRail scene={scene} setScene={chooseScene} orderedScenes={orderedScenes} unopened={orderedScenes.filter((id) => !ledger[id])} forceLowPower={forceLowPower} bootBloom={playBoot && !reducedMotion} />
        </motion.div>
        <CenterStage
          scene={scene}
          forceLowPower={forceLowPower}
          onToggleLowPower={toggleLowPower}
          receiptScene={receiptScene}
          onCloseReceipt={() => setReceiptScene(null)}
        />
        <motion.div
          initial={playBoot && !reducedMotion ? { opacity: 0, x: 24 } : { opacity: 1, x: 0 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, ease: [0, 0, 0.2, 1] }}
        >
          <RightRail />
        </motion.div>
      </div>
      <MobileDockTrigger onOpen={() => setDockOpen(true)} />
      <AnimatePresence>{dockOpen && <MobileDockSheet onClose={() => setDockOpen(false)} />}</AnimatePresence>
      {palette.open && <CommandPaletteV2 onClose={() => palette.setOpen(false)} onNavigate={chooseScene} />}
      {!forceLowPower && <ConstellationLink />}
      <QueryFpsMeterHud />
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
