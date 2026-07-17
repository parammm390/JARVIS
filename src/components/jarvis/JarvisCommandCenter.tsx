"use client"

// FINNOR JARVIS — live AI command center for water treatment dealers.
// Full-bleed dark command center: fixed sidebar (nav + real system-status card +
// profile), greeting header, KPI band, live workflow graph, active call, analytics,
// dock panels, glowing command pill. Every number LIVE or DERIVED; SSR-shell +
// mounted-flag hydration pattern preserved; the 7 original feature views intact.

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { MotionConfig, motion } from "framer-motion"
import "./jarvis-theme.css"
import { ConsoleAtmosphere, LiveDot } from "./atmosphere"
import { CustomCursor } from "./CustomCursor"
import { setMuted, sfx } from "./sound"
import { LeadsView, WorkflowsView, InventoryView, InvoicesView, ComplianceView, ResearchView, VoiceConsoleView } from "./views"
import { JarvisDataProvider, useJarvis } from "./lib/data-core"
import { useVapiSession } from "./lib/useVapiSession"
import { useCommandPalette, CommandPalette } from "./lib/CommandPalette"
import { BootSequence, shouldShowBoot } from "./lib/BootSequence"
import { AreaSparkline } from "./lib/charts"
import { HeaderBand } from "./panels/HeaderBand"
import { KpiStrip } from "./panels/KpiStrip"
import { OpsTicker } from "./panels/OpsTicker"
import { WorkflowTheater } from "./panels/WorkflowTheater"
import { ApprovalDock } from "./panels/ApprovalDock"
import { CommsFeed } from "./panels/CommsFeed"
import { ActivityRail } from "./panels/ActivityRail"
import { PipelinePulse } from "./panels/PipelinePulse"
import { CommandBar } from "./panels/CommandBar"
import { ChannelDonut, ActionMixBars, AiPerformance } from "./panels/AnalyticsRow"
import { SystemConsole } from "./panels/SystemConsole"
import { JarvisOrb } from "./panels/JarvisOrb"
import { Activity, Boxes, CircleDollarSign, FlaskConical, Globe, LayoutGrid, PhoneCall, Users, Volume2, VolumeX, Workflow } from "lucide-react"

const LiveCallPanel = dynamic(() => import("./panels/LiveCallPanel").then((m) => m.LiveCallPanel), { ssr: false })

const SIDEBAR = [
  { icon: LayoutGrid, label: "Command Center" },
  { icon: PhoneCall, label: "Voice Console" },
  { icon: Users, label: "Leads & CRM" },
  { icon: Workflow, label: "Workflows" },
  { icon: Boxes, label: "Inventory" },
  { icon: CircleDollarSign, label: "Invoices" },
  { icon: FlaskConical, label: "Water Compliance" },
  { icon: Globe, label: "Web Research" },
  { icon: Activity, label: "Activity" },
]

function CommandCenterHome({ session, prefill, onNavigate }: { session: ReturnType<typeof useVapiSession>; prefill?: string; onNavigate: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <HeaderBand session={session} />
      <KpiStrip onNavigate={onNavigate} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <WorkflowTheater />
        <LiveCallPanel session={session} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SystemConsole />
        <ChannelDonut />
        <ActionMixBars />
        <AiPerformance />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PipelinePulse />
        <ApprovalDock />
        <CommsFeed />
        <ActivityRail />
      </div>
      <CommandBar session={session} prefill={prefill} />
    </div>
  )
}

function Sidebar({ view, setView }: { view: string; setView: (v: string) => void }) {
  const data = useJarvis()
  const live = !data.statsDegraded && data.stats !== null
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/6 bg-[#05090f]/85 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex items-center gap-3 px-5 pb-5 pt-6">
        <JarvisOrb size={34} voiceState="idle" degraded={!live} />
        <div>
          <div className="text-[15px] font-black tracking-tight text-[color:var(--j-text)]">JARVIS</div>
          <div className="text-[8.5px] font-bold uppercase tracking-[0.28em] text-[color:var(--j-text-faint)]">Finnor Voice AI OS</div>
        </div>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {SIDEBAR.map(({ icon: Icon, label }) => {
          const active = view === label
          return (
            <button
              key={label}
              onClick={() => {
                setView(label)
                sfx.tick()
              }}
              className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-bold transition ${
                active ? "bg-cyan-400/[0.08] text-[color:var(--j-text)]" : "text-[color:var(--j-text-dim)] hover:bg-white/[0.04] hover:text-[color:var(--j-text)]"
              }`}
            >
              {active && <motion.span layoutId="jarvis-nav-glow" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />}
              <Icon className={`h-4 w-4 ${active ? "text-cyan-300" : ""}`} />
              {label}
              {label === "Command Center" && (data.stats?.pending ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-cyan-300 px-2 py-0.5 text-[10px] font-black text-slate-950">{data.stats?.pending}</span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="space-y-3 px-4 pb-5">
        <div className="j-panel !rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className={`relative flex h-2 w-2 ${live ? "" : "opacity-80"}`}>
              <span className={`absolute h-full w-full animate-ping rounded-full opacity-60 ${live ? "bg-emerald-300" : "bg-amber-300"}`} />
              <span className={`relative h-2 w-2 rounded-full ${live ? "bg-emerald-300" : "bg-amber-300"}`} />
            </span>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">System Status</div>
              <div className={`text-[11px] font-black ${live ? "text-emerald-300" : "text-amber-300"}`}>{live ? "Connected · Live" : "Standalone"}</div>
            </div>
          </div>
          {data.latencyHistory.length > 1 && (
            <div className="mt-2">
              <AreaSparkline values={data.latencyHistory} width={186} height={30} color={live ? "var(--j-green)" : "var(--j-amber)"} className="w-full" />
              <div className="mt-0.5 text-[8px] font-bold uppercase tracking-widest text-[color:var(--j-text-faint)]">api latency · measured live</div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-[11px] font-black text-slate-950">PD</div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold text-[color:var(--j-text)]">Param Dave</div>
            <div className="text-[9.5px] text-[color:var(--j-text-faint)]">Owner</div>
          </div>
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-300" />
        </div>
      </div>
    </aside>
  )
}

function Shell() {
  const data = useJarvis()
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState("Command Center")
  const [soundOn, setSoundOn] = useState(true)
  const [booting, setBooting] = useState(false)
  const [prefill, setPrefill] = useState<string | undefined>(undefined)
  const session = useVapiSession()
  const palette = useCommandPalette()

  useEffect(() => {
    setMounted(true)
    setBooting(shouldShowBoot())
  }, [])
  useEffect(() => setMuted(!soundOn), [soundOn])

  const live = !data.statsDegraded && data.stats !== null

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070f]">
        <div className="flex items-center gap-3 text-lg font-black tracking-tight text-white">
          <span className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-cyan-400/20 text-xs font-black text-cyan-200 shadow-lg">F</span>
          Waking JARVIS…
        </div>
      </div>
    )
  }

  return (
    <div className="jarvis-cursor-zone jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]">
      {/* atmosphere pinned behind everything */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <ConsoleAtmosphere />
        <div className="jarvis-gridfloor jarvis-ambient" aria-hidden />
      </div>

      <CustomCursor />
      {booting && <BootSequence onDone={() => setBooting(false)} />}
      {palette.open && (
        <CommandPalette
          onClose={() => palette.setOpen(false)}
          onSelectView={(v) => setView(v)}
          onPrefillInstruction={(text) => {
            setView("Command Center")
            setPrefill(text)
          }}
        />
      )}

      <div className="relative flex">
        <Sidebar view={view} setView={setView} />

        <main className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-white/6 bg-[#05090f]/70 pr-3 backdrop-blur-xl">
            <div className="min-w-0 flex-1">
              <OpsTicker soundOn={soundOn} onToggleSound={() => setSoundOn((v) => !v)} />
            </div>
            <span className={`j-chip shrink-0 uppercase tracking-widest ${live ? "bg-teal-300/12 text-teal-200" : "bg-amber-300/12 text-amber-200"}`}>
              {live && <LiveDot />}
              {live ? "Live" : "Simulation"}
            </span>
          </div>

          {/* mobile view switcher */}
          <div className="flex gap-2 overflow-x-auto px-4 pb-1 pt-3 lg:hidden">
            {SIDEBAR.map(({ label }) => (
              <button
                key={label}
                onClick={() => setView(label)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
                  view === label ? "bg-cyan-300 text-slate-950" : "border border-white/12 text-white/55"
                }`}
              >
                {label.replace(" & CRM", "").replace("Water ", "")}
              </button>
            ))}
          </div>

          <div className="p-4 md:p-6">
            {view === "Command Center" && <CommandCenterHome session={session} prefill={prefill} onNavigate={setView} />}
            {view === "Voice Console" && <VoiceConsoleView voiceState={session.voiceState === "speaking" ? "live" : session.voiceState} toggleVoice={session.toggleVoice} feed={session.transcript} />}
            {view === "Leads & CRM" && <LeadsView />}
            {view === "Workflows" && <WorkflowsView />}
            {view === "Inventory" && <InventoryView />}
            {view === "Invoices" && <InvoicesView />}
            {view === "Water Compliance" && <ComplianceView />}
            {view === "Web Research" && <ResearchView />}
            {view === "Activity" && <ActivityRail />}
          </div>

          <p className="px-4 pb-6 text-center text-[10.5px] text-[color:var(--j-text-faint)]">
            Every consequential action stops at the approval gate — enforced in the executor and the database, logged immutably.{" "}
            <Link href="/" className="font-black text-[color:var(--j-text-dim)] underline-offset-2 hover:underline">← finnorai.com</Link>
          </p>
        </main>
      </div>
    </div>
  )
}

export default function JarvisCommandCenter() {
  return (
    <MotionConfig reducedMotion="user">
      <JarvisDataProvider>
        <Shell />
      </JarvisDataProvider>
    </MotionConfig>
  )
}
