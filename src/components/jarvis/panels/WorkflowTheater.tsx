"use client"

// §7.5 THE CENTERPIECE — a live node-graph. Real workflow_runs render as chains whose
// edges FLOW into the currently-leased step (dash animation + a traveling light dot);
// completed edges settle solid green; step completion pops the node and draws a check.
// With nothing in flight, Blueprint mode renders the four real lifecycle graphs from
// the actual step maps (including the installation workflow's genuine parallel branch)
// as dim ambient circuitry — no ages, no counts, nothing data-shaped (§2).

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check, Pause, Play, XCircle, RotateCcw, ArrowUpCircle } from "lucide-react"
import { LiveDot } from "../atmosphere"
import { StepIcon, humanizeStepType, humanizeWorkflowType } from "./StepIcon"
import { useJarvis, onJarvisEvent, runProgressPct, ageLabel, ageSeconds, type WorkflowRun } from "../lib/data-core"
import { jarvisPost, jarvisGet, JarvisApiError } from "../lib/api"
import { sfx } from "../sound"
import { burstAt } from "../lib/EventFX"
import { ReceiptDrawer } from "../lib/ReceiptDrawer"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { onPulse } from "../lib/pulse-bus"
import { isSandboxStep, SANDBOX_LITERAL } from "../lib/sandbox-detection"
import { choreo } from "../ui/motion/choreo"
import { runStatusPresentation, stepStatusPresentation } from "../kernel/workflow-presentation"
import type { StepState } from "../kernel/types"

// F8.T1 — FLOW-60 FlowParticulate: real steps/min from pulse-bus's "step" kind
// (the same real step-completed diffs data-core.ts's fast-lane poll already emits,
// republished by F2's pulse-bus — no new transport, no polling of its own), a
// trailing 60s window recomputed every 5s. Same shape as Bridge.tsx's own
// useEventRateOpacity — mirrored here rather than imported since that hook is
// Bridge-local and this needs a plain steps/min NUMBER, not a caustic opacity.
const THROUGHPUT_WINDOW_MS = 60_000
export function useStepsPerMinute(): number {
  const timestampsRef = useRef<number[]>([])
  const [perMinute, setPerMinute] = useState(0)
  useEffect(() => {
    const off = onPulse((pulse) => {
      if (pulse.kind !== "step") return
      timestampsRef.current.push(pulse.at)
    })
    const recompute = () => {
      const cutoff = Date.now() - THROUGHPUT_WINDOW_MS
      timestampsRef.current = timestampsRef.current.filter((t) => t >= cutoff)
      setPerMinute(timestampsRef.current.length)
    }
    const id = window.setInterval(recompute, 5000)
    recompute()
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [])
  return perMinute
}

// F8.T2 — FLOW-65 WatchdogFlare's real cadence: apps/worker/src/index.ts schedules
// `scan_watchdog` at `intervalHours: 1/6` (10 minutes) — the flare period below
// (jarvis-watchdog-flare in jarvis-theme.css) uses this exact constant, not an
// invented faster tempo, so "flares at real cadence" is literally true.
export const WATCHDOG_SCAN_INTERVAL_MS = 10 * 60 * 1000

// `useReducedMotion()` can resolve differently during SSR and the first client
// render. Defer its effect until after hydration wherever it changes SVG/DOM shape.
function useHydratedReducedMotion() {
  const preference = useReducedMotion()
  const [reduced, setReduced] = useState(false)
  useEffect(() => setReduced(Boolean(preference)), [preference])
  return reduced
}

const NODE_W = 172
const NODE_H = 72
const GAP_X = 56
const GAP_Y = 26
const X = (col: number) => col * (NODE_W + GAP_X)
const Y = (row: number) => row * (NODE_H + GAP_Y)

export interface GraphNode {
  id: string
  stepType: string
  col: number
  row: number
  status: string
  attempts?: number
  updatedAt?: string
  terminalReason?: string | null
  optional?: boolean
}
export interface GraphEdge {
  from: string
  to: string
  optional?: boolean
}

// The four real lifecycles, laid out from their actual step maps. The installation
// workflow genuinely has an optional procurement branch — drawn as one.
const BLUEPRINTS: Array<{ title: string; nodes: GraphNode[]; edges: GraphEdge[] }> = [
  {
    title: "Lead to Water Test",
    nodes: [
      { id: "a", stepType: "hold_appointment", col: 0, row: 0, status: "blueprint" },
      { id: "b", stepType: "send_confirmation_call", col: 1, row: 0, status: "blueprint" },
      { id: "c", stepType: "generate_document", col: 2, row: 0, status: "blueprint" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  },
  {
    title: "Water Test to Signed Proposal",
    nodes: [
      { id: "a", stepType: "generate_document", col: 0, row: 0, status: "blueprint" },
      { id: "b", stepType: "request_signature", col: 1, row: 0, status: "blueprint" },
    ],
    edges: [{ from: "a", to: "b" }],
  },
  {
    title: "Proposal to Installation",
    nodes: [
      { id: "p", stepType: "receive_procurement", col: 0, row: 1, status: "blueprint", optional: true },
      { id: "a", stepType: "reserve_stock", col: 0, row: 0, status: "blueprint" },
      { id: "b", stepType: "record_deposit_payment", col: 1, row: 0, status: "blueprint" },
      { id: "c", stepType: "create_work_order", col: 2, row: 0, status: "blueprint" },
    ],
    edges: [
      { from: "p", to: "b", optional: true },
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  },
  {
    title: "Invoice to Cash",
    nodes: [
      { id: "a", stepType: "create_payment_link", col: 0, row: 0, status: "blueprint" },
      { id: "b", stepType: "send_message", col: 1, row: 0, status: "blueprint" },
      { id: "c", stepType: "sync_invoice", col: 2, row: 0, status: "blueprint" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  },
]

function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = X(from.col) + NODE_W
  const y1 = Y(from.row) + NODE_H / 2
  const x2 = X(to.col)
  const y2 = Y(to.row) + NODE_H / 2
  const mid = (x1 + x2) / 2
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
}

export type EdgeState = "done" | "flowing" | "future" | "blueprint" | "rewind"

function GraphEdges({ nodes, edges, edgeState, particulate = 1 }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState; particulate?: number }) {
  const reduced = useHydratedReducedMotion()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const maxCol = Math.max(...nodes.map((n) => n.col))
  const maxRow = Math.max(...nodes.map((n) => n.row))
  const width = X(maxCol) + NODE_W
  const height = Y(maxRow) + NODE_H

  // branch merges: any node fed by more than one edge gets a junction marker
  const incomingCount = new Map<string, number>()
  for (const e of edges) incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1)
  const junctionNodes = [...incomingCount.entries()].filter(([, n]) => n > 1).map(([id]) => byId.get(id)).filter(Boolean) as GraphNode[]

  return (
    <svg className="absolute left-0 top-0" width={width} height={height} style={{ overflow: "visible" }} aria-hidden>
      {edges.map((e, i) => {
        const from = byId.get(e.from)
        const to = byId.get(e.to)
        if (!from || !to) return null
        const d = edgePath(from, to)
        const state = edgeState(e)
        const stroke =
          state === "done" ? "var(--j-green)" : state === "flowing" ? "var(--j-cyan)" : state === "rewind" ? "var(--j-amber)" : state === "blueprint" ? "rgba(59,130,246,0.5)" : "var(--j-text-faint)"
        // FLOW-60 FlowParticulate: real steps/min (0/low/med/high tiers, never a
        // fabricated smooth interpolation) scales BOTH the traveling-dot count and
        // their travel speed on a genuinely flowing edge — idle real throughput
        // shows one dot at the base 1.4s pace, busy real throughput shows all three
        // at a faster pace. `particulate` defaults to 1 (LiveRunRow/ReplayRow that
        // don't pass a real rate — e.g. blueprint/replay contexts — keep today's
        // pre-F8 single-dot behavior unchanged).
        const dotDur = particulate >= 3 ? "0.85s" : particulate === 2 ? "1.1s" : "1.4s"
        return (
          <g key={i}>
            {(state === "flowing" || state === "rewind" || state === "blueprint") && (
              <path d={d} fill="none" stroke={stroke} strokeWidth={6} opacity={state === "blueprint" ? 0.12 : 0.3} style={{ filter: "blur(4px)" }} />
            )}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={state === "done" || state === "flowing" || state === "rewind" ? 2 : 1.4}
              strokeDasharray={state === "done" ? undefined : state === "flowing" || state === "rewind" ? "5 8" : e.optional ? "2 7" : "3 8"}
              className={!reduced && state === "flowing" ? "jarvis-edge-flow" : !reduced && state === "rewind" ? "jarvis-edge-rewind" : !reduced && state === "blueprint" ? "jarvis-edge-blueprint" : ""}
              opacity={state === "future" ? 0.35 : state === "blueprint" ? 0.7 : 1}
            />
            {!reduced && state === "flowing" && (
              <>
                <circle r={3} fill="var(--j-cyan)">
                  <animateMotion dur={dotDur} repeatCount="indefinite" path={d} />
                </circle>
                {particulate >= 2 && (
                  <circle r={2.2} fill="var(--j-cyan)" opacity={0.7}>
                    <animateMotion dur={dotDur} repeatCount="indefinite" path={d} begin="0.15s" />
                  </circle>
                )}
                {particulate >= 3 && (
                  <circle r={1.6} fill="var(--j-cyan)" opacity={0.45}>
                    <animateMotion dur={dotDur} repeatCount="indefinite" path={d} begin="0.3s" />
                  </circle>
                )}
                <circle r={6} fill="var(--j-cyan)" opacity={0.25}>
                  <animateMotion dur={dotDur} repeatCount="indefinite" path={d} />
                </circle>
              </>
            )}
            {/* FLOW-62 CompensationRewind: a compensation edge's dot travels the
                path BACKWARD (keyPoints reversed) in amber, not cyan → static
                amber path, no travel (reduced, handled by jarvis-edge-rewind's own
                reduced-motion rule in jarvis-theme.css). */}
            {!reduced && state === "rewind" && (
              <circle r={2.6} fill="var(--j-amber)">
                <animateMotion dur="1.4s" repeatCount="indefinite" path={d} keyPoints="1;0" keyTimes="0;1" />
              </circle>
            )}
            {!reduced && state === "blueprint" && (
              <circle r={2} fill="rgba(94,197,255,0.8)">
                <animateMotion dur="7s" repeatCount="indefinite" path={d} begin={`${i * 1.7}s`} />
              </circle>
            )}
          </g>
        )
      })}
      {junctionNodes.map((n) => (
        <circle key={n.id} cx={X(n.col)} cy={Y(n.row) + NODE_H / 2} r={3} fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth={1.5} />
      ))}
    </svg>
  )
}

export const NODE_TONE: Record<string, { border: string; iconBg: string; icon: string; shadow?: string }> & Record<StepState | "blueprint", { border: string; iconBg: string; icon: string; shadow?: string }> = {
  pending: { border: "rgba(100,128,159,0.18)", iconBg: "rgba(100,128,159,0.1)", icon: "var(--j-text-dim)" },
  leased: { border: "var(--j-border-hot)", iconBg: "rgba(34,211,238,0.14)", icon: "var(--j-cyan)", shadow: "0 0 22px rgba(34,211,238,0.28)" },
  completed: { border: "rgba(52,211,153,0.45)", iconBg: "rgba(52,211,153,0.12)", icon: "var(--j-green)" },
  failed: { border: "rgba(248,113,113,0.5)", iconBg: "rgba(248,113,113,0.12)", icon: "var(--j-red)", shadow: "0 0 18px rgba(248,113,113,0.22)" },
  compensating: { border: "rgba(251,191,36,0.5)", iconBg: "rgba(251,191,36,0.12)", icon: "var(--j-amber)" },
  compensated: { border: "rgba(251,191,36,0.3)", iconBg: "rgba(251,191,36,0.08)", icon: "var(--j-amber)" },
  blueprint: { border: "rgba(59,130,246,0.16)", iconBg: "rgba(59,130,246,0.08)", icon: "rgba(94,148,213,0.75)" },
}

export function GraphNodeCard({ node, now, blueprint, onSelect }: { node: GraphNode; now: number; blueprint?: boolean; onSelect?: (node: GraphNode) => void }) {
  const reduced = useHydratedReducedMotion()
  const tone = NODE_TONE[node.status as StepState | "blueprint"] ?? NODE_TONE.pending!
  const isLeased = node.status === "leased"
  const isDone = node.status === "completed"
  // jarvis-v3 P4.T6 (§8 PHASE 4) — sandbox honesty for "the step": a blueprint
  // tile is a reference catalog entry, not a real execution, so it's never
  // eligible. A real (non-blueprint) create_payment_link/send_message step
  // that resolved to a non-real provider gets the literal string as an
  // accessible title (a real DOM string, not a tooltip-only decoration) —
  // this tile's own layout has no room for a second inline banner.
  const { setupStatus } = useJarvis()
  const sandboxed = !blueprint && isSandboxStep(node.stepType, setupStatus?.environment?.bindings)
  // FLOW-59 ChamberPressure: only a genuinely leased node with a REAL retry
  // (attempts > 1, straight from workflow_steps.attempts) gets the pressure glow —
  // a first-attempt leased node keeps today's plain cyan pulse-ring unchanged.
  const underPressure = isLeased && (node.attempts ?? 0) > 1
  const prevStatusRef = useRef(node.status)
  const [shockwaveKey, setShockwaveKey] = useState(0)
  const [ignitionKey, setIgnitionKey] = useState(0)
  const nodeElRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prevStatusRef.current !== "completed" && node.status === "completed") {
      setShockwaveKey((k) => k + 1)
      const rect = nodeElRef.current?.getBoundingClientRect()
      if (rect) burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
    // FLOW-61 StepIgnition (start half): fires the instant a REAL step transitions
    // into "leased" — never on first mount (a run opened mid-flight already has
    // leased nodes; that's not an ignition, it's the current state).
    if (prevStatusRef.current !== "leased" && node.status === "leased" && prevStatusRef.current !== node.status) {
      setIgnitionKey((k) => k + 1)
    }
    prevStatusRef.current = node.status
  }, [node.status])

  const interactive = Boolean(onSelect && !blueprint)

  return (
    <div
      ref={nodeElRef}
      data-node
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Open receipt for ${humanizeStepType(node.stepType)}` : undefined}
      title={sandboxed ? SANDBOX_LITERAL : undefined}
      onClick={interactive ? () => onSelect?.(node) : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect?.(node)
        }
      } : undefined}
      className={`j-node jarvis-rise group absolute flex items-center gap-2.5 rounded-xl border bg-[rgba(10,19,36,0.92)] px-3 backdrop-blur-md transition-[opacity,border-color,box-shadow] duration-500 ${interactive ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" : ""}`}
      style={{
        left: X(node.col),
        top: Y(node.row),
        width: NODE_W,
        height: NODE_H,
        borderColor: tone.border,
        boxShadow: tone.shadow,
        opacity: blueprint ? 0.75 : node.status === "pending" ? 0.55 : 1,
        ["--rise-to" as string]: blueprint ? 0.75 : node.status === "pending" ? 0.55 : 1,
      }}
    >
      <span aria-hidden className="absolute -left-[3px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border" style={{ background: "#0a1324", borderColor: isLeased ? "var(--j-cyan)" : "var(--j-border)" }} />
      <span aria-hidden className="absolute -right-[3px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border" style={{ background: "#0a1324", borderColor: isLeased ? "var(--j-cyan)" : "var(--j-border)" }} />
      {!reduced && shockwaveKey > 0 && <span key={shockwaveKey} className="jarvis-shockwave" />}
      {ignitionKey > 0 && (
        <motion.span
          key={ignitionKey}
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-xl border-2"
          style={{ borderColor: "var(--j-cyan)" }}
          variants={reduced ? choreo.stepIgnition.reducedVariants : choreo.stepIgnition.variants}
          initial="initial"
          animate="animate"
        />
      )}
      {underPressure && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-xl"
          style={{ boxShadow: `0 0 ${10 + Math.min(node.attempts ?? 0, 5) * 4}px rgba(251,191,36,0.5)` }}
          variants={reduced ? choreo.chamberPressure.reducedVariants : choreo.chamberPressure.variants}
          initial="initial"
          animate="animate"
        />
      )}
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border" style={{ background: tone.iconBg, borderColor: tone.border, color: tone.icon }}>
        <StepIcon stepType={node.stepType} className="h-4 w-4" />
        {isLeased && !reduced && <span className="jarvis-pulse-ring absolute inset-0 rounded-full border border-cyan-300/60" />}
        {isLeased && (
          <svg className={`absolute -inset-1.5 ${reduced ? "" : "jarvis-spin"}`} width={44} height={44} viewBox="0 0 44 44" aria-hidden>
            <circle cx={22} cy={22} r={19} fill="none" stroke="var(--j-cyan)" strokeWidth={2} strokeDasharray="70 40" strokeLinecap="round" opacity={0.85} />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate j-fs-sm font-bold capitalize leading-tight text-[color:var(--j-text)]">{humanizeStepType(node.stepType)}</div>
        <div className="j-fs-micro text-[color:var(--j-text-dim)]">
          {blueprint
            ? node.optional
              ? "optional"
              : " "
            : node.status === "leased" && node.updatedAt
              ? `running · ${ageSeconds(node.updatedAt, now)}s`
              : stepStatusPresentation(node.status as StepState).label + ((node.attempts ?? 0) > 1 ? ` · retry ${node.attempts}` : "")}
        </div>
      </div>
      {isDone && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 18 }}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(52,211,153,0.6)]"
        >
          <Check className="h-3 w-3" strokeWidth={3.5} />
        </motion.div>
      )}
      {sandboxed && (
        <span className="absolute -bottom-1.5 -left-1.5 rounded-full bg-amber-300/90 px-1.5 py-0.5 j-fs-micro font-black uppercase tracking-wide text-slate-950 shadow-[0_0_8px_rgba(245,185,66,0.5)]">
          sandbox
        </span>
      )}
      {node.status === "failed" && node.terminalReason && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-44 -translate-x-1/2 rounded-lg border border-red-400/30 bg-slate-950 p-2 j-fs-micro text-red-300 opacity-0 shadow-xl transition group-hover:opacity-100">
          {node.terminalReason}
        </div>
      )}
    </div>
  )
}

export function Graph({ nodes, edges, edgeState, now, blueprint, onSelectNode, particulate }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState; now: number; blueprint?: boolean; onSelectNode?: (node: GraphNode) => void; particulate?: number }) {
  const maxCol = Math.max(...nodes.map((n) => n.col))
  const maxRow = Math.max(...nodes.map((n) => n.row))
  return (
    <div className="j-scroll overflow-x-auto pb-1 pt-1">
      <div data-graph className="relative" style={{ width: X(maxCol) + NODE_W, height: Y(maxRow) + NODE_H, minWidth: X(maxCol) + NODE_W }}>
        <GraphEdges nodes={nodes} edges={edges} edgeState={edgeState} particulate={particulate} />
        {nodes.map((n) => (
          <GraphNodeCard key={n.id} node={n} now={now} blueprint={blueprint} onSelect={onSelectNode} />
        ))}
      </div>
    </div>
  )
}

function LiveRunRow({ run, now, onOpen, onSelectStep }: { run: WorkflowRun; now: number; onOpen: () => void; onSelectStep?: (stepId: string) => void }) {
  const nodes: GraphNode[] = run.steps.map((s, i) => ({
    id: s.id,
    stepType: s.stepType,
    col: i,
    row: 0,
    status: s.status,
    attempts: s.attempts,
    updatedAt: s.updatedAt,
    terminalReason: s.terminalReason,
  }))
  const edges: GraphEdge[] = run.steps.slice(1).map((s, i) => ({ from: run.steps[i]!.id, to: s.id }))
  const leasedIdx = run.steps.findIndex((s) => s.status === "leased" || s.status === "pending")
  const pct = runProgressPct(run)
  const stepsPerMin = useStepsPerMinute()
  // FLOW-60 tiers: 0 real steps/min in the trailing 60s window = the pre-F8 single
  // dot; 1-2 = two dots; 3+ = three dots (today's original always-3 look, now
  // genuinely earned by real throughput instead of hardcoded).
  const particulate = stepsPerMin >= 3 ? 3 : stepsPerMin >= 1 ? 2 : 1
  const runPresentation = runStatusPresentation(run.status as import("../kernel/types").RunState)

  const edgeState = (e: GraphEdge): EdgeState => {
    const toStep = run.steps.find((s) => s.id === e.to)
    if (toStep?.status === "compensating" || toStep?.status === "compensated") return "rewind"
    const toIdx = run.steps.findIndex((s) => s.id === e.to)
    if (run.steps[toIdx]?.status === "completed") return "done"
    if (toIdx === leasedIdx) return "flowing"
    return "future"
  }

  const prevRunStatusRef = useRef(run.status)
  const [sweepKey, setSweepKey] = useState(0)
  useEffect(() => {
    if (prevRunStatusRef.current !== "completed" && run.status === "completed") {
      setSweepKey((k) => k + 1)
    }
    prevRunStatusRef.current = run.status
  }, [run.status])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border border-[color:var(--j-border)] bg-white/[0.015] p-4 ${sweepKey > 0 ? "jarvis-sweep" : ""}`}
    >
      <button onClick={onOpen} className="mb-3 flex w-full items-center justify-between gap-3 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate j-fs-base font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</span>
          <span className="j-chip bg-white/6 font-mono text-[color:var(--j-text-dim)]">{ageLabel(run.createdAt, now)}</span>
          <span className={`j-chip ${
            runPresentation.tone === "live" ? "bg-cyan-400/10 text-cyan-300" :
            runPresentation.tone === "success" ? "bg-emerald-400/10 text-emerald-300" :
            runPresentation.tone === "failure" ? "bg-red-400/10 text-red-300" :
            runPresentation.tone === "recovery" ? "bg-amber-400/10 text-amber-200" :
            runPresentation.tone === "escalated" ? "bg-violet-400/10 text-violet-200" :
            runPresentation.tone === "cancelled" ? "bg-white/8 text-white/60" :
            "bg-white/8 text-white/70"
          }`}>{runPresentation.tone === "live" && <LiveDot />}{runPresentation.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono j-fs-micro tabular-nums text-[color:var(--j-text-dim)]">{pct}%</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>
      <Graph nodes={nodes} edges={edges} edgeState={edgeState} now={now} onSelectNode={(node) => onSelectStep?.(node.id)} particulate={particulate} />
    </motion.div>
  )
}

// Replay theater — re-enacts REAL terminal runs step-by-step so the circuit is always
// alive. Labeled REPLAY with the run's real completion age; step timing is compressed
// presentation, every node and outcome is the genuine record.
function ReplayRow({ run, now }: { run: WorkflowRun; now: number }) {
  const [cursor, setCursor] = useState(0)
  const total = run.steps.length
  const done = cursor >= total

  useEffect(() => {
    setCursor(0)
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return
      setCursor((c) => Math.min(total, c + 1))
    }, 2000)
    return () => clearInterval(t)
  }, [run.id, total])

  const nodes: GraphNode[] = run.steps.map((s, i) => ({
    id: s.id,
    stepType: s.stepType,
    col: i,
    row: 0,
    status: i < cursor ? (s.status === "failed" ? "failed" : "completed") : i === cursor && !done ? "leased" : "pending",
    terminalReason: s.terminalReason,
  }))
  const edges: GraphEdge[] = run.steps.slice(1).map((s, i) => ({ from: run.steps[i]!.id, to: s.id }))
  const edgeState = (e: GraphEdge): EdgeState => {
    const toIdx = run.steps.findIndex((s) => s.id === e.to)
    if (toIdx < cursor) return "done"
    if (toIdx === cursor && !done) return "flowing"
    return "future"
  }
  const pct = Math.round((Math.min(cursor, total) / total) * 100)

  return (
    <div
      className={`jarvis-rise relative overflow-hidden rounded-2xl border p-4 transition-colors duration-700 ${
        done ? "border-emerald-400/35 bg-emerald-400/[0.03]" : "border-[color:var(--j-border)] bg-white/[0.015]"
      }`}
    >
      <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="truncate j-fs-base font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</span>
          <span className="j-chip bg-violet-400/12 text-violet-300">REPLAY</span>
          <span className="j-chip bg-white/6 font-mono text-[color:var(--j-text-dim)]">
            {run.status} {ageLabel(run.updatedAt, now)} ago
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono j-fs-micro tabular-nums text-[color:var(--j-text-dim)]">{pct}%</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
            <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out ${done ? "from-emerald-400 to-teal-300" : "from-teal-400 to-cyan-400"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <Graph nodes={nodes} edges={edges} edgeState={edgeState} now={now} />
      <div className="mt-2 j-fs-micro text-[color:var(--j-text-faint)]">Re-enactment of a real run from the ledger · step timing compressed for display.</div>
    </div>
  )
}

function ReplayTheater({ pool, now }: { pool: WorkflowRun[]; now: number }) {
  const [idx, setIdx] = useState(0)
  const run = pool[idx % pool.length]!
  const total = run.steps.length

  // advance to the next real run after the re-enactment finishes + a short hold
  useEffect(() => {
    const holdMs = (total + 1) * 2000 + 3000
    const t = setTimeout(() => setIdx((i) => i + 1), holdMs)
    return () => clearTimeout(t)
  }, [run.id, total])

  return <ReplayRow key={`${run.id}-${idx}`} run={run} now={now} />
}

// Phase 7 (§7.2): which run-control verbs are even legal from the run's CURRENT
// status — matches packages/workflow-runtime/src/run-controls.ts's own TRANSITIONS
// table exactly, so this never offers a button the server would just 409 on.
const RUN_CONTROL_VERBS = [
  { verb: "pause", label: "Pause", icon: Pause, from: ["running"] },
  { verb: "resume", label: "Resume", icon: Play, from: ["paused"] },
  { verb: "cancel", label: "Cancel", icon: XCircle, from: ["running", "paused"] },
  { verb: "retry", label: "Retry", icon: RotateCcw, from: ["failed"] },
  { verb: "escalate", label: "Escalate", icon: ArrowUpCircle, from: ["running", "failed"] },
] as const

function RunControls({ run }: { run: WorkflowRun }) {
  const { role } = useJarvisAuth()
  const [inflight, setInflight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appliedVerb, setAppliedVerb] = useState<string | null>(null)
  const available = RUN_CONTROL_VERBS.filter((v) => (v.from as readonly string[]).includes(run.status))

  // Phase 7 (§7.4): client-side courtesy only — the backend's own canApprove(ctx,"*")
  // gate (apps/api/lib/run-control-route.ts) is the real authorizer regardless of
  // what this hides. Default seeded role_permissions grant "*" to owner alone, so
  // that's the simplification this client makes; a tenant with a custom grant for
  // another role would still be correctly authorized server-side, just wouldn't see
  // this button — a real, honestly-scoped gap, not a security hole.
  if (role !== "owner") return null
  if (available.length === 0 && !appliedVerb) return null

  async function act(verb: (typeof RUN_CONTROL_VERBS)[number]["verb"]) {
    if (inflight) return
    setInflight(verb)
    setError(null)
    try {
      await jarvisPost(`workflows/runs/${run.id}/${verb}`, { expectedVersion: run.version })
      // Explicitly-pending, not full optimistic patching (§0.3.11): this run's real
      // state lives in the shared poller, not local state here — the next fast-lane
      // poll (≤4s) reflects the real transition. This just confirms the call landed.
      setAppliedVerb(verb)
    } catch (e) {
      if (e instanceof JarvisApiError && e.status === 403) setError("Your role can't control workflow runs.")
      else if (e instanceof JarvisApiError && e.status === 409) setError("That run already moved on — refreshing.")
      else setError(e instanceof Error ? e.message : "That didn't go through — try again.")
    } finally {
      setInflight(null)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-white/8 bg-white/[0.015] p-3">
      <div className="mb-2 j-fs-micro font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">Run controls</div>
      {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-2 py-1.5 j-fs-micro text-red-300">{error}</div>}
      {appliedVerb && !error && (
        <div className="mb-2 rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-2 py-1.5 j-fs-micro text-cyan-200">
          {appliedVerb} sent — updating…
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {available.map(({ verb, label, icon: Icon }) => (
          <button
            key={verb}
            type="button"
            disabled={inflight !== null}
            onClick={() => act(verb)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 j-fs-micro font-black text-white/70 transition hover:-translate-y-0.5 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            <Icon className="h-3 w-3" /> {inflight === verb ? "Sending…" : label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Phase 7 (§7.3): a step doesn't carry its own receipt id from GET workflows/runs, so
// this looks it up on demand (GET receipts?workflowStepId=X) the moment someone
// actually wants to see it, rather than eagerly fetching one per step per run.
function WhyStepButton({ stepId }: { stepId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "none">("idle")
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null)

  async function open() {
    if (state === "loading") return
    setState("loading")
    try {
      const res = await jarvisGet<{ receipts: Array<{ id: string }> }>("receipts", { workflowStepId: stepId })
      if (res.receipts.length > 0) {
        setOpenReceiptId(res.receipts[0]!.id)
        setState("idle")
      } else {
        setState("none")
      }
    } catch {
      setState("none")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={state === "loading"}
        className="j-fs-micro font-black uppercase tracking-wide text-cyan-300/70 hover:text-cyan-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        {state === "loading" ? "Loading…" : state === "none" ? "No receipt yet" : "Why?"}
      </button>
      {openReceiptId && <ReceiptDrawer receiptId={openReceiptId} onClose={() => setOpenReceiptId(null)} />}
    </>
  )
}

// A node click has the same receipt lookup contract as the explicit "Why?" action.
// Workflow-run payloads intentionally do not embed receipt ids, so this stays an
// on-demand tenant-scoped lookup rather than inventing a second source of truth.
function StepReceiptLookup({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const [receiptId, setReceiptId] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void jarvisGet<{ receipts: Array<{ id: string }> }>("receipts", { workflowStepId: stepId })
      .then((res) => {
        if (current) setReceiptId(res.receipts[0]?.id ?? null)
      })
      .catch(() => {
        if (current) setReceiptId(null)
      })
    return () => {
      current = false
    }
  }, [stepId])

  return receiptId ? <ReceiptDrawer receiptId={receiptId} onClose={onClose} /> : null
}

function RunDrawer({ run, onClose }: { run: WorkflowRun; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</h3>
          <button onClick={onClose} className="rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 hover:text-white">
            Close
          </button>
        </div>
        <RunControls run={run} />
        <div className="space-y-3">
          {run.steps.map((s) => (
            <div key={s.id} className="j-panel !rounded-xl p-3">
              <div className="flex items-center justify-between j-fs-micro font-bold text-[color:var(--j-text)]">
                <span className="flex items-center gap-2 capitalize">
                  <StepIcon stepType={s.stepType} className="h-3.5 w-3.5" /> {humanizeStepType(s.stepType)}
                </span>
                <span className="text-[color:var(--j-text-dim)]">{s.status}</span>
              </div>
              <div className="mt-1 flex items-center justify-between font-mono j-fs-micro text-[color:var(--j-text-faint)]">
                <span>
                  updated {new Date(s.updatedAt).toLocaleString()} · attempts {s.attempts}
                  {s.terminalReason ? ` · ${s.terminalReason}` : ""}
                </span>
                <WhyStepButton stepId={s.id} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function RunBrowser({ runs, now, onOpen, onSelectStep }: { runs: WorkflowRun[]; now: number; onOpen: (runId: string) => void; onSelectStep: (stepId: string) => void }) {
  const [kind, setKind] = useState("all")
  const [status, setStatus] = useState("all")
  const [age, setAge] = useState("all")
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const kinds = [...new Set(runs.map((run) => run.workflowType))].sort()
  const statuses = [...new Set(runs.map((run) => run.status))].sort()
  const maxAgeMs = age === "1h" ? 3_600_000 : age === "24h" ? 86_400_000 : age === "7d" ? 604_800_000 : Infinity
  const filtered = runs.filter((run) =>
    (kind === "all" || run.workflowType === kind) &&
    (status === "all" || run.status === status) &&
    now - new Date(run.updatedAt).getTime() <= maxAgeMs,
  )
  // Real tenants can accumulate a long terminal-run history. Keep the normal small
  // list fully rendered (better for find-in-page and screen readers), but window
  // only the compact rows once the list is genuinely long. An expanded run falls
  // back to the complete list because its detail has variable height.
  const ROW_HEIGHT = 58
  const VIEWPORT_HEIGHT = 348
  const OVERSCAN = 6
  const virtualized = filtered.length > 40 && expandedRunId === null
  const firstVisible = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const lastVisible = virtualized ? Math.min(filtered.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN) : filtered.length
  const renderedRuns = virtualized ? filtered.slice(firstVisible, lastVisible) : filtered
  // FLOW-65 WatchdogFlare: motion-semantics table's own "needs human → pulse
  // (≤2 loops/viewport, else static badge)" rule — only the FIRST currently
  // rendered watchdog-flagged run gets the flaring loop; every other real
  // watchdog-flagged row still shows the real badge, just static.
  const firstFlaggedId = renderedRuns.find((r) => r.watchdogFlagged)?.id ?? null

  const runRow = (run: WorkflowRun) => (
    <div key={run.id} className="rounded-xl border border-white/8 bg-black/10 p-2.5">
      <button type="button" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)} className="flex w-full items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate j-fs-micro font-bold text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</span>
          {/* FLOW-64 RunConstellation: a mini dot per REAL step, colored by that
              step's real status — always-on status dots, identical in both motion
              modes (the plan's own reduced fallback for this id IS "status dots"). */}
          <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
            {run.steps.map((s) => (
              <span
                key={s.id}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: NODE_TONE[s.status].icon, opacity: s.status === "pending" ? 0.35 : 1 }}
              />
            ))}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 j-fs-micro text-[color:var(--j-text-dim)]">
          {run.watchdogFlagged && (
            <span
              className={`rounded-full bg-red-400/10 px-1.5 py-0.5 font-black text-red-300 ${run.id === firstFlaggedId ? "jarvis-watchdog-flare" : ""}`}
            >
              watchdog stuck
            </span>
          )}
          <span>{runStatusPresentation(run.status as import("../kernel/types").RunState).label}</span><span>·</span><span>{ageLabel(run.updatedAt, now)}</span>
        </span>
      </button>
      {expandedRunId === run.id && <div className="mt-3"><LiveRunRow run={run} now={now} onOpen={() => onOpen(run.id)} onSelectStep={onSelectStep} /></div>}
    </div>
  )

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.012] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="j-fs-micro font-black uppercase tracking-[0.16em] text-[color:var(--j-text-faint)]">Run browser</div>
          <p className="j-fs-micro text-[color:var(--j-text-dim)]">{filtered.length} of {runs.length} real runs</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filter workflow kind" className="rounded-lg border border-white/10 bg-[#0a1324] px-2 py-1 j-fs-micro text-white/70">
            <option value="all">all kinds</option>
            {kinds.map((value) => <option key={value} value={value}>{humanizeWorkflowType(value)}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter workflow status" className="rounded-lg border border-white/10 bg-[#0a1324] px-2 py-1 j-fs-micro text-white/70">
            <option value="all">all status</option>
            {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={age} onChange={(event) => setAge(event.target.value)} aria-label="Filter workflow age" className="rounded-lg border border-white/10 bg-[#0a1324] px-2 py-1 j-fs-micro text-white/70">
            <option value="all">any age</option>
            <option value="1h">last hour</option>
            <option value="24h">last day</option>
            <option value="7d">last 7 days</option>
          </select>
        </div>
      </div>
      <div
        className={virtualized ? "overflow-y-auto" : "space-y-2"}
        style={virtualized ? { maxHeight: VIEWPORT_HEIGHT } : undefined}
        onScroll={virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
        data-testid={virtualized ? "workflow-run-browser-virtualized" : undefined}
      >
        {virtualized ? (
          <div style={{ height: filtered.length * ROW_HEIGHT }}>
            <div className="space-y-2" style={{ transform: `translateY(${firstVisible * ROW_HEIGHT}px)` }}>
              {renderedRuns.map(runRow)}
            </div>
          </div>
        ) : renderedRuns.map(runRow)}
        {filtered.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-3 text-center j-fs-micro text-[color:var(--j-text-dim)]">No real runs match these filters.</p>}
      </div>
    </div>
  )
}

export function WorkflowTheater() {
  const data = useJarvis()
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [openReceiptStepId, setOpenReceiptStepId] = useState<string | null>(null)
  const handledRunLinkRef = useRef<string | null>(null)
  const runs = data.runs
  const visible = runs.slice(0, 3)
  const extra = runs.length - visible.length
  const openRun = runs.find((r) => r.id === openRunId) ?? null

  useEffect(() => {
    const requestedRunId = new URLSearchParams(window.location.search).get("workflowRunId")
    if (requestedRunId && requestedRunId !== handledRunLinkRef.current && runs.some((run) => run.id === requestedRunId)) {
      handledRunLinkRef.current = requestedRunId
      setOpenRunId(requestedRunId)
    }
  }, [runs])

  useEffect(() => {
    const offs = [onJarvisEvent("step-completed", () => sfx.stepTick()), onJarvisEvent("run-completed", () => sfx.runDone())]
    return () => offs.forEach((off) => off())
  }, [])

  const replayPool = data.terminalRuns
    .filter((r) => r.steps.length >= 2)
    .slice()
    .sort((a, b) => (a.status === "completed" ? 0 : 1) - (b.status === "completed" ? 0 : 1))
  const mode: "live" | "replay" | "blueprint" = runs.length > 0 ? "live" : replayPool.length > 0 ? "replay" : "blueprint"

  return (
    <div id="workflow-theater" className="j-panel j-hud relative overflow-hidden xl:col-span-2">
      {/* ambient scan sweep */}
      <div className="jarvis-scan jarvis-ambient pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/[0.03] to-transparent" aria-hidden />
      <div className="p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="j-label flex items-center gap-2">
              {mode === "live" ? (
                <>
                  <LiveDot /> Live Workflow
                </>
              ) : mode === "replay" ? (
                "Workflow Theater"
              ) : (
                "Workflow Circuits"
              )}
            </span>
            {mode === "live" && <span className="j-chip bg-cyan-400/10 text-cyan-300">{runs.length} in flight</span>}
            {mode === "replay" && <span className="j-chip bg-violet-400/12 text-violet-300">replaying real runs</span>}
            {mode === "blueprint" && <span className="j-chip bg-blue-400/10 text-blue-300/80">BLUEPRINT</span>}
          </div>
          <span className="j-chip bg-white/5 text-[color:var(--j-text-dim)]">every consequential step is gated</span>
        </div>

        {mode === "live" && (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {visible.map((run) => (
                <LiveRunRow key={run.id} run={run} now={data.now} onOpen={() => setOpenRunId(run.id)} onSelectStep={setOpenReceiptStepId} />
              ))}
            </AnimatePresence>
            {extra > 0 && <div className="text-center j-fs-micro text-[color:var(--j-text-dim)]">+{extra} more in flight</div>}
          </div>
        )}

        {mode === "replay" && (
          <div className="space-y-4">
            <ReplayTheater pool={replayPool} now={data.now} />
            <div className="rounded-2xl border border-white/5 bg-white/[0.008] p-4">
              <div className="mb-2.5 j-fs-micro font-bold uppercase tracking-[0.14em] text-[color:var(--j-text-faint)]">
                {BLUEPRINTS[2]!.title} · circuit map
              </div>
              <Graph nodes={BLUEPRINTS[2]!.nodes} edges={BLUEPRINTS[2]!.edges} edgeState={() => "blueprint"} now={data.now} blueprint />
            </div>
          </div>
        )}

        {mode === "blueprint" && (
          <div className="space-y-4">
            {BLUEPRINTS.map((bp) => (
              <div key={bp.title} className="rounded-2xl border border-white/5 bg-white/[0.008] p-4">
                <div className="mb-2.5 j-fs-micro font-bold uppercase tracking-[0.14em] text-[color:var(--j-text-faint)]">{bp.title}</div>
                <Graph nodes={bp.nodes} edges={bp.edges} edgeState={() => "blueprint"} now={data.now} blueprint />
              </div>
            ))}
            <p className="text-center j-fs-sm text-[color:var(--j-text-dim)]">
              Say &ldquo;start the invoice to cash workflow&rdquo; and watch a circuit light up live.
            </p>
          </div>
        )}
        <RunBrowser runs={[...runs, ...data.terminalRuns.filter((terminal) => !runs.some((run) => run.id === terminal.id))]} now={data.now} onOpen={setOpenRunId} onSelectStep={setOpenReceiptStepId} />
      </div>
      {openRun && <RunDrawer run={openRun} onClose={() => setOpenRunId(null)} />}
      {openReceiptStepId && <StepReceiptLookup stepId={openReceiptStepId} onClose={() => setOpenReceiptStepId(null)} />}
    </div>
  )
}
