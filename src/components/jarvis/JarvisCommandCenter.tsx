"use client"

// FINNOR JARVIS — live AI command center for water treatment dealers.
// Everything on this screen is wired to the real Finnor OS API: the queue, the
// pipeline, the outbox, inventory, the command bar, and the voice session. When the
// backend is unreachable it drops into a clearly-labeled SIMULATION mode so the
// experience stays alive — and flips itself back to LIVE the moment the API answers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import { ConsoleAtmosphere, Glass } from "./atmosphere"
import { CustomCursor } from "./CustomCursor"
import { sfx, setMuted } from "./sound"
import { LeadsView, WorkflowsView, InventoryView, InvoicesView, ComplianceView, ResearchView, VoiceConsoleView } from "./views"
import {
  Activity,
  AudioLines,
  BadgeCheck,
  Boxes,
  BrainCircuit,
  CalendarClock,
  Check,
  CircleDollarSign,
  Command,
  FlaskConical,
  Globe,
  LayoutGrid,
  Mic,
  MicOff,
  PhoneCall,
  Radar,
  Send,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from "lucide-react"

const API = process.env.NEXT_PUBLIC_OS_API_URL ?? "https://finnor-os-api.vercel.app"
const TENANT = process.env.NEXT_PUBLIC_OS_TENANT_ID ?? "00000000-0000-4000-8000-000000000001"
const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "ab65d198-5573-4d95-b7f2-4fd8db6f85fc"
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "59863f35-236e-4451-9cb8-cd8df4a3c440"

const HEADERS = { "content-type": "application/json", "x-tenant-id": TENANT, "x-user-role": "owner" }

interface ActionRow {
  id: string
  actionType: string
  status: string
  summary: string | null
  createdAt: string
}
interface OutboxRow {
  id: string
  channel: string
  toNumber: string
  content: string
  simulated: boolean
  createdAt: string
}
interface InventoryRow {
  sku: string
  name: string
  quantity: number
  reorderThreshold: number
}
interface WorkflowRow {
  workflow: string
  subjectType: string
  state: string
  updatedAt: string
}
interface Stats {
  pending: number
  blocked: number
  recentActions: ActionRow[]
  recentAudit: Array<{ step: string; timestamp: string; domainActionId: string }>
  outbox: OutboxRow[]
  inventory: InventoryRow[]
  workflows: WorkflowRow[]
  invoices: Array<{ amountUsd: string; status: string; createdAt: string }>
}

// ---------------------------------------------------------------------------
// Simulation dataset — shown ONLY when the live backend is unreachable, always
// labeled. Shaped exactly like real data so the UI is identical either way.
// ---------------------------------------------------------------------------
const SIM: Stats = {
  pending: 2,
  blocked: 1,
  recentActions: [
    { id: "sim-1", actionType: "schedule_water_test", status: "pending", summary: "Schedule a water test at 412 Maple Ridge Rd on Tuesday 10:00 with the next available technician. Approve?", createdAt: new Date().toISOString() },
    { id: "sim-2", actionType: "send_proposal_to_recent_installs", status: "pending", summary: "Send a follow-up proposal to 3 recent installs: The Hendersons; Ruth Alvarez; Marcus Webb. Approve to send all?", createdAt: new Date(Date.now() - 4 * 60000).toISOString() },
    { id: "sim-3", actionType: "check_stock_level", status: "completed", summary: "Check stock level for RO membranes.", createdAt: new Date(Date.now() - 9 * 60000).toISOString() },
    { id: "sim-4", actionType: "create_lead", status: "completed", summary: "Create a new lead: Sarah Kim (+1319555••••) at 314 Overlook Dr.", createdAt: new Date(Date.now() - 16 * 60000).toISOString() },
  ],
  recentAudit: ["reflection", "execute", "confirmed", "gate", "draft", "validate", "planned"].map((step, i) => ({
    step,
    timestamp: new Date(Date.now() - i * 90000).toISOString(),
    domainActionId: "sim-1",
  })),
  outbox: [
    { id: "so-1", channel: "sms", toNumber: "+1 319 555 ••42", content: "Your annual filter change is due next week — we can come Tuesday or Thursday.", simulated: true, createdAt: new Date(Date.now() - 3 * 60000).toISOString() },
    { id: "so-2", channel: "call", toNumber: "+1 319 555 ••77", content: "Renewal offer read-back for the annual maintenance plan.", simulated: true, createdAt: new Date(Date.now() - 12 * 60000).toISOString() },
  ],
  inventory: [
    { sku: "SED-FILT-10", name: '10" Sediment Filter', quantity: 24, reorderThreshold: 10 },
    { sku: "CARB-FILT-10", name: '10" Carbon Filter', quantity: 18, reorderThreshold: 8 },
    { sku: "RO-MEM-75", name: "RO Membrane 75 GPD", quantity: 4, reorderThreshold: 3 },
    { sku: "RESIN-CUFT", name: "Softener Resin (cu ft)", quantity: 12, reorderThreshold: 4 },
  ],
  workflows: [
    { workflow: "lead_to_install", subjectType: "household", state: "water_test_scheduled", updatedAt: new Date().toISOString() },
    { workflow: "amc_renewal", subjectType: "maintenance_agreement", state: "renewal_sent", updatedAt: new Date(Date.now() - 40 * 60000).toISOString() },
  ],
  invoices: [],
}

// Ambient operations stream — cycles through the breadth of what the OS does.
const OPS_STREAM = [
  { icon: "📞", text: "Inbound call answered — sulfur smell, well water, Fort Wayne" },
  { icon: "🧪", text: "Water test booked · Tuesday 10:00 · Maple Ridge Rd" },
  { icon: "💬", text: "Filter-change reminder texted to 3 households" },
  { icon: "📦", text: "RO membranes at reorder threshold — flagged" },
  { icon: "🔎", text: "Competitor scan finished · 4 dealers found near Cedar Falls" },
  { icon: "🧾", text: "Invoice #2481 marked paid · $249 annual maintenance" },
  { icon: "🛡️", text: "PFAS compliance summary generated vs EPA 4 ppt MCL" },
  { icon: "🗓️", text: "Dale Brooks assigned · lead follow-up · 9 River Bend Ct" },
  { icon: "🧠", text: "Renewal window detected — 21 days out · Henderson AMC" },
  { icon: "✉️", text: "Post-install proposal drafted for 3 recent installs" },
  { icon: "🌊", text: "Hardness 18 gpg classified very hard · softener sized 48k grain" },
  { icon: "✅", text: "Owner approved by voice · executed · logged immutably" },
]

const PIPELINE = [
  { key: "planned", label: "Instruction Planned", icon: BrainCircuit },
  { key: "validate", label: "Validated", icon: ShieldCheck },
  { key: "gate", label: "Approval Gate", icon: Radar },
  { key: "confirmed", label: "You Approved", icon: BadgeCheck },
  { key: "execute", label: "Executed + Logged", icon: Activity },
] as const

const SIDEBAR = [
  { icon: LayoutGrid, label: "Command Center", active: true },
  { icon: PhoneCall, label: "Voice Console" },
  { icon: Users, label: "Leads & CRM" },
  { icon: Workflow, label: "Workflows" },
  { icon: Boxes, label: "Inventory" },
  { icon: CircleDollarSign, label: "Invoices" },
  { icon: FlaskConical, label: "Water Compliance" },
  { icon: Globe, label: "Web Research" },
]

function timeAgoRaw(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export default function JarvisCommandCenter() {
  const [stats, setStats] = useState<Stats>(SIM)
  const [live, setLive] = useState(false)
  // Relative timestamps differ between the server render and the client — render them
  // only after mount to keep hydration byte-identical.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const timeAgo = (iso: string) => (mounted ? timeAgoRaw(iso) : "just now")
  const [clock, setClock] = useState("")
  const [pipelineStage, setPipelineStage] = useState(0)
  const [command, setCommand] = useState("")
  const [busy, setBusy] = useState(false)
  const [feed, setFeed] = useState<Array<{ role: "you" | "jarvis"; text: string }>>([
    { role: "jarvis", text: "Finnor's up. Type an instruction below, or start a voice session — I'll draft the work and wait for your approval before anything real happens." },
  ])
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "live">("idle")
  const [soundOn, setSoundOn] = useState(true)
  const [view, setView] = useState("Command Center")
  const [opsIndex, setOpsIndex] = useState(0)
  const [decided, setDecided] = useState<Set<string>>(new Set())
  const vapiRef = useRef<{ start: (id: string) => void; stop: () => void; on: (e: string, cb: (m?: unknown) => void) => void } | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)

  // ---- live clock ----
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(t)
  }, [])

  // ---- live stats polling; auto LIVE/SIM switching ----
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`, { headers: HEADERS, cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as Stats
      setStats(data)
      setLive(true)
    } catch {
      setLive(false)
      setStats((prev) => (prev === SIM ? SIM : prev))
    }
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  // ---- pipeline stage: derived from the real audit trail, ambient when idle ----
  useEffect(() => {
    const steps = stats.recentAudit.map((a) => a.step)
    const idx = PIPELINE.findIndex((p) => steps[0] === p.key || (p.key === "execute" && steps[0] === "reflection"))
    if (idx >= 0) {
      setPipelineStage(idx)
      return
    }
    const t = setInterval(() => setPipelineStage((s) => (s + 1) % PIPELINE.length), 2600)
    return () => clearInterval(t)
  }, [stats.recentAudit])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" })
  }, [feed])

  // live ops ticker — real audit events lead when connected, ambient stream fills in
  useEffect(() => {
    const t = setInterval(() => setOpsIndex((i) => i + 1), 3200)
    return () => clearInterval(t)
  }, [])

  useEffect(() => setMuted(!soundOn), [soundOn])
  const prevStage = useRef(0)
  useEffect(() => {
    if (pipelineStage !== prevStage.current) {
      prevStage.current = pipelineStage
      sfx.tick()
    }
  }, [pipelineStage])

  // ---- command bar → real planner ----
  async function runCommand() {
    const instruction = command.trim()
    if (!instruction || busy) return
    sfx.send()
    setCommand("")
    setBusy(true)
    setFeed((f) => [...f, { role: "you", text: instruction }])
    try {
      const res = await fetch(`${API}/api/actions`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ instruction }),
      })
      const body = (await res.json()) as { planned?: Array<{ actionType: string }>; error?: string }
      if (!res.ok) throw new Error(body.error ?? "planning failed")
      const n = body.planned?.length ?? 0
      setFeed((f) => [
        ...f,
        {
          role: "jarvis",
          text:
            n === 0
              ? "I couldn't map that to an action yet — try naming the customer, task, or item."
              : `Planned ${n} action${n === 1 ? "" : "s"}: ${body.planned!.map((p) => p.actionType.replaceAll("_", " ")).join(", ")}. Anything consequential is now waiting in the approval queue on the left.`,
        },
      ])
      load()
    } catch (e) {
      setFeed((f) => [
        ...f,
        {
          role: "jarvis",
          text: live
            ? `That hit a snag: ${(e as Error).message}. It's parked safely — nothing was sent.`
            : "The live backend isn't connected on this deployment yet, so I can't execute — but this exact command works against the real planner the moment it is.",
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  // ---- approve / reject (the real gate) ----
  async function decide(id: string, verb: "confirm" | "reject") {
    verb === "confirm" ? sfx.approve() : sfx.reject()
    setDecided((d) => new Set(d).add(id))
    if (!live || id.startsWith("sim-")) {
      setFeed((f) => [...f, { role: "jarvis", text: verb === "confirm" ? "Approved (simulation) — in live mode this executes and lands in the audit log." : "Rejected (simulation)." }])
      return
    }
    try {
      const res = await fetch(`${API}/api/actions/${id}/${verb}`, { method: "POST", headers: HEADERS, body: "{}" })
      const body = (await res.json()) as { result?: { status?: string; error?: string } }
      setFeed((f) => [
        ...f,
        {
          role: "jarvis",
          text:
            verb === "reject"
              ? "Rejected — nothing will be sent."
              : body.result?.status === "success"
                ? "Approved and executed. It's in the audit log."
                : `Approved, but execution reported: ${body.result?.error ?? "check the queue"}.`,
        },
      ])
    } catch {
      setDecided((d) => {
        const next = new Set(d)
        next.delete(id)
        return next
      })
    }
    load()
  }

  // ---- voice via Vapi Web SDK (browser mic — no phone line needed) ----
  useEffect(() => {
    let mounted = true
    import("@vapi-ai/web").then(({ default: Vapi }) => {
      if (!mounted) return
      const vapi = new Vapi(VAPI_PUBLIC_KEY)
      vapi.on("call-start", () => {
        setVoiceState("live")
        sfx.voiceOn()
      })
      vapi.on("call-end", () => {
        setVoiceState("idle")
        sfx.voiceOff()
      })
      vapi.on("error", () => setVoiceState("idle"))
      vapi.on("message", (m: unknown) => {
        const msg = m as { type?: string; transcript?: string; role?: string; transcriptType?: string }
        if (msg.type === "transcript" && msg.transcript && msg.transcriptType === "final") {
          setFeed((f) => [...f.slice(-40), { role: msg.role === "assistant" ? "jarvis" : "you", text: msg.transcript! }])
        }
      })
      vapiRef.current = vapi as unknown as typeof vapiRef.current
    })
    return () => {
      mounted = false
      vapiRef.current?.stop()
    }
  }, [])

  function toggleVoice() {
    if (voiceState === "live") {
      vapiRef.current?.stop()
    } else {
      setVoiceState("connecting")
      vapiRef.current?.start(VAPI_ASSISTANT_ID)
    }
  }

  // ---- derived visuals ----
  const chartBars = useMemo(() => {
    // outbound comms per recent slot — real when live, gentle wave otherwise
    const base = stats.outbox.length
      ? stats.outbox.map((o) => 30 + (new Date(o.createdAt).getMinutes() % 50))
      : []
    const bars = [...base]
    while (bars.length < 18) bars.push(22 + Math.round(26 * Math.abs(Math.sin(bars.length * 1.7))))
    return bars.slice(0, 18)
  }, [stats.outbox])

  const pendingActions = stats.recentActions.filter((a) => a.status === "pending" && !decided.has(a.id))
  const lastAction = stats.recentActions[0]

  // The console is fully client-dynamic (clocks, live polling, waveforms) — server-render
  // a stable branded shell and mount the real thing on the client. No hydration drift, ever.
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8faf9]">
        <div className="flex items-center gap-3 text-lg font-black tracking-tight text-slate-950">
          <span className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg">F</span>
          Waking JARVIS…
        </div>
      </div>
    )
  }

  return (
    <div className="jarvis-cursor-zone min-h-screen bg-[#f6f9f8] px-3 py-4 text-slate-950 md:px-6 md:py-6" style={{ backgroundImage: "radial-gradient(80% 60% at 50% 0%, rgba(186,230,253,0.5) 0%, rgba(246,249,248,0) 60%)" }}>
      {/* ambient brand glows — same treatment as the homepage hero, turned up */}
      <div className="pointer-events-none fixed left-[-14rem] top-[-10rem] h-[32rem] w-[32rem] rounded-full bg-sky-200/45 blur-3xl" />
      <div className="pointer-events-none fixed right-[-12rem] bottom-[-8rem] h-[30rem] w-[30rem] rounded-full bg-teal-100/50 blur-3xl" />

      <CustomCursor />
      <div className="relative mx-auto max-w-[1400px]">
        {/* top chrome */}
        <div className="mb-4 flex items-center justify-between px-1">
          <Link href="/" className="flex items-center gap-3 text-lg font-black tracking-tight text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg">F</span>
            FINNOR <span className="hidden text-slate-400 sm:inline">/</span>
            <span className="hidden bg-gradient-to-r from-teal-600 to-sky-600 bg-clip-text text-transparent sm:inline">JARVIS</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-black tabular-nums tracking-widest text-slate-500 md:inline">{clock}</span>
            <span
              className={`status-pulse inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                live ? "bg-teal-200 text-slate-950" : "bg-amber-200 text-slate-950"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-teal-700" : "bg-amber-700"}`} />
              {live ? "Live" : "Simulation"}
            </span>
          </div>
        </div>

        {/* the console */}
        <div className="relative overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 text-white shadow-[0_34px_110px_rgba(8,24,39,0.45)]">
          <ConsoleAtmosphere />

          {/* live ops ticker — the heartbeat strip */}
          <div className="relative flex items-center gap-3 overflow-hidden border-b border-white/8 bg-white/[0.03] px-5 py-2.5 backdrop-blur-sm">
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-teal-200/90">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" /> Live Ops
            </span>
            <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={opsIndex}
                  initial={{ y: 16, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -16, opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 truncate text-[12px] font-bold text-white/75"
                >
                  {(() => {
                    const realEvents = stats.recentActions
                      .filter((a) => a.summary)
                      .map((a) => ({ icon: a.status === "completed" ? "✅" : "🕐", text: a.summary! }))
                    const pool = live && realEvents.length > 2 ? [...realEvents, ...OPS_STREAM] : OPS_STREAM
                    const item = pool[opsIndex % pool.length]!
                    return (
                      <>
                        <span className="mr-2">{item.icon}</span>
                        {item.text}
                      </>
                    )
                  })()}
                </motion.div>
              </AnimatePresence>
            </div>
            <button
              onClick={() => setSoundOn((v) => !v)}
              className="shrink-0 rounded-full border border-white/12 bg-white/5 p-1.5 text-white/60 transition hover:text-white"
              aria-label={soundOn ? "Mute console sounds" : "Unmute console sounds"}
            >
              {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="relative flex">
            {/* sidebar */}
            <aside className="hidden w-56 shrink-0 border-r border-white/8 p-4 lg:block">
              <div className="mb-6 px-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Operating System</div>
              <nav className="space-y-1">
                {SIDEBAR.map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setView(label)
                      sfx.tick()
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-bold transition ${
                      view === label ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(94,234,212,0.25)]" : "text-white/55 hover:bg-white/5 hover:text-white/85"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    {label === "Command Center" && stats.pending > 0 && (
                      <span className="ml-auto rounded-full bg-teal-300 px-2 py-0.5 text-[10px] font-black text-slate-950">{stats.pending}</span>
                    )}
                  </button>
                ))}
              </nav>
              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Active Agent</div>
                <div className="mt-2 flex items-center gap-2 text-sm font-black">
                  <span className={`h-2 w-2 rounded-full ${voiceState === "live" ? "animate-pulse bg-teal-300" : "bg-teal-500/60"}`} />
                  FINNOR JARVIS
                </div>
                <div className="mt-1 text-[11px] text-white/45">{voiceState === "live" ? "In a voice session with you" : "Listening for commands"}</div>
                <motion.div className="mt-3 flex h-8 items-end gap-[3px]" aria-hidden>
                  {Array.from({ length: 14 }).map((_, i) => (
                    <motion.span
                      key={i}
                      className="w-[4px] rounded-full bg-gradient-to-t from-teal-500/70 to-sky-300/80"
                      animate={{ height: voiceState === "live" ? [4, 18 + ((i * 7) % 12), 6] : [4, 8 + ((i * 5) % 7), 4] }}
                      transition={{ duration: 1.1 + (i % 4) * 0.18, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ))}
                </motion.div>
              </div>
            </aside>

            {/* main */}
            <div className="min-w-0 flex-1 p-4 md:p-6">
              {/* mobile view switcher */}
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {SIDEBAR.map(({ label }) => (
                  <button
                    key={label}
                    onClick={() => setView(label)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
                      view === label ? "bg-teal-300 text-slate-950" : "border border-white/12 text-white/55"
                    }`}
                  >
                    {label.replace(" & CRM", "").replace("Water ", "")}
                  </button>
                ))}
              </div>
              {/* header row */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="bg-gradient-to-r from-white via-teal-100 to-sky-200 bg-clip-text text-xl font-black tracking-tight text-transparent md:text-2xl">Command Center</h1>
                  <p className="text-xs text-white/45">Real-time AI operations — every consequential action stops for your approval.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/70">
                    {stats.pending} awaiting approval
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/70">
                    {stats.blocked} need review
                  </span>
                </div>
              </div>

              {/* workflow pipeline */}
              <Glass><div className="p-4 md:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                    <Workflow className="h-3.5 w-3.5 text-teal-300" /> Workflow State
                    <span className="status-pulse ml-1 rounded-full bg-teal-300/15 px-2 py-0.5 text-teal-200">● {live ? "live" : "ambient"}</span>
                  </div>
                  {lastAction && (
                    <span className="hidden text-[11px] text-white/40 md:inline">
                      latest: <span className="font-bold text-white/70">{lastAction.actionType.replaceAll("_", " ")}</span> · {timeAgo(lastAction.createdAt)}
                    </span>
                  )}
                </div>
                <div className="relative flex items-start justify-between">
                  <div className="absolute left-[8%] right-[8%] top-6 h-[2px] bg-white/10" />
                  <motion.div
                    className="absolute left-[8%] top-6 h-[2px] bg-gradient-to-r from-teal-300 to-sky-400"
                    animate={{ width: `${(pipelineStage / (PIPELINE.length - 1)) * 84}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {PIPELINE.map(({ key, label, icon: Icon }, i) => {
                    const done = i < pipelineStage
                    const current = i === pipelineStage
                    return (
                      <div key={key} className="relative z-10 flex w-1/5 flex-col items-center gap-2 text-center">
                        <motion.div
                          className={`flex h-12 w-12 items-center justify-center rounded-full border-2 ${
                            done
                              ? "border-teal-300 bg-teal-300 text-slate-950"
                              : current
                                ? "border-sky-300 bg-slate-900 text-sky-200"
                                : "border-white/15 bg-slate-900 text-white/30"
                          }`}
                          animate={current ? { scale: [1, 1.12, 1], boxShadow: ["0 0 0 0 rgba(94,234,212,0)", "0 0 0 10px rgba(94,234,212,0.12)", "0 0 0 0 rgba(94,234,212,0)"] } : { scale: 1 }}
                          transition={{ duration: 1.6, repeat: current ? Infinity : 0 }}
                        >
                          {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                        </motion.div>
                        <div className={`text-[10px] font-black uppercase tracking-wider md:text-[11px] ${current ? "text-white" : "text-white/40"}`}>{label}</div>
                      </div>
                    )
                  })}
                </div>
              </div></Glass>

              {/* feature views */}
              {view === "Voice Console" && <div className="mt-4"><VoiceConsoleView voiceState={voiceState} toggleVoice={toggleVoice} feed={feed} /></div>}
              {view === "Leads & CRM" && <div className="mt-4"><LeadsView /></div>}
              {view === "Workflows" && <div className="mt-4"><WorkflowsView /></div>}
              {view === "Inventory" && <div className="mt-4"><InventoryView /></div>}
              {view === "Invoices" && <div className="mt-4"><InvoicesView /></div>}
              {view === "Water Compliance" && <div className="mt-4"><ComplianceView /></div>}
              {view === "Web Research" && <div className="mt-4"><ResearchView /></div>}

              {/* middle grid — command center home */}
              <div className={`mt-4 grid gap-4 xl:grid-cols-3 ${view === "Command Center" ? "" : "hidden"}`}>
                {/* approval queue */}
                <Glass className="xl:col-span-2"><div className="p-4">
                  <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                    <Radar className="h-3.5 w-3.5 text-teal-300" /> Approval Queue <span className="text-white/25">— nothing runs without you</span>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {pendingActions.length === 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/40">
                          Queue clear. Speak or type a command and the drafts land here.
                        </motion.div>
                      )}
                      {pendingActions.slice(0, 3).map((a) => (
                        <motion.div
                          key={a.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 60 }}
                          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                          whileHover={{ y: -2, transition: { duration: 0.18 } }}
                          className="rounded-xl border border-white/10 bg-slate-900/70 p-4 shadow-[0_8px_30px_rgba(3,12,24,0.35)] transition-colors hover:border-teal-300/25"
                        >
                          <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-teal-200/80">{a.actionType.replaceAll("_", " ")} · {timeAgo(a.createdAt)}</div>
                          <div className="text-sm leading-relaxed text-white/85">{a.summary ?? "Drafted action awaiting approval."}</div>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => decide(a.id, "confirm")}
                              className="inline-flex items-center gap-1.5 rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 transition hover:-translate-y-0.5 hover:bg-teal-200"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => decide(a.id, "reject")}
                              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-1.5 text-[11px] font-black text-white/70 transition hover:-translate-y-0.5 hover:border-white/30 hover:text-white"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {/* comms + chart */}
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                        <Send className="h-3.5 w-3.5 text-sky-300" /> Outbound
                      </div>
                      <div className="space-y-2">
                        {stats.outbox.slice(0, 3).map((o) => (
                          <div key={o.id} className="text-[12px] leading-snug text-white/70">
                            <span className="font-black uppercase text-sky-300/80">{o.channel}</span>{" "}
                            <span className="text-white/40">→ {o.toNumber} · {timeAgo(o.createdAt)}</span>
                            <div className="truncate text-white/60">{o.content}</div>
                          </div>
                        ))}
                        {stats.outbox.length === 0 && <div className="text-xs text-white/35">No messages yet.</div>}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                        <Activity className="h-3.5 w-3.5 text-teal-300" /> Activity Pulse
                      </div>
                      <div className="flex h-20 items-end gap-1">
                        {chartBars.map((h, i) => (
                          <motion.div
                            key={i}
                            className="flex-1 rounded-t-sm bg-gradient-to-t from-teal-500/50 to-sky-300/70"
                            initial={{ height: 0 }}
                            animate={{ height: `${h}%` }}
                            transition={{ duration: 0.8, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div></Glass>

                {/* right rail: latest action + inventory + lifecycles */}
                <div className="space-y-4">
                  <Glass><div className="p-4">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                      <AudioLines className="h-3.5 w-3.5 text-teal-300" /> Latest Action
                    </div>
                    {lastAction ? (
                      <>
                        <div className="text-sm font-black">{lastAction.actionType.replaceAll("_", " ")}</div>
                        <div className="mt-1 line-clamp-3 text-[12px] leading-snug text-white/55">{lastAction.summary}</div>
                        <span className={`mt-3 inline-block rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                          lastAction.status === "completed" ? "bg-teal-300/15 text-teal-200" : lastAction.status === "pending" ? "bg-amber-300/15 text-amber-200" : "bg-white/10 text-white/60"
                        }`}>
                          {lastAction.status.replaceAll("_", " ")}
                        </span>
                      </>
                    ) : (
                      <div className="text-xs text-white/35">Waiting for the first command.</div>
                    )}
                  </div></Glass>

                  <Glass><div className="p-4">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                      <Boxes className="h-3.5 w-3.5 text-sky-300" /> Inventory
                    </div>
                    <div className="space-y-2.5">
                      {stats.inventory.slice(0, 4).map((it) => {
                        const low = it.quantity <= it.reorderThreshold
                        const pct = Math.min(100, Math.round((it.quantity / Math.max(1, it.reorderThreshold * 3)) * 100))
                        return (
                          <div key={it.sku}>
                            <div className="flex justify-between text-[11px]">
                              <span className="font-bold text-white/70">{it.name}</span>
                              <span className={low ? "font-black text-amber-300" : "text-white/45"}>{it.quantity}{low ? " · reorder" : ""}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                              <motion.div
                                className={`h-full rounded-full ${low ? "bg-amber-400" : "bg-gradient-to-r from-teal-400 to-sky-400"}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div></Glass>

                  <Glass><div className="p-4">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                      <CalendarClock className="h-3.5 w-3.5 text-teal-300" /> Customer Lifecycles
                    </div>
                    <div className="space-y-2">
                      {stats.workflows.slice(0, 3).map((w, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="text-white/55">{w.workflow.replaceAll("_", " ")}</span>
                          <span className="rounded-full bg-sky-300/12 px-2.5 py-1 font-black uppercase tracking-wider text-sky-200">{w.state.replaceAll("_", " ")}</span>
                        </div>
                      ))}
                      {stats.workflows.length === 0 && <div className="text-xs text-white/35">No lifecycles yet.</div>}
                    </div>
                  </div></Glass>
                </div>
              </div>

              {/* JARVIS command bar */}
              <motion.div
                className="mt-4 rounded-2xl bg-gradient-to-r from-teal-300/40 via-sky-400/25 to-teal-300/40 p-[1.5px]"
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                style={{ backgroundSize: "220% 220%" }}
              >
              <div className="rounded-[calc(1rem-1.5px)] bg-[#081120]/95 p-4 backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-teal-200/80">
                    <Command className="h-3.5 w-3.5" /> JARVIS Command
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/30">{busy ? "planning…" : voiceState === "live" ? "voice session live" : "ready"}</span>
                </div>
                <div ref={feedRef} className="mb-3 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {feed.slice(-8).map((m, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[13px] leading-relaxed">
                      <span className={m.role === "jarvis" ? "font-black text-teal-200" : "font-black text-white/70"}>{m.role === "jarvis" ? "JARVIS" : "YOU"}</span>{" "}
                      <span className={m.role === "jarvis" ? "text-white/80" : "text-white/60"}>{m.text}</span>
                    </motion.div>
                  ))}
                </div>
                {busy && (
                  <motion.div className="mb-3 h-1 overflow-hidden rounded-full bg-white/8">
                    <motion.div
                      className="h-full w-1/3 rounded-full bg-gradient-to-r from-teal-300 to-sky-400"
                      animate={{ x: ["-100%", "320%"] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </motion.div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runCommand()}
                    placeholder='Try: "Book a water test for the Hendersons Tuesday 10am, phone +1319555…"'
                    className="h-12 flex-1 rounded-full border border-white/12 bg-slate-950/80 px-5 font-mono text-[13px] text-teal-100 placeholder:text-white/25 focus:border-teal-300/50 focus:outline-none"
                  />
                  <button
                    onClick={runCommand}
                    disabled={busy || !command.trim()}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-xs font-black text-slate-950 transition hover:-translate-y-0.5 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" /> Run
                  </button>
                  <motion.button
                    onClick={toggleVoice}
                    className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full transition ${
                      voiceState === "live" ? "bg-teal-300 text-slate-950" : "border border-teal-300/40 bg-teal-300/10 text-teal-200 hover:bg-teal-300/20"
                    }`}
                    animate={voiceState === "live" ? { boxShadow: ["0 0 0 0 rgba(94,234,212,0.35)", "0 0 0 14px rgba(94,234,212,0)", "0 0 0 0 rgba(94,234,212,0)"] } : {}}
                    transition={{ duration: 1.4, repeat: voiceState === "live" ? Infinity : 0 }}
                    aria-label={voiceState === "live" ? "End voice session" : "Start voice session"}
                  >
                    {voiceState === "live" ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    {voiceState === "connecting" && (
                      <motion.span className="absolute inset-0 rounded-full border-2 border-teal-300/60" animate={{ scale: [1, 1.25], opacity: [1, 0] }} transition={{ duration: 0.9, repeat: Infinity }} />
                    )}
                  </motion.button>
                </div>
              </div>
              </motion.div>
            </div>
          </div>
        </div>

        <p className="mt-4 px-2 text-center text-[11px] text-slate-500">
          Every consequential action stops at the approval gate — enforced in the executor and the database, logged immutably.{" "}
          <Link href="/" className="font-black text-slate-800 underline-offset-2 hover:underline">← finnorai.com</Link>
        </p>
      </div>
    </div>
  )
}
