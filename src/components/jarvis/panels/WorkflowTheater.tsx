"use client"

// §7.5 THE CENTERPIECE — a live node-graph. Real workflow_runs render as chains whose
// edges FLOW into the currently-leased step (dash animation + a traveling light dot);
// completed edges settle solid green; step completion pops the node and draws a check.
// With nothing in flight, Blueprint mode renders the four real lifecycle graphs from
// the actual step maps (including the installation workflow's genuine parallel branch)
// as dim ambient circuitry — no ages, no counts, nothing data-shaped (§2).

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check } from "lucide-react"
import { LiveDot } from "../atmosphere"
import { StepIcon, humanizeStepType, humanizeWorkflowType } from "./StepIcon"
import { useJarvis, onJarvisEvent, runProgressPct, ageLabel, ageSeconds, type WorkflowRun } from "../lib/data-core"
import { sfx } from "../sound"

const NODE_W = 172
const NODE_H = 72
const GAP_X = 56
const GAP_Y = 26
const X = (col: number) => col * (NODE_W + GAP_X)
const Y = (row: number) => row * (NODE_H + GAP_Y)

interface GraphNode {
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
interface GraphEdge {
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

type EdgeState = "done" | "flowing" | "future" | "blueprint"

function GraphEdges({ nodes, edges, edgeState }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState }) {
  const reduced = useReducedMotion()
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
          state === "done" ? "var(--j-green)" : state === "flowing" ? "var(--j-cyan)" : state === "blueprint" ? "rgba(59,130,246,0.5)" : "var(--j-text-faint)"
        return (
          <g key={i}>
            {(state === "flowing" || state === "blueprint") && (
              <path d={d} fill="none" stroke={stroke} strokeWidth={6} opacity={state === "flowing" ? 0.3 : 0.12} style={{ filter: "blur(4px)" }} />
            )}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={state === "done" || state === "flowing" ? 2 : 1.4}
              strokeDasharray={state === "done" ? undefined : state === "flowing" ? "5 8" : e.optional ? "2 7" : "3 8"}
              className={!reduced && state === "flowing" ? "jarvis-edge-flow" : !reduced && state === "blueprint" ? "jarvis-edge-blueprint" : ""}
              opacity={state === "future" ? 0.35 : state === "blueprint" ? 0.7 : 1}
            />
            {!reduced && state === "flowing" && (
              <>
                <circle r={3} fill="var(--j-cyan)">
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                </circle>
                <circle r={2.2} fill="var(--j-cyan)" opacity={0.7}>
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={d} begin="0.15s" />
                </circle>
                <circle r={1.6} fill="var(--j-cyan)" opacity={0.45}>
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={d} begin="0.3s" />
                </circle>
                <circle r={6} fill="var(--j-cyan)" opacity={0.25}>
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                </circle>
              </>
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

const NODE_TONE: Record<string, { border: string; iconBg: string; icon: string; shadow?: string }> = {
  pending: { border: "rgba(100,128,159,0.18)", iconBg: "rgba(100,128,159,0.1)", icon: "var(--j-text-dim)" },
  leased: { border: "var(--j-border-hot)", iconBg: "rgba(34,211,238,0.14)", icon: "var(--j-cyan)", shadow: "0 0 22px rgba(34,211,238,0.28)" },
  completed: { border: "rgba(52,211,153,0.45)", iconBg: "rgba(52,211,153,0.12)", icon: "var(--j-green)" },
  failed: { border: "rgba(248,113,113,0.5)", iconBg: "rgba(248,113,113,0.12)", icon: "var(--j-red)", shadow: "0 0 18px rgba(248,113,113,0.22)" },
  compensating: { border: "rgba(251,191,36,0.5)", iconBg: "rgba(251,191,36,0.12)", icon: "var(--j-amber)" },
  compensated: { border: "rgba(251,191,36,0.3)", iconBg: "rgba(251,191,36,0.08)", icon: "var(--j-amber)" },
  blueprint: { border: "rgba(59,130,246,0.16)", iconBg: "rgba(59,130,246,0.08)", icon: "rgba(94,148,213,0.75)" },
}

function GraphNodeCard({ node, now, blueprint }: { node: GraphNode; now: number; blueprint?: boolean }) {
  const reduced = useReducedMotion()
  const tone = NODE_TONE[node.status] ?? NODE_TONE.pending!
  const isLeased = node.status === "leased"
  const isDone = node.status === "completed"
  const prevStatusRef = useRef(node.status)
  const [shockwaveKey, setShockwaveKey] = useState(0)

  useEffect(() => {
    if (prevStatusRef.current !== "completed" && node.status === "completed") {
      setShockwaveKey((k) => k + 1)
    }
    prevStatusRef.current = node.status
  }, [node.status])

  return (
    <div
      data-node
      className="j-node jarvis-rise group absolute flex items-center gap-2.5 rounded-xl border bg-[rgba(10,19,36,0.92)] px-3 backdrop-blur-md transition-[opacity,border-color,box-shadow] duration-500"
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
        <div className="truncate text-[11.5px] font-bold capitalize leading-tight text-[color:var(--j-text)]">{humanizeStepType(node.stepType)}</div>
        <div className="text-[9.5px] text-[color:var(--j-text-dim)]">
          {blueprint
            ? node.optional
              ? "optional"
              : " "
            : node.status === "leased" && node.updatedAt
              ? `running · ${ageSeconds(node.updatedAt, now)}s`
              : node.status + ((node.attempts ?? 0) > 1 ? ` · retry ${node.attempts}` : "")}
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
      {node.status === "failed" && node.terminalReason && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-44 -translate-x-1/2 rounded-lg border border-red-400/30 bg-slate-950 p-2 text-[10px] text-red-300 opacity-0 shadow-xl transition group-hover:opacity-100">
          {node.terminalReason}
        </div>
      )}
    </div>
  )
}

function Graph({ nodes, edges, edgeState, now, blueprint }: { nodes: GraphNode[]; edges: GraphEdge[]; edgeState: (e: GraphEdge) => EdgeState; now: number; blueprint?: boolean }) {
  const maxCol = Math.max(...nodes.map((n) => n.col))
  const maxRow = Math.max(...nodes.map((n) => n.row))
  return (
    <div className="j-scroll overflow-x-auto pb-1 pt-1">
      <div data-graph className="relative" style={{ width: X(maxCol) + NODE_W, height: Y(maxRow) + NODE_H, minWidth: X(maxCol) + NODE_W }}>
        <GraphEdges nodes={nodes} edges={edges} edgeState={edgeState} />
        {nodes.map((n) => (
          <GraphNodeCard key={n.id} node={n} now={now} blueprint={blueprint} />
        ))}
      </div>
    </div>
  )
}

function LiveRunRow({ run, now, onOpen }: { run: WorkflowRun; now: number; onOpen: () => void }) {
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

  const edgeState = (e: GraphEdge): EdgeState => {
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
          <span className="truncate text-[13.5px] font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</span>
          <span className="j-chip bg-white/6 font-mono text-[color:var(--j-text-dim)]">{ageLabel(run.createdAt, now)}</span>
          {run.status === "running" && (
            <span className="j-chip bg-cyan-400/10 text-cyan-300">
              <LiveDot /> running
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-[color:var(--j-text-dim)]">{pct}%</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>
      <Graph nodes={nodes} edges={edges} edgeState={edgeState} now={now} />
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
          <span className="truncate text-[13.5px] font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</span>
          <span className="j-chip bg-violet-400/12 text-violet-300">REPLAY</span>
          <span className="j-chip bg-white/6 font-mono text-[color:var(--j-text-dim)]">
            {run.status} {ageLabel(run.updatedAt, now)} ago
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-[color:var(--j-text-dim)]">{pct}%</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
            <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out ${done ? "from-emerald-400 to-teal-300" : "from-teal-400 to-cyan-400"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <Graph nodes={nodes} edges={edges} edgeState={edgeState} now={now} />
      <div className="mt-2 text-[9.5px] text-[color:var(--j-text-faint)]">Re-enactment of a real run from the ledger · step timing compressed for display.</div>
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

function RunDrawer({ run, onClose }: { run: WorkflowRun; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-[color:var(--j-text)]">{humanizeWorkflowType(run.workflowType)}</h3>
          <button onClick={onClose} className="rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 hover:text-white">
            Close
          </button>
        </div>
        <div className="space-y-3">
          {run.steps.map((s) => (
            <div key={s.id} className="j-panel !rounded-xl p-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-[color:var(--j-text)]">
                <span className="flex items-center gap-2 capitalize">
                  <StepIcon stepType={s.stepType} className="h-3.5 w-3.5" /> {humanizeStepType(s.stepType)}
                </span>
                <span className="text-[color:var(--j-text-dim)]">{s.status}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-[color:var(--j-text-faint)]">
                updated {new Date(s.updatedAt).toLocaleString()} · attempts {s.attempts}
                {s.terminalReason ? ` · ${s.terminalReason}` : ""}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export function WorkflowTheater() {
  const data = useJarvis()
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const runs = data.runs
  const visible = runs.slice(0, 3)
  const extra = runs.length - visible.length
  const openRun = runs.find((r) => r.id === openRunId) ?? null

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
    <div className="j-panel j-hud relative overflow-hidden xl:col-span-2">
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
                <LiveRunRow key={run.id} run={run} now={data.now} onOpen={() => setOpenRunId(run.id)} />
              ))}
            </AnimatePresence>
            {extra > 0 && <div className="text-center text-[11px] text-[color:var(--j-text-dim)]">+{extra} more in flight</div>}
          </div>
        )}

        {mode === "replay" && (
          <div className="space-y-4">
            <ReplayTheater pool={replayPool} now={data.now} />
            <div className="rounded-2xl border border-white/5 bg-white/[0.008] p-4">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--j-text-faint)]">
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
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--j-text-faint)]">{bp.title}</div>
                <Graph nodes={bp.nodes} edges={bp.edges} edgeState={() => "blueprint"} now={data.now} blueprint />
              </div>
            ))}
            <p className="text-center text-[12px] text-[color:var(--j-text-dim)]">
              Say &ldquo;start the invoice to cash workflow&rdquo; and watch a circuit light up live.
            </p>
          </div>
        )}
      </div>
      {openRun && <RunDrawer run={openRun} onClose={() => setOpenRunId(null)} />}
    </div>
  )
}
