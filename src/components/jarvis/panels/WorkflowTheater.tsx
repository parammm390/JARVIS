"use client"

// §7.5 THE CENTERPIECE — a live node-graph. Real workflow_runs render as chains whose
// edges FLOW into the currently-leased step (dash animation + a traveling light dot);
// completed edges settle solid green; step completion pops the node and draws a check.
// The canonical instruction path is action-ID scoped: no blueprint or replay mode
// is allowed to stand in for a linked run.

import { useEffect, useMemo, useRef, useState } from "react"
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
import { getAnchorRect, onPulse, registerAnchor } from "../lib/pulse-bus"
import { isSandboxStep, SANDBOX_LITERAL } from "../lib/sandbox-detection"
import { LF10_WORKFLOW_IGNITION_MS, LF12_STEP_SPARK_MS, leasedFlowDurationMs, workflowFaultVariants } from "../kernel/execution-choreography"
import { executionMetricTransitionKey, markExecutionPixelPainted } from "../kernel/execution-metrics"
import { choreo } from "../ui/motion/choreo"
import { runStatusPresentation, stepStatusPresentation } from "../kernel/workflow-presentation"
import { executionProgressForActions, runsForActionIds, scopedExecutionMode, type ScopedExecutionMode } from "../kernel/execution-presentation"
import type { StepState } from "../kernel/types"

// F8.T1 — FLOW-60 FlowParticulate: real steps/min from pulse-bus's "step" kind
// (the same real step-completed diffs data-core.ts's fast-lane poll already emits,
// republished by F2's pulse-bus — no new transport, no polling of its own), a
// trailing 60s window recomputed every 5s. Same shape as Bridge.tsx's own
// useEventRateOpacity — mirrored here rather than imported since that hook is
// Bridge-local and this needs a plain steps/min NUMBER, not a caustic opacity.
const THROUGHPUT_WINDOW_MS = 60_000
export function useStepsPerMinute(stepIds?: readonly string[]): number {
  const timestampsRef = useRef<number[]>([])
  const [perMinute, setPerMinute] = useState(0)
  useEffect(() => {
    const off = onPulse((pulse) => {
      if (pulse.kind !== "step") return
      const detail = pulse.detail
      const stepId = typeof detail === "object" && detail !== null && "stepId" in detail && typeof detail.stepId === "string" ? detail.stepId : null
      if (stepIds && (!stepId || !stepIds.includes(stepId))) return
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
  }, [stepIds])
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

type IgnitionPoint = { left: number; top: number }

function ignitionPath(from: IgnitionPoint, to: IgnitionPoint): string {
  const midX = from.left + (to.left - from.left) * 0.52
  return `M${from.left},${from.top} C${midX},${from.top} ${midX},${to.top} ${to.left},${to.top}`
}
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

function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = X(from.col) + NODE_W
  const y1 = Y(from.row) + NODE_H / 2
  const x2 = X(to.col)
  const y2 = Y(to.row) + NODE_H / 2
  const mid = (x1 + x2) / 2
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
}

export type EdgeState = "done" | "flowing" | "future" | "fault" | "rewind" | "rewound"

function GraphEdges({ nodes, edges, edgeState, particulate = 1, energy = 0 }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState; particulate?: number; energy?: number }) {
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
        const stroke = state === "done" ? "var(--j-green)" : state === "flowing" ? "var(--j-cyan)" : state === "fault" ? "var(--j-red)" : state === "rewind" || state === "rewound" ? "var(--j-amber)" : "var(--j-text-faint)"
        // FLOW-60 FlowParticulate: real steps/min (0/low/med/high tiers, never a
        // fabricated smooth interpolation) controls the traveling-dot count on a
        // genuinely flowing edge. The directional speed is the Phase 4 contract's
        // real LIVEFRAME energy value, passed separately below.
        const dotDur = `${(leasedFlowDurationMs(energy) / 1000).toFixed(2)}s`
        return (
          <g key={i}>
            {/* P4.T8 frame budget: the semantic path is sufficient while the
                active Weave owns motion; avoid a second blurred path per lane. */}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={state === "done" || state === "flowing" || state === "fault" || state === "rewind" || state === "rewound" ? 2 : 1.4}
              strokeDasharray={state === "done" || state === "rewound" ? undefined : state === "flowing" || state === "rewind" ? "5 8" : e.optional ? "2 7" : "3 8"}
              // P4.T8 frame budget: the one real traveling dot below carries the
              // leased/compensating direction; a second dash-offset loop on the
              // same edge is redundant work while the active Weave is visible.
              className=""
              opacity={state === "future" ? 0.35 : 1}
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
          </g>
        )
      })}
      {junctionNodes.map((n) => (
        <circle key={n.id} cx={X(n.col)} cy={Y(n.row) + NODE_H / 2} r={3} fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth={1.5} />
      ))}
    </svg>
  )
}

export const NODE_TONE: Record<string, { border: string; iconBg: string; icon: string; shadow?: string }> & Record<StepState, { border: string; iconBg: string; icon: string; shadow?: string }> = {
  pending: { border: "rgba(100,128,159,0.18)", iconBg: "rgba(100,128,159,0.1)", icon: "var(--j-text-dim)" },
  leased: { border: "var(--j-border-hot)", iconBg: "rgba(34,211,238,0.14)", icon: "var(--j-cyan)", shadow: "0 0 22px rgba(34,211,238,0.28)" },
  completed: { border: "rgba(52,211,153,0.45)", iconBg: "rgba(52,211,153,0.12)", icon: "var(--j-green)" },
  failed: { border: "rgba(248,113,113,0.5)", iconBg: "rgba(248,113,113,0.12)", icon: "var(--j-red)", shadow: "0 0 18px rgba(248,113,113,0.22)" },
  compensating: { border: "rgba(251,191,36,0.5)", iconBg: "rgba(251,191,36,0.12)", icon: "var(--j-amber)" },
  compensated: { border: "rgba(251,191,36,0.3)", iconBg: "rgba(251,191,36,0.08)", icon: "var(--j-amber)" },
}

export function GraphNodeCard({ node, now, onSelect }: { node: GraphNode; now: number; onSelect?: (node: GraphNode) => void }) {
  const reduced = useHydratedReducedMotion()
  const tone = NODE_TONE[node.status as StepState] ?? NODE_TONE.pending!
  const isLeased = node.status === "leased"
  const isDone = node.status === "completed"
  // A real step that resolved to a non-real provider gets the literal string as
  // an accessible title (a real DOM string, not a tooltip-only decoration).
  const { setupStatus } = useJarvis()
  const sandboxed = isSandboxStep(node.stepType, setupStatus?.environment?.bindings)
  // FLOW-59 ChamberPressure: only a genuinely leased node with a REAL retry
  // (attempts > 1, straight from workflow_steps.attempts) gets the pressure glow —
  // a first-attempt leased node keeps today's plain cyan pulse-ring unchanged.
  const underPressure = isLeased && (node.attempts ?? 0) > 1
  const prevStatusRef = useRef(node.status)
  const [shockwaveKey, setShockwaveKey] = useState(0)
  const [ignitionKey, setIgnitionKey] = useState(0)
  const [faultKey, setFaultKey] = useState(0)
  const nodeElRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousStatus = prevStatusRef.current
    const transitionType = node.status === "completed" ? "step-completed" : node.status === "failed" ? "step-failed" : null
    const metricKey = transitionType && previousStatus !== node.status
      ? executionMetricTransitionKey(transitionType, node.id, previousStatus, node.status)
      : null
    const frame = metricKey
      ? window.requestAnimationFrame((timestamp) => { markExecutionPixelPainted(metricKey, timestamp) })
      : null
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
    // M14 FaultShake: only a real status transition gets the one-shot cue. A
    // failed node first observed after a refresh is already the durable red
    // state and reason text, so it stays still instead of replaying history.
    if (prevStatusRef.current !== "failed" && node.status === "failed") {
      setFaultKey((k) => k + 1)
    }
    prevStatusRef.current = node.status
    return () => { if (frame !== null) window.cancelAnimationFrame(frame) }
  }, [node.id, node.status])

  const interactive = Boolean(onSelect)

  return (
    <div
      ref={nodeElRef}
      data-node
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Open evidence for ${humanizeStepType(node.stepType)}` : undefined}
      data-workflow-step-status={node.status}
      title={sandboxed ? SANDBOX_LITERAL : undefined}
      onClick={interactive ? () => onSelect?.(node) : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect?.(node)
        }
      } : undefined}
      // Keep the six-lane surface opaque. A backdrop filter on every node
      // forces a full-field blur under the animated atmosphere on each frame;
      // the node's own elevated background already preserves the hierarchy.
      className={`j-node group absolute flex items-center gap-2.5 rounded-xl border bg-[rgba(10,19,36,0.96)] px-3 transition-[opacity,border-color,box-shadow] duration-500 ${interactive ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" : ""}`}
      style={{
        left: X(node.col),
        top: Y(node.row),
        width: NODE_W,
        height: NODE_H,
        borderColor: tone.border,
        boxShadow: tone.shadow,
        opacity: node.status === "pending" ? 0.55 : 1,
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
      {!reduced && faultKey > 0 && (
        <motion.span
          key={faultKey}
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-xl border-2 border-red-300/70"
          variants={workflowFaultVariants(reduced)}
          initial="initial"
          animate="animate"
          onAnimationComplete={() => setFaultKey(0)}
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
        {/* P4.T8: the leased label, cyan outline, and real edge dot are enough
            to identify this durable state; avoid a second node-local loop. */}
        {isLeased && (
          <svg className="absolute -inset-1.5" width={44} height={44} viewBox="0 0 44 44" aria-hidden>
            <circle cx={22} cy={22} r={19} fill="none" stroke="var(--j-cyan)" strokeWidth={2} strokeDasharray="70 40" strokeLinecap="round" opacity={0.85} />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate j-fs-sm font-bold capitalize leading-tight text-[color:var(--j-text)]">{humanizeStepType(node.stepType)}</div>
        <div className="j-fs-micro text-[color:var(--j-text-dim)]">
          {node.status === "leased" && node.updatedAt
            ? `leased · ${ageSeconds(node.updatedAt, now)}s`
            : stepStatusPresentation(node.status as StepState).label + ((node.attempts ?? 0) > 1 ? ` · retry ${node.attempts}` : "")}
        </div>
      </div>
      {isDone && (
        <motion.div
          key={shockwaveKey > 0 ? `spark-${shockwaveKey}` : "settled-check"}
          initial={shockwaveKey > 0 && !reduced ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={reduced ? { duration: 0 } : { duration: LF12_STEP_SPARK_MS / 1000, ease: "easeOut" }}
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

export function Graph({ nodes, edges, edgeState, now, onSelectNode, particulate, energy }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState; now: number; onSelectNode?: (node: GraphNode) => void; particulate?: number; energy?: number }) {
  const maxCol = Math.max(...nodes.map((n) => n.col))
  const maxRow = Math.max(...nodes.map((n) => n.row))
  return (
    <div className="jarvis-workflow-graph-scroll j-scroll overflow-x-auto pb-1 pt-1">
      <div data-graph data-graph-lanes={nodes.length} className="jarvis-workflow-graph relative" style={{ width: X(maxCol) + NODE_W, height: Y(maxRow) + NODE_H, minWidth: X(maxCol) + NODE_W }}>
        <GraphEdges nodes={nodes} edges={edges} edgeState={edgeState} particulate={particulate} energy={energy} />
        {nodes.map((n) => (
          <GraphNodeCard key={n.id} node={n} now={now} onSelect={onSelectNode} />
        ))}
      </div>
    </div>
  )
}

function LiveRunRow({ run, now, onOpen, onSelectStep, energy = 0 }: { run: WorkflowRun; now: number; onOpen: () => void; onSelectStep?: (node: GraphNode) => void; energy?: number }) {
  const previousRunStatusRef = useRef(run.status)
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
  const leasedIdx = run.steps.findIndex((s) => s.status === "leased")
  const pct = runProgressPct(run)
  const stepIds = useMemo(() => run.steps.map((step) => step.id), [run.steps])
  const stepsPerMin = useStepsPerMinute(stepIds)
  // FLOW-60 tiers: 0 real steps/min in the trailing 60s window = one dot;
  // 1-2 = two dots; 3+ = three dots. The count is earned by real throughput,
  // while flow speed comes from the current LIVEFRAME energy value.
  const particulate = stepsPerMin >= 3 ? 3 : stepsPerMin >= 1 ? 2 : 1
  const runPresentation = runStatusPresentation(run.status as import("../kernel/types").RunState)

  useEffect(() => {
    const previousStatus = previousRunStatusRef.current
    const transitionType = run.status === "completed" ? "run-completed" : run.status === "failed" ? "run-failed" : null
    const metricKey = transitionType && previousStatus !== run.status
      ? executionMetricTransitionKey(transitionType, run.id, previousStatus, run.status)
      : null
    const frame = metricKey
      ? window.requestAnimationFrame((timestamp) => { markExecutionPixelPainted(metricKey, timestamp) })
      : null
    previousRunStatusRef.current = run.status
    return () => { if (frame !== null) window.cancelAnimationFrame(frame) }
  }, [run.id, run.status])

  const edgeState = (e: GraphEdge): EdgeState => {
    const toStep = run.steps.find((s) => s.id === e.to)
    if (toStep?.status === "compensating") return "rewind"
    if (toStep?.status === "compensated") return "rewound"
    if (toStep?.status === "failed") return "fault"
    const toIdx = run.steps.findIndex((s) => s.id === e.to)
    if (run.steps[toIdx]?.status === "completed") return "done"
    if (toIdx === leasedIdx) return "flowing"
    return "future"
  }

  return (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-[color:var(--j-border)] bg-white/[0.015] p-4"
      data-run-status={run.status}
      data-workflow-energy={energy.toFixed(2)}
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
      <Graph nodes={nodes} edges={edges} edgeState={edgeState} now={now} onSelectNode={onSelectStep} particulate={particulate} energy={energy} />
    </motion.div>
  )
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

// A node click reveals the real step fields first, then performs the same
// tenant-scoped receipt lookup as the explicit "Why?" action. A missing receipt
// is a visible state, not an empty click or invented JSON.
function StepEvidenceDrawer({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [lookupState, setLookupState] = useState<"loading" | "found" | "none">("loading")
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    let current = true
    setLookupState("loading")
    void jarvisGet<{ receipts: Array<{ id: string }> }>("receipts", { workflowStepId: node.id })
      .then((res) => {
        if (!current) return
        const id = res.receipts[0]?.id ?? null
        setReceiptId(id)
        setLookupState(id ? "found" : "none")
      })
      .catch(() => {
        if (!current) return
        setReceiptId(null)
        setLookupState("none")
      })
    return () => {
      current = false
    }
  }, [node.id])

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Evidence for ${humanizeStepType(node.stepType)}`}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        onKeyDown={(event) => { if (event.key === "Escape") onClose() }}
        data-testid="workflow-step-evidence"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="j-label">Step evidence</div>
            <h3 className="mt-1 text-lg font-black text-[color:var(--j-text)]">{humanizeStepType(node.stepType)}</h3>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-full border border-white/12 px-3 j-fs-sm text-white/60 hover:text-white">Close</button>
        </div>
        <dl className="grid gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 j-fs-sm">
          <div className="flex items-center justify-between gap-4"><dt className="text-[color:var(--j-text-faint)]">Status</dt><dd className="font-bold text-[color:var(--j-text)]">{stepStatusPresentation(node.status as StepState).label}</dd></div>
          <div className="flex items-center justify-between gap-4"><dt className="text-[color:var(--j-text-faint)]">Attempts</dt><dd className="font-bold text-[color:var(--j-text)]">{node.attempts ?? 0}</dd></div>
          <div className="flex items-center justify-between gap-4"><dt className="text-[color:var(--j-text-faint)]">Last observed</dt><dd className="text-right font-bold text-[color:var(--j-text)]">{node.updatedAt ? new Date(node.updatedAt).toLocaleString() : "Not observed"}</dd></div>
          {node.terminalReason && <div className="border-t border-white/8 pt-3"><dt className="text-[color:var(--j-text-faint)]">Reason</dt><dd className="mt-1 text-red-200">{node.terminalReason}</dd></div>}
        </dl>
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <div className="j-label">Receipt</div>
          {lookupState === "loading" && <p className="mt-2 j-fs-sm text-[color:var(--j-text-dim)]">Checking for a recorded receipt…</p>}
          {lookupState === "none" && <p className="mt-2 j-fs-sm text-[color:var(--j-text-dim)]" data-testid="workflow-step-no-receipt">No receipt has landed for this step yet.</p>}
          {lookupState === "found" && receiptId && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="j-fs-sm text-emerald-100">Receipt recorded for this step.</p>
              <button type="button" className="min-h-11 rounded-full border border-cyan-300/30 px-3 j-fs-micro font-black text-cyan-200" onClick={() => setReceiptOpen(true)}>Open receipt</button>
            </div>
          )}
        </div>
        {receiptOpen && receiptId && <ReceiptDrawer receiptId={receiptId} onClose={() => setReceiptOpen(false)} />}
      </motion.aside>
    </AnimatePresence>
  )
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
                <span className="text-[color:var(--j-text-dim)]">{stepStatusPresentation(s.status as StepState).label}</span>
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

function RunBrowser({ runs, now, onOpen, onSelectStep, energy = 0 }: { runs: WorkflowRun[]; now: number; onOpen: (runId: string) => void; onSelectStep: (node: GraphNode) => void; energy?: number }) {
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
      {expandedRunId === run.id && <div className="mt-3"><LiveRunRow run={run} now={now} onOpen={() => onOpen(run.id)} onSelectStep={onSelectStep} energy={energy} /></div>}
    </div>
  )

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.012] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="j-fs-micro font-black uppercase tracking-[0.16em] text-[color:var(--j-text-faint)]">Run browser</div>
          <p className="j-fs-micro text-[color:var(--j-text-dim)]" data-jarvis-fact data-source="workflowRuns">{filtered.length} of {runs.length} real runs</p>
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

function ScopedExecutionWaiting({ actionCount }: { actionCount: number }) {
  return (
    <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.035] p-4" data-testid="workflow-scope-waiting">
      <div className="j-fs-base font-bold text-amber-100">Waiting for this instruction&rsquo;s workflow</div>
      <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">
        {actionCount} action{actionCount === 1 ? "" : "s"} accepted; no linked workflow run has landed yet.
      </p>
      <p className="mt-2 j-fs-micro text-[color:var(--j-text-faint)]">Other tenant runs are hidden until this instruction&rsquo;s action IDs appear.</p>
    </div>
  )
}

function ScopedExecutionEmpty() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4" data-testid="workflow-scope-required">
      <div className="j-fs-base font-bold text-[color:var(--j-text)]">No linked workflow for this instruction</div>
      <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">The execution view stays empty until this instruction exposes real action IDs.</p>
    </div>
  )
}

function ScopedTraceOutcome({ progress }: { progress: NonNullable<ReturnType<typeof executionProgressForActions>> }) {
  return (
    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.035] p-4" data-testid="workflow-trace-settled">
      <div className="j-fs-base font-bold text-emerald-100">Instruction outcome recorded</div>
      <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">
        {progress.completedActions} of {progress.totalActions} action{progress.totalActions === 1 ? "" : "s"} completed
        {progress.failedActions > 0 ? ` · ${progress.failedActions} failed` : ""} from the instruction trace.
      </p>
      <p className="mt-2 j-fs-micro text-[color:var(--j-text-faint)]">No durable workflow run was emitted for this synchronous action path.</p>
    </div>
  )
}

const ACTIVE_SCOPED_RUN_STATES = new Set(["running", "paused", "compensating"])

export function WorkflowTheater({ actionIds, traceOutcomes, blockedActionIds = [], energy = 0 }: {
  /** Mandatory active-instruction scope; an unscoped theater is not renderable. */
  actionIds: readonly string[]
  traceOutcomes?: { completedActionIds?: readonly string[]; failedActionIds?: readonly string[] }
  blockedActionIds?: readonly string[]
  /** Current real LIVEFRAME energy; used only to tune a real leased edge. */
  energy?: number
}) {
  const data = useJarvis()
  const reduced = useHydratedReducedMotion()
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<GraphNode | null>(null)
  const handledRunLinkRef = useRef<string | null>(null)
  const theaterRef = useRef<HTMLDivElement | null>(null)
  const seenRunIdsRef = useRef<Set<string> | null>(null)
  const ignitionSequenceRef = useRef(0)
  const [ignitionKey, setIgnitionKey] = useState(0)
  const [ignitionPathState, setIgnitionPathState] = useState<{ id: number; from: IgnitionPoint; to: IgnitionPoint } | null>(null)
  const allRuns = useMemo(() => [...data.runs, ...data.terminalRuns], [data.runs, data.terminalRuns])
  const scopedRuns = useMemo(() => runsForActionIds(allRuns, actionIds), [actionIds, allRuns])
  const runs = useMemo(() => scopedRuns.filter((run) => ACTIVE_SCOPED_RUN_STATES.has(run.status)), [scopedRuns])
  const terminalRuns = useMemo(() => scopedRuns.filter((run) => !ACTIVE_SCOPED_RUN_STATES.has(run.status)), [scopedRuns])
  const progress = useMemo(
    () => executionProgressForActions(actionIds, allRuns, traceOutcomes, blockedActionIds),
    [actionIds, allRuns, blockedActionIds, traceOutcomes],
  )
  const displayRuns = runs.length > 0 ? runs : terminalRuns
  const runBrowserRuns = useMemo(
    () => scopedRuns,
    [scopedRuns],
  )
  const visible = displayRuns.slice(0, 3)
  const extra = displayRuns.length - visible.length
  const openRun = runBrowserRuns.find((r) => r.id === openRunId) ?? null

  useEffect(() => registerAnchor("workflow-origin", () => theaterRef.current?.getBoundingClientRect() ?? null), [])

  useEffect(() => {
    if (seenRunIdsRef.current === null) {
      seenRunIdsRef.current = new Set(scopedRuns.map((run) => run.id))
      return
    }
    const seen = seenRunIdsRef.current
    const newRunObserved = scopedRuns.some((run) => !seen.has(run.id))
    scopedRuns.forEach((run) => seen.add(run.id))
    if (newRunObserved) {
      setIgnitionKey((key) => key + 1)
      const firstLinkedActionId = actionIds.find((actionId) => scopedRuns.some((run) => run.steps.some((step) => step.domainActionId === actionId)))
      const sourceRect = firstLinkedActionId ? getAnchorRect(`approval-action-${firstLinkedActionId}`) : null
      const fallbackSourceRect = sourceRect ?? getAnchorRect("approval-cockpit")
      const targetRect = theaterRef.current?.getBoundingClientRect() ?? null
      if (fallbackSourceRect && targetRect) {
        const center = (rect: DOMRect): IgnitionPoint => ({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 })
        ignitionSequenceRef.current += 1
        const id = ignitionSequenceRef.current
        setIgnitionPathState({ id, from: center(fallbackSourceRect), to: center(targetRect) })
      }
    }
  }, [actionIds, scopedRuns])

  useEffect(() => {
    if (!ignitionPathState) return
    const timer = window.setTimeout(() => setIgnitionPathState((current) => current?.id === ignitionPathState.id ? null : current), LF10_WORKFLOW_IGNITION_MS)
    return () => window.clearTimeout(timer)
  }, [ignitionPathState])

  useEffect(() => {
    const requestedRunId = new URLSearchParams(window.location.search).get("workflowRunId")
    if (requestedRunId && requestedRunId !== handledRunLinkRef.current && runBrowserRuns.some((run) => run.id === requestedRunId)) {
      handledRunLinkRef.current = requestedRunId
      setOpenRunId(requestedRunId)
    }
  }, [runBrowserRuns])

  useEffect(() => {
    const linkedRunIds = new Set(scopedRuns.map((run) => run.id))
    const linkedStepIds = new Set(scopedRuns.flatMap((run) => run.steps.map((step) => step.id)))
    const idFrom = (detail: unknown, key: "runId" | "stepId"): string | null => {
      if (typeof detail !== "object" || detail === null || !(key in detail)) return null
      const value = (detail as Record<string, unknown>)[key]
      return typeof value === "string" ? value : null
    }
    const offs = [
      onJarvisEvent("step-completed", (detail) => { if (linkedStepIds.has(idFrom(detail, "stepId") ?? "")) sfx.stepTick() }),
      onJarvisEvent("run-completed", (detail) => { if (linkedRunIds.has(idFrom(detail, "runId") ?? "")) sfx.runDone() }),
    ]
    return () => offs.forEach((off) => off())
  }, [scopedRuns])

  const mode: ScopedExecutionMode = scopedExecutionMode(actionIds, runs, terminalRuns, progress)

  const progressCopy = progress
    ? `${progress.completedActions} of ${progress.totalActions} actions complete${[
        progress.failedActions > 0 ? `${progress.failedActions} failed` : null,
        progress.blockedActions > 0 ? `${progress.blockedActions} blocked` : null,
        progress.runningActions > 0 ? `${progress.runningActions} running` : null,
        progress.pausedActions > 0 ? `${progress.pausedActions} paused` : null,
        progress.compensatingActions > 0 ? `${progress.compensatingActions} rolling back` : null,
        progress.compensatedActions > 0 ? `${progress.compensatedActions} rolled back` : null,
        progress.cancelledActions > 0 ? `${progress.cancelledActions} cancelled` : null,
        progress.escalatedActions > 0 ? `${progress.escalatedActions} escalated` : null,
        progress.unresolvedActions > 0 ? `${progress.unresolvedActions} not observed` : null,
      ].filter((detail): detail is string => detail !== null).map((detail) => ` · ${detail}`).join("")}`
    : null

  return (
    <div id="workflow-theater" ref={theaterRef} className="j-panel j-hud relative overflow-hidden xl:col-span-2" data-workflow-scope="action-ids" data-action-ids={actionIds.join(",")} data-workflow-energy={energy.toFixed(2)}>
      <AnimatePresence initial={false}>
        {ignitionPathState && !reduced && (
          <motion.svg
            key={ignitionPathState.id}
            aria-hidden
            data-liveframe-impulse="LF-10"
            className="pointer-events-none fixed inset-0 z-[55] h-screen w-screen overflow-visible"
          >
            <motion.path
              d={ignitionPath(ignitionPathState.from, ignitionPathState.to)}
              fill="none"
              stroke="var(--j-cyan)"
              strokeWidth={2}
              strokeDasharray="5 8"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: [0, 0.9, 0] }}
              transition={{ duration: LF10_WORKFLOW_IGNITION_MS / 1000, ease: "easeOut" }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
      <div className="p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="j-label flex items-center gap-2">
              {mode === "live" ? (
                <>
                  <LiveDot /> Live Workflow
                </>
              ) : mode === "settled" ? (
                "Recorded Workflow"
              ) : mode === "waiting" ? (
                "Instruction Workflow"
              ) : mode === "trace" ? (
                "Instruction Outcome"
              ) : mode === "empty" ? (
                "Instruction Workflow"
              ) : (
                "Instruction Workflow"
              )}
            </span>
            {progressCopy && (
              <span className="j-chip bg-cyan-400/10 text-cyan-300" data-jarvis-fact data-source="thread.actionIds">
                {progressCopy}
              </span>
            )}
            {mode === "live" && <span className="j-chip bg-cyan-400/10 text-cyan-300">{runs.length} linked run{runs.length === 1 ? "" : "s"}</span>}
            {mode === "settled" && <span className="j-chip bg-emerald-400/10 text-emerald-300">{terminalRuns.length} linked run{terminalRuns.length === 1 ? "" : "s"} recorded</span>}
            {mode === "waiting" && <span className="j-chip bg-amber-300/10 text-amber-200">awaiting linked run</span>}
            {ignitionKey > 0 && <motion.span key={ignitionKey} data-liveframe-impulse="LF-10" className="j-chip bg-cyan-300/15 text-cyan-100" initial={{ opacity: 0, scale: 0.9 }} animate={reduced ? { opacity: 1, scale: 1 } : { opacity: [0, 1, 0], scale: [0.9, 1, 1.04] }} transition={{ duration: reduced ? 0 : LF10_WORKFLOW_IGNITION_MS / 1000 }}>linked run observed</motion.span>}
          </div>
          <span className="j-chip bg-white/5 text-[color:var(--j-text-dim)]">every consequential step is gated</span>
        </div>

        {(mode === "live" || mode === "settled") && (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {visible.map((run) => (
                <LiveRunRow key={run.id} run={run} now={data.now} onOpen={() => setOpenRunId(run.id)} onSelectStep={setSelectedStep} energy={energy} />
              ))}
            </AnimatePresence>
            {extra > 0 && <div className="text-center j-fs-micro text-[color:var(--j-text-dim)]" data-jarvis-fact data-source="workflowRuns">+{extra} more linked run{extra === 1 ? "" : "s"}</div>}
          </div>
        )}

        {mode === "empty" && <ScopedExecutionEmpty />}

        {mode === "waiting" && <ScopedExecutionWaiting actionCount={actionIds.length} />}

        {mode === "trace" && progress && <ScopedTraceOutcome progress={progress} />}

        {(mode === "live" || mode === "settled") && (
            <RunBrowser runs={runBrowserRuns} now={data.now} onOpen={setOpenRunId} onSelectStep={setSelectedStep} energy={energy} />
        )}
      </div>
      {openRun && <RunDrawer run={openRun} onClose={() => setOpenRunId(null)} />}
      {selectedStep && <StepEvidenceDrawer node={selectedStep} onClose={() => setSelectedStep(null)} />}
    </div>
  )
}
