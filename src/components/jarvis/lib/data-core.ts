"use client"

// One provider owns ALL polling — panels only useJarvis(), never fetch for themselves.
// Fast lane (4s): stats, pending/blocked actions, running workflow runs.
// Medium lane (8s): events, comms.
// Slow lane (30s): all read-models, insights.
// Sanity lane (60s): setup/status.
// A ring buffer of the last 30 fast-lane snapshots (~2min) powers session deltas and
// change detection; a typed emitter fires on real state transitions so panels can
// pulse/sound honestly — every flash traces to an actual diff, never a fake tick.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { jarvisGet } from "./api"

// ---------------------------------------------------------------------------
// Types (§4 endpoint shapes, verified against the live API)
// ---------------------------------------------------------------------------

export interface ActionRow {
  id: string
  actionType: string
  status: string
  summary: string | null
  createdAt: string
}
export interface StatsResponse {
  pending: number
  blocked: number
  recentActions: ActionRow[]
}
export interface PendingAction {
  id: string
  actionType: string
  summary: string | null
  payload: unknown
  status: string
  createdAt: string
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>
}
export interface WorkflowStep {
  id: string
  stepType: string
  sequence: number
  status: string
  attempts: number
  terminalReason: string | null
  updatedAt: string
}
export interface WorkflowRun {
  id: string
  workflowType: string
  status: string
  createdAt: string
  updatedAt: string
  steps: WorkflowStep[]
}
export interface EventRow {
  id: string
  entityType: string
  entityId: string
  eventType: string
  payload: unknown
  occurredAt: string
  source: string
}
export interface CommsRow {
  id: string
  channel: string
  content: string
  createdAt: string
  /** sandbox outbox rows carry toNumber + simulated; real communications_log rows carry direction + household instead. */
  toNumber?: string
  simulated?: boolean
  direction?: string
  household?: string
}
export interface PipelineHealth {
  leadsByStatus: Array<{ status: string; count: number }>
  quotesByStatus: Array<{ status: string; count: number }>
  proposalsByStatus: Array<{ status: string; count: number }>
}
export interface CashCollections {
  invoicesByStatus: Array<{ status: string; count: number; totalUsd: number }>
  totalCollected: number
  paymentLinksAwaitingPayment: number
}
export interface SlaBreaches {
  stuckWorkflowRuns: number
  openReconciliationCases: number
}
export interface StockRisk {
  belowThreshold: Array<{ sku: string; name: string; quantity: number; reorderThreshold: number }>
  openProcurementOrders: number
}
export type FollowUpDebt = Array<{ entityType: string; entityId: string; householdId: string; status: string; lastActivityAt: string }>
export type TechnicianLoad = Array<{ technicianId: string; name: string; upcomingAppointments: number; openWorkOrders: number }>
export type ServiceDue = Array<{ agreementId: string; householdId: string; cadence: string; status: string; renewalDate: string }>
export interface DataQuality {
  byTypeAndSeverity: Array<{ entityType: string; severity: string; count: number }>
  totalUnresolved: number
}
export interface Insights {
  actionTypeStats: Array<{ actionType: string; total: number; decided: number; rejected: number; completed: number; failureRate: number; rejectionRate: number }>
  criticFindings: unknown[]
  topConcerns: string[]
}
export interface SetupStatusEntry {
  actionType: string
  pluginName: string
  status: "configured" | "unconfigured" | string
  hasPolicyRow: boolean
  requiresConfirmation: boolean
}
export interface SetupStatus {
  actionTypes: SetupStatusEntry[]
}

// ---------------------------------------------------------------------------
// Change events — the nervous system. Every panel pulse traces to a real diff.
// ---------------------------------------------------------------------------

export type JarvisEventType = "new-business-event" | "step-completed" | "run-completed" | "new-pending-action" | "action-decided"
type Listener = (detail: unknown) => void
const listeners = new Map<JarvisEventType, Set<Listener>>()

export function onJarvisEvent(type: JarvisEventType, cb: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(cb)
  return () => listeners.get(type)?.delete(cb)
}
function emit(type: JarvisEventType, detail: unknown): void {
  listeners.get(type)?.forEach((cb) => cb(detail))
}

interface FastSnapshot {
  at: number
  pendingIds: Set<string>
  stepStatusById: Map<string, string>
  runStatusById: Map<string, string>
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface JarvisDataState {
  now: number
  mountedAt: number

  stats: StatsResponse | null
  statsDegraded: boolean
  pendingActions: PendingAction[]
  blockedActions: PendingAction[]
  pendingDegraded: boolean
  runs: WorkflowRun[]
  runsDegraded: boolean
  apiLatencyMs: number | null
  /** Last 30 REAL measured fast-lane latencies — the page's always-moving honest chart. */
  latencyHistory: number[]
  /** Per-metric session trend: one real sample per poll, nothing interpolated. */
  metricHistory: Record<string, number[]>

  events: EventRow[]
  eventsDegraded: boolean
  comms: CommsRow[]
  commsDegraded: boolean

  pipelineHealth: PipelineHealth | null
  cashCollections: CashCollections | null
  slaBreaches: SlaBreaches | null
  stockRisk: StockRisk | null
  followUpDebt: FollowUpDebt | null
  technicianLoad: TechnicianLoad | null
  serviceDue: ServiceDue | null
  dataQuality: DataQuality | null
  insights: Insights | null
  readModelsDegraded: boolean

  setupStatus: SetupStatus | null
  setupDegraded: boolean

  newPendingSinceOpen: number
  approvalsThisSession: number
  rejectionsThisSession: number
  recordDecision: (verb: "confirm" | "reject") => void
}

const EMPTY_STATE: JarvisDataState = {
  now: 0,
  mountedAt: 0,
  stats: null,
  statsDegraded: false,
  pendingActions: [],
  blockedActions: [],
  pendingDegraded: false,
  runs: [],
  runsDegraded: false,
  apiLatencyMs: null,
  latencyHistory: [],
  metricHistory: {},
  events: [],
  eventsDegraded: false,
  comms: [],
  commsDegraded: false,
  pipelineHealth: null,
  cashCollections: null,
  slaBreaches: null,
  stockRisk: null,
  followUpDebt: null,
  technicianLoad: null,
  serviceDue: null,
  dataQuality: null,
  insights: null,
  readModelsDegraded: false,
  setupStatus: null,
  setupDegraded: false,
  newPendingSinceOpen: 0,
  approvalsThisSession: 0,
  rejectionsThisSession: 0,
  recordDecision: () => {},
}

const JarvisDataContext = createContext<JarvisDataState>(EMPTY_STATE)

export function useJarvis(): JarvisDataState {
  return useContext(JarvisDataContext)
}

const FAST_LANE_MS = 4000
const MEDIUM_LANE_MS = 8000
const SLOW_LANE_MS = 30000
const SANITY_LANE_MS = 60000
const RING_BUFFER_SIZE = 30

export function JarvisDataProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<JarvisDataState>(EMPTY_STATE)
  const visibleRef = useRef(true)
  const ringRef = useRef<FastSnapshot[]>([])
  const firstPendingIdsRef = useRef<Set<string> | null>(null)
  const sessionRef = useRef({ approvals: 0, rejections: 0 })

  const recordDecision = useCallback((verb: "confirm" | "reject") => {
    if (verb === "confirm") sessionRef.current.approvals += 1
    else sessionRef.current.rejections += 1
    setState((prev) => ({ ...prev, approvalsThisSession: sessionRef.current.approvals, rejectionsThisSession: sessionRef.current.rejections }))
    emit("action-decided", { verb })
  }, [])

  // ---- fast lane ----
  const pollFast = useCallback(async () => {
    if (!visibleRef.current) return
    const started = performance.now()
    const [statsRes, pendingRes, blockedRes, runsRes] = await Promise.allSettled([
      jarvisGet<StatsResponse>("stats"),
      jarvisGet<{ actions: PendingAction[] }>("actions/pending", { filter: "pending" }),
      jarvisGet<{ actions: PendingAction[] }>("actions/pending", { filter: "blocked" }),
      jarvisGet<{ runs: WorkflowRun[] }>("workflows/runs", { status: "running" }),
    ])
    const latency = Math.round(performance.now() - started)
    const nowTs = Date.now()

    const pendingActions = pendingRes.status === "fulfilled" ? pendingRes.value.actions : null
    const runs = runsRes.status === "fulfilled" ? runsRes.value.runs : null

    if (pendingActions) {
      const ids = new Set(pendingActions.map((a) => a.id))
      if (firstPendingIdsRef.current === null) firstPendingIdsRef.current = ids
      const prevSnapshot = ringRef.current[ringRef.current.length - 1]
      if (prevSnapshot) {
        for (const id of ids) {
          if (!prevSnapshot.pendingIds.has(id)) emit("new-pending-action", { id })
        }
      }
    }
    if (runs) {
      const prevSnapshot = ringRef.current[ringRef.current.length - 1]
      const stepStatusById = new Map<string, string>()
      const runStatusById = new Map<string, string>()
      for (const run of runs) {
        runStatusById.set(run.id, run.status)
        for (const step of run.steps) stepStatusById.set(step.id, step.status)
      }
      if (prevSnapshot) {
        for (const [stepId, status] of stepStatusById) {
          if (status === "completed" && prevSnapshot.stepStatusById.get(stepId) !== "completed") {
            emit("step-completed", { stepId })
          }
        }
        for (const [runId, status] of runStatusById) {
          if (status === "completed" && prevSnapshot.runStatusById.get(runId) !== "completed") {
            emit("run-completed", { runId })
          }
        }
      }
      const pendingIds: Set<string> = pendingActions ? new Set(pendingActions.map((a) => a.id)) : new Set()
      ringRef.current = [...ringRef.current, { at: nowTs, pendingIds, stepStatusById, runStatusById }].slice(-RING_BUFFER_SIZE)
    }

    setState((prev) => ({
      ...prev,
      stats: statsRes.status === "fulfilled" ? statsRes.value : prev.stats,
      statsDegraded: statsRes.status === "rejected",
      pendingActions: pendingActions ?? prev.pendingActions,
      blockedActions: blockedRes.status === "fulfilled" ? blockedRes.value.actions : prev.blockedActions,
      pendingDegraded: pendingRes.status === "rejected" || blockedRes.status === "rejected",
      runs: runs ?? prev.runs,
      runsDegraded: runsRes.status === "rejected",
      apiLatencyMs: statsRes.status === "fulfilled" ? latency : prev.apiLatencyMs,
      latencyHistory: statsRes.status === "fulfilled" ? [...prev.latencyHistory, latency].slice(-30) : prev.latencyHistory,
      newPendingSinceOpen: pendingActions && firstPendingIdsRef.current ? Math.max(0, pendingActions.filter((a) => !firstPendingIdsRef.current!.has(a.id)).length) : prev.newPendingSinceOpen,
      metricHistory: {
        ...prev.metricHistory,
        ...(statsRes.status === "fulfilled" ? { pending: [...(prev.metricHistory.pending ?? []), statsRes.value.pending].slice(-40) } : {}),
        ...(runs ? { runs: [...(prev.metricHistory.runs ?? []), runs.length].slice(-40) } : {}),
      },
    }))
    // Poll failures surface as degraded/SIMULATION badges in the UI (§2, §9) — never
    // console.error here, so a kill-the-API pass stays console-clean by construction.
  }, [])

  // ---- medium lane ----
  const prevEventIdsRef = useRef<Set<string>>(new Set())
  const pollMedium = useCallback(async () => {
    if (!visibleRef.current) return
    const [eventsRes, commsRes] = await Promise.allSettled([
      jarvisGet<{ events: EventRow[] }>("events"),
      jarvisGet<{
        outbox: Array<{ id: string; channel: string; toNumber: string; content: string; simulated: boolean; createdAt: string }>
        communications: Array<{ id: string; channel: string; direction: string; content: string; timestamp: string; household: string }>
      }>("comms"),
    ])
    if (eventsRes.status === "fulfilled") {
      const ids = new Set(eventsRes.value.events.map((e) => e.id))
      for (const e of eventsRes.value.events) {
        if (!prevEventIdsRef.current.has(e.id) && prevEventIdsRef.current.size > 0) emit("new-business-event", e)
      }
      prevEventIdsRef.current = ids
    }
    const merged: CommsRow[] | null =
      commsRes.status === "fulfilled"
        ? [
            ...commsRes.value.outbox.map((o) => ({ id: o.id, channel: o.channel, content: o.content, createdAt: o.createdAt, toNumber: o.toNumber, simulated: o.simulated })),
            ...commsRes.value.communications.map((c) => ({ id: c.id, channel: c.channel, content: c.content, createdAt: c.timestamp, direction: c.direction, household: c.household })),
          ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : null
    setState((prev) => ({
      ...prev,
      events: eventsRes.status === "fulfilled" ? eventsRes.value.events : prev.events,
      eventsDegraded: eventsRes.status === "rejected",
      comms: merged ?? prev.comms,
      commsDegraded: commsRes.status === "rejected",
    }))
  }, [])

  // ---- slow lane ----
  const pollSlow = useCallback(async () => {
    if (!visibleRef.current) return
    const [pipeline, cash, sla, stock, followUp, techLoad, serviceDue, dataQuality, insights] = await Promise.allSettled([
      jarvisGet<{ data: PipelineHealth }>("read-models/pipeline-health"),
      jarvisGet<{ data: CashCollections }>("read-models/cash-collections"),
      jarvisGet<{ data: SlaBreaches }>("read-models/sla-breaches"),
      jarvisGet<{ data: StockRisk }>("read-models/stock-risk"),
      jarvisGet<{ data: FollowUpDebt }>("read-models/follow-up-debt"),
      jarvisGet<{ data: TechnicianLoad }>("read-models/technician-load"),
      jarvisGet<{ data: ServiceDue }>("read-models/service-due"),
      jarvisGet<{ data: DataQuality }>("read-models/data-quality"),
      jarvisGet<Insights>("insights"),
    ])
    const anyDegraded = [pipeline, cash, sla, stock, followUp, techLoad, serviceDue, dataQuality].some((r) => r.status === "rejected")
    setState((prev) => ({
      ...prev,
      pipelineHealth: pipeline.status === "fulfilled" ? pipeline.value.data : prev.pipelineHealth,
      cashCollections: cash.status === "fulfilled" ? cash.value.data : prev.cashCollections,
      slaBreaches: sla.status === "fulfilled" ? sla.value.data : prev.slaBreaches,
      stockRisk: stock.status === "fulfilled" ? stock.value.data : prev.stockRisk,
      followUpDebt: followUp.status === "fulfilled" ? followUp.value.data : prev.followUpDebt,
      technicianLoad: techLoad.status === "fulfilled" ? techLoad.value.data : prev.technicianLoad,
      serviceDue: serviceDue.status === "fulfilled" ? serviceDue.value.data : prev.serviceDue,
      dataQuality: dataQuality.status === "fulfilled" ? dataQuality.value.data : prev.dataQuality,
      insights: insights.status === "fulfilled" ? insights.value : prev.insights,
      readModelsDegraded: anyDegraded,
      metricHistory: {
        ...prev.metricHistory,
        ...(cash.status === "fulfilled"
          ? {
              overdueUsd: [...(prev.metricHistory.overdueUsd ?? []), cash.value.data.invoicesByStatus.find((s) => s.status === "overdue")?.totalUsd ?? 0].slice(-40),
              collectedUsd: [...(prev.metricHistory.collectedUsd ?? []), cash.value.data.totalCollected].slice(-40),
            }
          : {}),
        ...(pipeline.status === "fulfilled"
          ? { leadsOpen: [...(prev.metricHistory.leadsOpen ?? []), pipeline.value.data.leadsByStatus.reduce((s, r) => s + r.count, 0)].slice(-40) }
          : {}),
      },
    }))
  }, [])

  // ---- sanity lane ----
  const pollSanity = useCallback(async () => {
    if (!visibleRef.current) return
    const res = await jarvisGet<SetupStatus>("setup/status").catch(() => null)
    setState((prev) => ({ ...prev, setupStatus: res ?? prev.setupStatus, setupDegraded: res === null }))
  }, [])

  useEffect(() => {
    setState((prev) => ({ ...prev, mountedAt: Date.now(), now: Date.now(), recordDecision }))
    const onVisibility = () => {
      const wasHidden = !visibleRef.current
      visibleRef.current = document.visibilityState !== "hidden"
      document.documentElement.setAttribute("data-hidden", (!visibleRef.current).toString())
      if (visibleRef.current && wasHidden) {
        void pollFast()
        void pollMedium()
        void pollSlow()
        void pollSanity()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    void pollFast()
    void pollMedium()
    void pollSlow()
    void pollSanity()

    const tFast = setInterval(pollFast, FAST_LANE_MS)
    const tMedium = setInterval(pollMedium, MEDIUM_LANE_MS)
    const tSlow = setInterval(pollSlow, SLOW_LANE_MS)
    const tSanity = setInterval(pollSanity, SANITY_LANE_MS)
    const tTick = setInterval(() => setState((prev) => ({ ...prev, now: Date.now() })), 1000)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      clearInterval(tFast)
      clearInterval(tMedium)
      clearInterval(tSlow)
      clearInterval(tSanity)
      clearInterval(tTick)
    }
  }, [pollFast, pollMedium, pollSlow, pollSanity, recordDecision])

  return React.createElement(JarvisDataContext.Provider, { value: state }, children)
}

// ---------------------------------------------------------------------------
// Pure derivation helpers — take `now` from context, never their own clock.
// ---------------------------------------------------------------------------

export function ageSeconds(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
}
export function ageMinutes(iso: string, now: number): number {
  return Math.floor(ageSeconds(iso, now) / 60)
}
/** Humane relative age: 42s · 12m · 5h · 3d. */
export function ageLabel(iso: string, now: number): string {
  const s = ageSeconds(iso, now)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
export function runCurrentStep(run: WorkflowRun): WorkflowStep | undefined {
  return run.steps.find((s) => s.status === "leased" || s.status === "pending")
}
export function runProgressPct(run: WorkflowRun): number {
  if (run.steps.length === 0) return 0
  const done = run.steps.filter((s) => s.status === "completed").length
  return Math.round((done / run.steps.length) * 100)
}

/** eventsPerHour[24] etc. — best-effort over the newest-50 event window the API returns. */
export function useEventDerived(events: EventRow[], now: number) {
  return useMemo(() => {
    const hourBuckets = new Array(24).fill(0) as number[]
    const todayStr = new Date(now).toDateString()
    let eventsToday = 0
    let eventsLastHour = 0
    const mixCounts = new Map<string, number>()
    for (const e of events) {
      const d = new Date(e.occurredAt)
      const hour = d.getHours()
      hourBuckets[hour] = (hourBuckets[hour] ?? 0) + 1
      if (d.toDateString() === todayStr) eventsToday += 1
      if (now - d.getTime() <= 3600_000) eventsLastHour += 1
      const family = e.eventType.split("_")[0] ?? e.eventType
      mixCounts.set(family, (mixCounts.get(family) ?? 0) + 1)
    }
    const busiestHourToday = hourBuckets.indexOf(Math.max(...hourBuckets))
    const latest = events[0]
    return {
      eventsPerHour: hourBuckets,
      eventsToday,
      eventsLastHour,
      busiestHourToday,
      latestEventAgeSec: latest ? ageSeconds(latest.occurredAt, now) : null,
      eventMixToday: Object.fromEntries(mixCounts),
    }
  }, [events, now])
}
