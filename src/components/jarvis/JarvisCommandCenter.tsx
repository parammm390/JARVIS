"use client"

// FINNOR JARVIS — live AI command center for water treatment dealers.
// Full-bleed dark command center: fixed sidebar (nav + real system-status card +
// profile), greeting header, KPI band, live workflow graph, active call, analytics,
// dock panels, glowing command pill. Every number LIVE or DERIVED; SSR-shell +
// mounted-flag hydration pattern preserved; the 7 original feature views intact.

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { MotionConfig, motion } from "framer-motion"
import "./jarvis-theme.css"
import { ConsoleAtmosphere, LiveDot } from "./atmosphere"
import { CustomCursor } from "./CustomCursor"
import { setMuted, sfx } from "./sound"
import { LeadsView, WorkflowsView, InventoryView, InvoicesView, ComplianceView, ResearchView, VoiceConsoleView, CustomersView, SystemHealthView } from "./views"
import { JarvisDataProvider, useJarvis } from "./lib/data-core"
import { JarvisAuthProvider, useJarvisAuth } from "./lib/jarvis-auth"
import { useVapiSession } from "./lib/useVapiSession"
import { deriveMood } from "./lib/mood"
import { EventFXLayer } from "./lib/EventFX"
import { useCommandPalette, CommandPalette } from "./lib/CommandPalette"
import { BootSequence, shouldShowBoot } from "./lib/BootSequence"
import { AreaSparkline } from "./lib/charts"
import { HeaderBand } from "./panels/HeaderBand"
import { KpiStrip } from "./panels/KpiStrip"
import { OpsTicker } from "./panels/OpsTicker"
import { WorkflowTheater } from "./panels/WorkflowTheater"
import { ApprovalDock } from "./panels/ApprovalDock"
import { DailyBriefing } from "./panels/DailyBriefing"
import { DegradedBanner } from "./panels/DegradedBanner"
import { DataQualityQueue } from "./panels/DataQualityQueue"
import { DlqBrowser } from "./panels/DlqBrowser"
import { CertificationStatus } from "./panels/CertificationStatus"
import { DispatcherBoard } from "./panels/DispatcherBoard"
import { TechnicianBoard } from "./panels/TechnicianBoard"
import { CommsFeed } from "./panels/CommsFeed"
import { ActivityRail } from "./panels/ActivityRail"
import { PipelinePulse } from "./panels/PipelinePulse"
import { CommandBar } from "./panels/CommandBar"
import { ChannelDonut, ActionMixBars, AiPerformance } from "./panels/AnalyticsRow"
import { SystemConsole } from "./panels/SystemConsole"
import { JarvisOrb } from "./panels/JarvisOrb"
import { Activity, BookUser, Boxes, CircleDollarSign, FlaskConical, Globe, LayoutGrid, PhoneCall, ShieldCheck, Users, Volume2, VolumeX, Workflow } from "lucide-react"

const LiveCallPanel = dynamic(() => import("./panels/LiveCallPanel").then((m) => m.LiveCallPanel), { ssr: false })
const ParticleField = dynamic(() => import("./panels/ParticleField").then((m) => m.ParticleField), { ssr: false })

const SIDEBAR = [
  { icon: LayoutGrid, label: "Command Center" },
  { icon: PhoneCall, label: "Voice Console" },
  { icon: Users, label: "Leads & CRM" },
  { icon: BookUser, label: "Customers" },
  { icon: Workflow, label: "Workflows" },
  { icon: Boxes, label: "Inventory" },
  { icon: CircleDollarSign, label: "Invoices" },
  { icon: FlaskConical, label: "Water Compliance" },
  { icon: Globe, label: "Web Research" },
  { icon: Activity, label: "Activity" },
  { icon: ShieldCheck, label: "Production Readiness" },
]

function CommandCenterHome({
  session,
  prefill,
  onNavigate,
  igniteKey,
}: {
  session: ReturnType<typeof useVapiSession>
  prefill?: string
  onNavigate: (v: string) => void
  igniteKey: number
}) {
  const delay = (idx: number) => ({ animationDelay: `${idx * 60}ms` }) as React.CSSProperties
  return (
    <div className="space-y-4">
      <div key={`${igniteKey}-0`} className="jarvis-rise" style={delay(0)}>
        <HeaderBand session={session} />
      </div>
      <div key={`${igniteKey}-0a`} className="jarvis-rise" style={delay(0)}>
        <DegradedBanner />
      </div>
      <div key={`${igniteKey}-0b`} className="jarvis-rise" style={delay(0)}>
        <DailyBriefing />
      </div>
      <div key={`${igniteKey}-1`} className="jarvis-rise" style={delay(1)}>
        <KpiStrip onNavigate={onNavigate} />
      </div>
      <div key={`${igniteKey}-1b`} className="jarvis-rise" style={delay(1)}>
        <DispatcherBoard />
      </div>
      <div key={`${igniteKey}-1c`} className="jarvis-rise" style={delay(1)}>
        <TechnicianBoard />
      </div>
      <div key={`${igniteKey}-2`} className="jarvis-rise grid grid-cols-1 gap-4 xl:grid-cols-3" style={delay(2)}>
        <WorkflowTheater />
        <LiveCallPanel session={session} />
      </div>
      <div key={`${igniteKey}-3`} className="jarvis-rise grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" style={delay(3)}>
        <SystemConsole />
        <ChannelDonut />
        <ActionMixBars />
        <AiPerformance />
      </div>
      <div key={`${igniteKey}-4`} className="jarvis-rise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={delay(4)}>
        <PipelinePulse />
        <ApprovalDock />
        <CommsFeed />
        <ActivityRail />
      </div>
      <div key={`${igniteKey}-4b`} className="jarvis-rise grid grid-cols-1 gap-4 xl:grid-cols-2" style={delay(4)}>
        <DataQualityQueue />
        <DlqBrowser />
      </div>
      <div key={`${igniteKey}-4c`} className="jarvis-rise" style={delay(4)}>
        <CertificationStatus />
      </div>
      <div key={`${igniteKey}-5`} className="jarvis-rise" style={delay(5)}>
        <CommandBar session={session} prefill={prefill} />
      </div>
    </div>
  )
}

function SidebarProfile() {
  const { session, loading, signOut } = useJarvisAuth()
  if (loading) return null
  if (!session) {
    return (
      <Link href="/jarvis/login" className="flex items-center gap-2.5 rounded-xl px-1 py-1.5 text-[12px] font-bold text-[color:var(--j-text-dim)] hover:text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-[11px] font-black">?</div>
        Sign in
      </Link>
    )
  }
  const email = session.user.email ?? "Signed in"
  const initials = email.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-[11px] font-black text-slate-950">{initials}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-bold text-[color:var(--j-text)]">{email}</div>
        <button onClick={() => void signOut()} className="text-[9.5px] text-[color:var(--j-text-faint)] hover:text-white">
          Sign out
        </button>
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
    </div>
  )
}

// Phase 7 (§7.9, mobile-capable cockpit): the desktop sidebar (and its sign-in link)
// is `hidden lg:flex` — below that breakpoint there was previously NO way to reach
// /jarvis/login at all, which would make "mobile approval in two taps" (the pack's
// own exit-gate wording) impossible. This is the same sign-in affordance, compact,
// for the `lg:hidden` mobile header.
function MobileProfileChip() {
  const { session, loading, signOut } = useJarvisAuth()
  if (loading) return null
  if (!session) {
    return (
      <Link
        href="/jarvis/login"
        className="j-chip shrink-0 border border-white/12 text-white/70 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        Sign in
      </Link>
    )
  }
  return (
    <button
      onClick={() => void signOut()}
      className="j-chip shrink-0 border border-white/12 text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
    >
      Sign out
    </button>
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
              <Icon className={`h-4 w-4 transition-colors duration-200 ${active ? "text-cyan-300" : ""}`} />
              {label}
              {label === "Command Center" && (data.stats?.pending ?? 0) > 0 && (
                <span key={data.stats?.pending} className="jarvis-pop ml-auto rounded-full bg-cyan-300 px-2 py-0.5 text-[10px] font-black text-slate-950">
                  {data.stats?.pending}
                </span>
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
        <SidebarProfile />
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
  const [igniteKey, setIgniteKey] = useState(0)
  const wasDegradedRef = useRef(false)
  const session = useVapiSession()
  const palette = useCommandPalette()

  useEffect(() => {
    setMounted(true)
    setBooting(shouldShowBoot())
  }, [])
  useEffect(() => setMuted(!soundOn), [soundOn])

  useEffect(() => {
    if (wasDegradedRef.current && !data.statsDegraded) setIgniteKey((k) => k + 1)
    wasDegradedRef.current = data.statsDegraded
  }, [data.statsDegraded])

  const live = !data.statsDegraded && data.stats !== null
  const mood = deriveMood({ voiceLive: session.voiceState === "live" || session.voiceState === "speaking", degraded: data.statsDegraded })

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
    <div className="jarvis-cursor-zone jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]" data-mood={mood}>
      {/* atmosphere pinned behind everything */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ opacity: "var(--aurora-opacity)" }}>
        <ConsoleAtmosphere />
        <div className="jarvis-gridfloor jarvis-ambient" aria-hidden />
      </div>
      <ParticleField />
      <EventFXLayer />
      <div
        className="pointer-events-none fixed inset-0 z-20 transition-opacity duration-700"
        style={{ boxShadow: "inset 0 0 140px 30px rgba(2,6,16,0.85)", opacity: mood === "voice" ? 0.5 : 0 }}
        aria-hidden
      />

      <CustomCursor />
      {booting && (
        <BootSequence
          onDone={() => {
            setBooting(false)
            setIgniteKey((k) => k + 1)
          }}
        />
      )}
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
              <span key={live ? "live" : "sim"} className="jarvis-flip-in inline-flex items-center gap-[0.3rem]">
                {live && <LiveDot />}
                {live ? "Live" : "Simulation"}
              </span>
            </span>
            <div className="lg:hidden">
              <MobileProfileChip />
            </div>
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
            {view === "Command Center" && <CommandCenterHome session={session} prefill={prefill} onNavigate={setView} igniteKey={igniteKey} />}
            {view === "Voice Console" && (
              <VoiceConsoleView
                voiceState={
                  session.voiceState === "speaking"
                    ? "live"
                    : session.voiceState === "error"
                      ? "idle"
                      : session.voiceState
                }
                toggleVoice={session.toggleVoice}
                feed={session.transcript}
              />
            )}
            {view === "Leads & CRM" && <LeadsView />}
            {view === "Customers" && <CustomersView />}
            {view === "Workflows" && <WorkflowsView />}
            {view === "Inventory" && <InventoryView />}
            {view === "Invoices" && <InvoicesView />}
            {view === "Water Compliance" && <ComplianceView />}
            {view === "Web Research" && <ResearchView />}
            {view === "Activity" && <ActivityRail />}
            {view === "Production Readiness" && <SystemHealthView />}
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
      <JarvisAuthProvider>
        <JarvisDataProvider>
          <Shell />
        </JarvisDataProvider>
      </JarvisAuthProvider>
    </MotionConfig>
  )
}
