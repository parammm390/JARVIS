"use client"

// F8.T1/T2 — FLOW-59..66 (Band F8 — Pipeline Theater Amplifier) demoed on the Stage.
// Every demo reuses the SAME real exported pieces WorkflowTheater.tsx/DlqBrowser.tsx
// mount in production (Graph/GraphNodeCard/NODE_TONE, GRAVITY_WELL_EXIT, DecryptText)
// — no Stage-only lookalikes. Node/edge/dead-letter shapes are hand-authored FIXTURE
// data (a real signed-in owner session with an in-flight/faulted run isn't available
// in this environment, the same standing no-test-creds limitation every prior phase
// carries), but every choreography primitive driving them IS the real production one.

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { FlowCard, ReplayButton } from "./FlowCard"
import { Graph, GraphNodeCard, NODE_TONE, type GraphNode, type GraphEdge, type EdgeState } from "../../panels/WorkflowTheater"
import { GRAVITY_WELL_EXIT, GRAVITY_WELL_EXIT_REDUCED } from "../../panels/DlqBrowser"
import { DecryptText } from "../fx/DecryptText"

function DemoStack({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col items-center gap-2">{children}</div>
}

const FIXTURE_STEPS: GraphNode[] = [
  { id: "a", stepType: "hold_appointment", col: 0, row: 0, status: "completed", attempts: 1 },
  { id: "b", stepType: "generate_document", col: 1, row: 0, status: "leased", attempts: 1 },
  { id: "c", stepType: "request_signature", col: 2, row: 0, status: "pending", attempts: 1 },
]
const FIXTURE_EDGES: GraphEdge[] = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
]

function ChamberPressureDemo() {
  const [attempts, setAttempts] = useState(1)
  const node: GraphNode = { id: "n", stepType: "generate_document", col: 0, row: 0, status: "leased", attempts, updatedAt: new Date().toISOString() }
  return (
    <FlowCard id="FLOW-59" title="ChamberPressure" reducedFallback="static glow at settled intensity, no breathing">
      <DemoStack>
        <div className="relative h-[72px] w-[172px]">
          <GraphNodeCard node={node} now={Date.now()} />
        </div>
        <ReplayButton onClick={() => setAttempts((a) => (a >= 4 ? 1 : a + 1))} />
        <p className="text-[9px] text-white/30">FIXTURE attempts={attempts} (real one reads node.attempts straight from workflow_steps.attempts) — click Replay to bump the retry count.</p>
      </DemoStack>
    </FlowCard>
  )
}

function FlowParticulateDemo() {
  const [tier, setTier] = useState<1 | 2 | 3>(1)
  const edgeState = (): EdgeState => "flowing"
  return (
    <FlowCard id="FLOW-60" title="FlowParticulate" reducedFallback="static dash, no traveling dots">
      <DemoStack>
        <Graph nodes={FIXTURE_STEPS.slice(0, 2)} edges={[FIXTURE_EDGES[0]!]} edgeState={edgeState} now={Date.now()} particulate={tier} />
        <ReplayButton onClick={() => setTier((t) => (t >= 3 ? 1 : ((t + 1) as 1 | 2 | 3)))} />
        <p className="text-[9px] text-white/30">FIXTURE tier={tier} dot(s) (real one derives this from pulse-bus&apos;s real &quot;step&quot; kind, trailing 60s window).</p>
      </DemoStack>
    </FlowCard>
  )
}

function StepIgnitionDemo() {
  const [status, setStatus] = useState<"pending" | "leased" | "completed">("pending")
  const node: GraphNode = { id: "n", stepType: "reserve_stock", col: 0, row: 0, status, updatedAt: new Date().toISOString() }
  return (
    <FlowCard id="FLOW-61" title="StepIgnition" reducedFallback="color step only, no burst">
      <DemoStack>
        <div className="relative h-[72px] w-[172px]">
          <GraphNodeCard node={node} now={Date.now()} />
        </div>
        <ReplayButton onClick={() => setStatus((s) => (s === "pending" ? "leased" : s === "leased" ? "completed" : "pending"))} />
        <p className="text-[9px] text-white/30">Click Replay to cycle pending→leased (ignition burst)→completed (existing shockwave) on a real status transition.</p>
      </DemoStack>
    </FlowCard>
  )
}

function CompensationRewindDemo() {
  const [rewinding, setRewinding] = useState(true)
  const nodes: GraphNode[] = [
    { id: "a", stepType: "create_work_order", col: 0, row: 0, status: "failed" },
    { id: "b", stepType: "record_deposit_payment", col: 1, row: 0, status: rewinding ? "compensating" : "compensated" },
  ]
  const edgeState = (): EdgeState => "rewind"
  return (
    <FlowCard id="FLOW-62" title="CompensationRewind" reducedFallback="static amber path, no backward travel">
      <DemoStack>
        <Graph nodes={nodes} edges={[{ from: "a", to: "b" }]} edgeState={edgeState} now={Date.now()} />
        <ReplayButton onClick={() => setRewinding((r) => !r)} />
        <p className="text-[9px] text-white/30">FIXTURE — the real one keys off a genuine &quot;compensating&quot;/&quot;compensated&quot; step status.</p>
      </DemoStack>
    </FlowCard>
  )
}

function DlqGravityWellDemo() {
  const reduced = useReducedMotion()
  const [rows, setRows] = useState([{ id: "dl-1", label: "communications:send — timeout" }])
  const [verb, setVerb] = useState<"replay" | "discard">("discard")

  const reset = () => setRows([{ id: "dl-1", label: "communications:send — timeout" }])

  return (
    <FlowCard id="FLOW-63" title="DLQGravityWell" reducedFallback="fade only, no sink/lift">
      <DemoStack>
        <div className="w-full space-y-1.5">
          <AnimatePresence initial={false} onExitComplete={() => undefined}>
            {rows.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={false}
                exit={reduced ? GRAVITY_WELL_EXIT_REDUCED : GRAVITY_WELL_EXIT[verb]}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-white/70"
              >
                {r.label}
              </motion.div>
            ))}
          </AnimatePresence>
          {rows.length === 0 && <div className="rounded-lg border border-dashed border-white/10 px-2.5 py-3 text-center text-[9px] text-white/30">settled</div>}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => { setVerb("replay"); setRows([]) }} className="j-chip border border-cyan-400/30 text-cyan-200">replay (lift)</button>
          <button onClick={() => { setVerb("discard"); setRows([]) }} className="j-chip border border-white/15 text-white/60">discard (sink)</button>
          <ReplayButton onClick={reset} />
        </div>
        <p className="text-[9px] text-white/30">Same GRAVITY_WELL_EXIT constants DlqBrowser.tsx&apos;s real rows animate with.</p>
      </DemoStack>
    </FlowCard>
  )
}

const FIXTURE_RUN_STATUSES: Array<{ id: string; status: string }> = [
  { id: "s1", status: "completed" },
  { id: "s2", status: "completed" },
  { id: "s3", status: "leased" },
  { id: "s4", status: "pending" },
]

function RunConstellationDemo() {
  return (
    <FlowCard id="FLOW-64" title="RunConstellation" reducedFallback="identical — status dots, always static">
      <DemoStack>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="text-[11px] font-bold text-white/80">lead to water test</span>
          <span className="flex items-center gap-[3px]" aria-hidden>
            {FIXTURE_RUN_STATUSES.map((s) => (
              <span key={s.id} className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_TONE[s.status]?.icon ?? NODE_TONE.pending!.icon, opacity: s.status === "pending" ? 0.35 : 1 }} />
            ))}
          </span>
        </div>
        <p className="text-[9px] text-white/30">Exact dot-row RunBrowser&apos;s real collapsed rows render, one per real workflow_step.status.</p>
      </DemoStack>
    </FlowCard>
  )
}

function WatchdogFlareDemo() {
  return (
    <FlowCard id="FLOW-65" title="WatchdogFlare" reducedFallback="static red badge, no flare">
      <DemoStack>
        <span className="jarvis-watchdog-flare rounded-full bg-red-400/10 px-2 py-1 text-[10px] font-black text-red-300">watchdog stuck</span>
        <p className="text-[9px] text-white/30">Flare period is the REAL A4 watchdog scan cadence (10 minutes, apps/worker/src/index.ts&apos;s `intervalHours: 1/6`) — this card won&apos;t visibly flare during a quick look; that&apos;s the honest point. Budget-capped to the first flagged row in the real Run Browser.</p>
      </DemoStack>
    </FlowCard>
  )
}

function TriageWhisperDemo() {
  const [expanded, setExpanded] = useState(false)
  const reason = "3 consecutive timeouts on the same recipient number — likely a bad number, not a transient outage."
  return (
    <FlowCard id="FLOW-66" title="TriageWhisper" reducedFallback="instant text, no scramble">
      <DemoStack>
        <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-[10px] font-bold text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
          <span className="flex items-center gap-1">
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} /> communications:send — timeout
          </span>
          <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[9px] text-cyan-200">suggest discard</span>
        </button>
        {expanded && <DecryptText text={reason} mode="decrypt" charMs={14} className="block text-[10px] leading-relaxed text-white/60" />}
        <p className="text-[9px] text-white/30">Same DecryptText + expand pattern DlqBrowser&apos;s real rows use on the real A4.T3 suggestionReason.</p>
      </DemoStack>
    </FlowCard>
  )
}

export function PipelineTheaterCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F8">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F8 — Pipeline Theater Amplifier (FLOW-59..66)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">8 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Every demo reuses the real exported Graph/GraphNodeCard/NODE_TONE (WorkflowTheater.tsx) and GRAVITY_WELL_EXIT/DecryptText (DlqBrowser.tsx) — the
        exact same choreography production mounts. Node/run/dead-letter shapes here are hand-authored FIXTURE data (no signed-in owner session with a
        live or faulted run is available in this environment).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ChamberPressureDemo />
        <FlowParticulateDemo />
        <StepIgnitionDemo />
        <CompensationRewindDemo />
        <DlqGravityWellDemo />
        <RunConstellationDemo />
        <WatchdogFlareDemo />
        <TriageWhisperDemo />
      </div>
    </section>
  )
}
