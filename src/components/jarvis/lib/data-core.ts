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
import { jarvisGet, JarvisApiError } from "./api"
import { hasActiveSession } from "./jarvis-auth"

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
/** Phase 7 (§7.1): the most recent DecisionReceipt for a pending action, embedded by
 *  GET actions/pending so the Approval Inbox card can render objective/evidence/
 *  policy/risk-tier without a second round trip. Full detail (expected vs actual,
 *  failure, approval) lives behind the "Why?" drawer's own GET receipts/:id call. */
export interface ReceiptSummary {
  id: string
  domainActionId: string | null
  objective: string
  evidence: Array<{ source: string; ref: string; timestamp: string }>
  policyApplied: { id: string; version: number } | null
  riskTier: "low" | "medium" | "high"
  createdAt: string
}
/** D2.T1 — async second-pass verdict from the critic (packages/orchestration/src/
 *  critic.ts). Genuinely null whenever no critic_review has run yet (no AWS Bedrock
 *  key configured today per the credentials ledger) — never a fabricated "pending"
 *  state; the cockpit renders nothing when this is null. */
export interface CriticVerdict {
  flagged: boolean
  reason: string
}
/** D2.T1 — price-book provenance: any {sku, price} pair found in the payload,
 *  compared against this tenant's real price_book_items row for that sku.
 *  `matches` is null when the payload carried a sku but no price to compare. */
export interface PriceBookProvenanceEntry {
  sku: string
  label: string
  priceBookPriceUsd: number
  payloadPriceUsd: number | null
  matches: boolean | null
}
export interface PendingAction {
  id: string
  actionType: string
  summary: string | null
  payload: unknown
  status: string
  createdAt: string
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>
  receipt?: ReceiptSummary | null
  critic?: CriticVerdict | null
  priceBookProvenance?: PriceBookProvenanceEntry[]
  /** jarvis-v3 P4.T1/T2: the plugin's own simulate() prediction (§6⑤'s "predicted
   *  outcome from simulate()"), normalized server-side from predictedReceipt.
   *  Optional/null when no real simulate() ran for this action type — never a
   *  fabricated prediction; the card renders nothing in that case (§0.2 rule 3). */
  predicted?: Record<string, unknown> | null
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
  /** Optimistic-concurrency counter (Phase 7 §7.2 run controls key their UPDATE on
   *  the version they last read here). */
  version: number
  createdAt: string
  updatedAt: string
  /** Same threshold as the A4 watchdog scan; computed by GET workflows/runs. */
  watchdogFlagged?: boolean
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
export interface UnclearConfirmation {
  transcript: string
  at: string
}
export interface Insights {
  actionTypeStats: Array<{ actionType: string; total: number; decided: number; rejected: number; completed: number; failureRate: number; rejectionRate: number }>
  criticFindings: unknown[]
  topConcerns: string[]
  /** Phase 14: real caller phrasings that failed to parse as yes/no, redacted, from
   *  sessions whose confirmation eventually resolved — self-cleans once a phrase is
   *  added to policy. Optional: older API deploys won't carry this field yet. */
  unclearConfirmations?: UnclearConfirmation[]
  /** F5.T2 (B3, not yet shipped): a forecast confidence band per read-model series.
   *  Optional: no real API deploy returns this yet. `lib/charts.tsx`'s ForecastBand
   *  (FLOW-86) is wired against this field now (graceful-absent — renders nothing
   *  while it stays undefined) so it lights up the moment B3 ships it; never
   *  fetched or fabricated here. */
  forecastBand?: Array<{ lo: number; hi: number }>
  /** Same B3-not-shipped-yet contract as forecastBand above — AnomalyFlare
   *  (FLOW-87) wires against this field, graceful-absent. */
  anomalies?: Array<{ index: number; label: string }>
}
export interface SetupStatusEntry {
  actionType: string
  pluginName: string
  status: "configured" | "unconfigured" | string
  hasPolicyRow: boolean
  requiresConfirmation: boolean
}
export interface PhoneRoutingNumber {
  phoneNumber: string
  vapiPhoneNumberId: string | null
  label: string | null
}
/** Phase 16(c): a deploy's config posture, verifiable from this one endpoint instead
 *  of grepping platform env-var UIs. Optional: older API deploys won't carry it yet. */
export interface EnvironmentStatus {
  nodeEnv: string
  secretProvider: { provider: "env" | "aws-secrets-manager"; loaded: boolean; loadedAt: string | null }
  bindings: {
    scheduling: string
    communications: string
    documents: string
    esign: string
    inventory: string
    accounting: string
    payments: string
    crm: string
    marketing: string
  }
}
export interface SetupStatus {
  actionTypes: SetupStatusEntry[]
  /** Phase 14: whether this tenant has a registered Vapi line for tenant-by-phone
   *  routing. Optional: older API deploys won't carry this field yet. */
  phoneRouting?: { configured: boolean; numbers: PhoneRoutingNumber[] }
  environment?: EnvironmentStatus
}
export interface ProviderHealth {
  configured: boolean
  /** null = not configured, so never actually tested against the real API. */
  healthy: boolean | null
  error?: string
}
/** Phase 15: real self-tests for every external integration (not just presence),
 *  from GET /api/integrations/status — includes the two new Phase 15 providers
 *  (Stripe, DocuSign) plus which binding is actually wired to serve each capability. */
/** Phase 6: ops-grade reliability numbers from GET /api/read-models/reliability —
 *  real success rate / latency / retry / DLQ backlog, never a fabricated 0 for an
 *  empty denominator (null instead). Polled on the slow lane alongside the other
 *  read-models, same pattern as PipelineHealth etc. */
export interface ReliabilityMetrics {
  tenantId: string
  windowDays: number
  workflowSuccessRate: number | null
  stepLatencyMs: { p50: number | null; p95: number | null; sampleSize: number }
  retryRate: number | null
  humanInterventionRate: number | null
  reconciliationBacklog: number
  dlqDepth: number
  receiptCompleteness: number | null
  asOf: string
}

export interface IntegrationsStatus {
  meta_ads: ProviderHealth
  google_ads: ProviderHealth
  quickbooks: ProviderHealth
  vapi: ProviderHealth
  ghl: ProviderHealth
  stripe: ProviderHealth
  docusign: ProviderHealth
  bindings: { payments: "stripe" | "emulator"; esign: "docusign" | "emulator" }
  summary: { configuredCount: number; healthyCount: number; unhealthyCount: number }
}

// ---------------------------------------------------------------------------
// Change events — the nervous system. Every panel pulse traces to a real diff.
// ---------------------------------------------------------------------------

export type JarvisEventType = "new-business-event" | "step-completed" | "run-completed" | "new-pending-action" | "action-decided" | "poll-landed"
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
  /** Latest 20 REAL terminal runs (completed/failed) — fuel for the honest replay theater. */
  terminalRuns: WorkflowRun[]
  lastPollAtMs: number | null
  /** F6.T2 — FLOW-92 StaleFog's real lane timestamp: the wall-clock moment the slow
   *  lane (read-models) last had ANY successful fetch, not merely "not currently
   *  rejected." A panel can be showing 90s-old numbers while readModelsDegraded is
   *  false the whole time (a fetch simply hasn't landed yet) — this is the honest
   *  signal staleness needs, distinct from the degraded booleans above. */
  slowLastSuccessMs: number | null
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
  reliability: ReliabilityMetrics | null

  setupStatus: SetupStatus | null
  setupDegraded: boolean
  integrationsStatus: IntegrationsStatus | null
  integrationsDegraded: boolean

  /** P1.T9 / C-15: non-null once the server refused our credentials on a private
   *  lane. Every lane stops; `kernel/selectors.ts` turns this into `Truth.denied`
   *  so the veil that appears is the real reason, not a zero. */
  accessDenied: DeniedReason | null
  newPendingSinceOpen: number
  approvalsThisSession: number
  rejectionsThisSession: number
  recordDecision: (verb: "confirm" | "reject" | "escalate") => void
  /** Phase 7 (§7.5, command bar): prepend freshly-planned actions into the
   *  Approval Inbox immediately, before the next poll confirms them. Best-effort —
   *  an action that turns out to have auto-run (ungated) rather than land as a
   *  real pending row simply drops out on the next fast-lane poll (≤4s later),
   *  which always replaces this list with the server's actual truth. Never a
   *  lasting inconsistency, just a brief optimistic guess. */
  injectOptimisticPending: (actions: PendingAction[]) => void
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
  terminalRuns: [],
  lastPollAtMs: null,
  slowLastSuccessMs: null,
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
  reliability: null,
  setupStatus: null,
  setupDegraded: false,
  integrationsStatus: null,
  integrationsDegraded: false,
  accessDenied: null,
  newPendingSinceOpen: 0,
  approvalsThisSession: 0,
  rejectionsThisSession: 0,
  recordDecision: () => {},
  injectOptimisticPending: () => {},
}

const JarvisDataContext = createContext<JarvisDataState>(EMPTY_STATE)

export function useJarvis(): JarvisDataState {
  return useContext(JarvisDataContext)
}

const FAST_LANE_MS = 4000
const MEDIUM_LANE_MS = 8000
const SLOW_LANE_MS = 30000
const SANITY_LANE_MS = 60000

/** Each lane's own cadence — the delay used whenever the lane is healthy. */
const LANE_BASE_MS: Record<LaneName, number> = {
  fast: FAST_LANE_MS,
  medium: MEDIUM_LANE_MS,
  slow: SLOW_LANE_MS,
  sanity: SANITY_LANE_MS,
}

/** F6.T2 — FLOW-92 StaleFog's lane SLA: 3x the slow lane's own poll interval, the
 *  same "generous slack before calling it stale" ratio PulseBar's own
 *  HEARTBEAT_STALE_S already established for the fast/heartbeat lane (2-3x cadence,
 *  never the raw interval itself — a single slow poll shouldn't flash a false alarm). */
export const SLOW_LANE_STALE_MS = SLOW_LANE_MS * 3

export function laneAgeMs(lastSuccessMs: number | null, now: number): number | null {
  if (lastSuccessMs === null) return null
  return now - lastSuccessMs
}

// ---------------------------------------------------------------------------
// Plan v3 P1.T9 — defect C-15: the signed-out 401 storm.
//
// Every lane above used to fire on a fixed interval regardless of whether anyone
// was signed in. Signed out that is 21 requests per full cycle, all 401, forever —
// roughly 90 req/min measured against production. Three rules fix it:
//
//   1. A private lane does not run at all without a session.
//   2. A 401/403 STOPS its lane and records why. We were told no; asking again
//      four seconds later is not going to change the answer.
//   3. A 5xx or a network fault backs the lane off 4 -> 8 -> 16 -> 32 -> 60 s,
//      resetting on the next success.
//
// The two helpers below are pure so the ladder and the classification are directly
// unit-testable without a browser.
// ---------------------------------------------------------------------------

export type DeniedReason = "signed-out" | "role"

export type LaneName = "fast" | "medium" | "slow" | "sanity"

/** The backoff ladder, exactly as specified: 4 -> 8 -> 16 -> 32 -> 60 s. */
export const BACKOFF_LADDER_MS = [4_000, 8_000, 16_000, 32_000, 60_000] as const

/** Delay before the next attempt after `consecutiveFailures` failures in a row.
 *  0 failures means "no backoff — use the lane's own interval". Saturates at 60 s. */
export function nextBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0
  const i = Math.min(consecutiveFailures, BACKOFF_LADDER_MS.length) - 1
  return BACKOFF_LADDER_MS[i]
}

export interface LaneOutcome {
  /** Non-null when the server refused our credentials. The lane must stop. */
  denied: DeniedReason | null
  /** A 5xx, a timeout or a network fault — retry, but slower each time. */
  transientFailure: boolean
}

/** Classify a lane's settled results into "stop" vs "slow down" vs "fine". */
export function classifyLaneOutcome(results: PromiseSettledResult<unknown>[]): LaneOutcome {
  let denied: DeniedReason | null = null
  let transientFailure = false
  for (const r of results) {
    if (r.status !== "rejected") continue
    const err: unknown = r.reason
    const status = err instanceof JarvisApiError ? err.status : 0
    if (status === 401) denied = denied ?? "signed-out"
    else if (status === 403) denied = denied ?? "role"
    else transientFailure = true
  }
  return { denied, transientFailure }
}
const RING_BUFFER_SIZE = 30

export function JarvisDataProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<JarvisDataState>(EMPTY_STATE)
  const visibleRef = useRef(true)
  const ringRef = useRef<FastSnapshot[]>([])
  const firstPendingIdsRef = useRef<Set<string> | null>(null)
  const sessionRef = useRef({ approvals: 0, rejections: 0 })

  const recordDecision = useCallback((verb: "confirm" | "reject" | "escalate") => {
    // Escalate leaves the action open for a human (needs_human_review, not
    // terminal) — it doesn't count toward the approve/reject session tally, but
    // still emits the event so other panels can react to it honestly.
    if (verb === "confirm") sessionRef.current.approvals += 1
    else if (verb === "reject") sessionRef.current.rejections += 1
    setState((prev) => ({ ...prev, approvalsThisSession: sessionRef.current.approvals, rejectionsThisSession: sessionRef.current.rejections }))
    emit("action-decided", { verb })
  }, [])

  const injectOptimisticPending = useCallback((actions: PendingAction[]) => {
    if (actions.length === 0) return
    setState((prev) => {
      const existingIds = new Set(prev.pendingActions.map((a) => a.id))
      const fresh = actions.filter((a) => !existingIds.has(a.id))
      if (fresh.length === 0) return prev
      return { ...prev, pendingActions: [...fresh, ...prev.pendingActions] }
    })
    emit("new-pending-action", { count: actions.length, source: "command-bar" })
  }, [])

  // ---- P1.T9 / C-15: lane health ----
  // `denied` stops every lane until the session changes. `failures` drives the
  // per-lane backoff ladder. Both live in refs, not state: they steer the scheduler
  // and must not themselves cause a render.
  const deniedRef = useRef<DeniedReason | null>(null)
  const failuresRef = useRef<Record<LaneName, number>>({ fast: 0, medium: 0, slow: 0, sanity: 0 })

  const noteLaneOutcome = useCallback((lane: LaneName, results: PromiseSettledResult<unknown>[]) => {
    const { denied, transientFailure } = classifyLaneOutcome(results)
    if (denied) {
      // Being told "no" is not a transient fault and must not be retried on a
      // ladder. Stop everything and record the real reason once.
      if (deniedRef.current !== denied) {
        deniedRef.current = denied
        setState((prev) => (prev.accessDenied === denied ? prev : { ...prev, accessDenied: denied }))
      }
      return
    }
    failuresRef.current[lane] = transientFailure ? failuresRef.current[lane] + 1 : 0
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
    noteLaneOutcome("fast", [statsRes, pendingRes, blockedRes, runsRes])
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
      lastPollAtMs: statsRes.status === "fulfilled" ? nowTs : prev.lastPollAtMs,
      apiLatencyMs: statsRes.status === "fulfilled" ? latency : prev.apiLatencyMs,
      latencyHistory: statsRes.status === "fulfilled" ? [...prev.latencyHistory, latency].slice(-30) : prev.latencyHistory,
      newPendingSinceOpen: pendingActions && firstPendingIdsRef.current ? Math.max(0, pendingActions.filter((a) => !firstPendingIdsRef.current!.has(a.id)).length) : prev.newPendingSinceOpen,
      metricHistory: {
        ...prev.metricHistory,
        ...(statsRes.status === "fulfilled" ? { pending: [...(prev.metricHistory.pending ?? []), statsRes.value.pending].slice(-40) } : {}),
        ...(runs ? { runs: [...(prev.metricHistory.runs ?? []), runs.length].slice(-40) } : {}),
      },
    }))
    if (statsRes.status === "fulfilled") emit("poll-landed", { latency })
    // Poll failures surface as degraded/SIMULATION badges in the UI (§2, §9) — never
    // console.error here, so a kill-the-API pass stays console-clean by construction.
  }, [noteLaneOutcome])

  // ---- medium lane ----
  const prevEventIdsRef = useRef<Set<string>>(new Set())
  const pollMedium = useCallback(async () => {
    if (!visibleRef.current) return
    const [eventsRes, commsRes, allRunsRes] = await Promise.allSettled([
      jarvisGet<{ events: EventRow[] }>("events"),
      jarvisGet<{
        outbox: Array<{ id: string; channel: string; toNumber: string; content: string; simulated: boolean; createdAt: string }>
        communications: Array<{ id: string; channel: string; direction: string; content: string; timestamp: string; household: string }>
      }>("comms"),
      jarvisGet<{ runs: WorkflowRun[] }>("workflows/runs"),
    ])
    noteLaneOutcome("medium", [eventsRes, commsRes, allRunsRes])
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
      terminalRuns:
        allRunsRes.status === "fulfilled"
          ? allRunsRes.value.runs.filter((r) => r.status === "completed" || r.status === "failed" || r.status === "compensated")
          : prev.terminalRuns,
    }))
  }, [noteLaneOutcome])

  // ---- slow lane ----
  const pollSlow = useCallback(async () => {
    if (!visibleRef.current) return
    // Read models are independent, but firing all ten at once alongside the fast,
    // medium, and sanity lanes creates a 19-request mount burst. That can exhaust
    // the production session pool before the UI has rendered. Keep a small batch
    // width: the screen still refreshes every slow-lane cycle, while the API has
    // room for approvals and instruction planning.
    const [pipeline, cash] = await Promise.allSettled([
      jarvisGet<{ data: PipelineHealth }>("read-models/pipeline-health"),
      jarvisGet<{ data: CashCollections }>("read-models/cash-collections"),
    ])
    const [sla, stock] = await Promise.allSettled([
      jarvisGet<{ data: SlaBreaches }>("read-models/sla-breaches"),
      jarvisGet<{ data: StockRisk }>("read-models/stock-risk"),
    ])
    const [followUp, techLoad] = await Promise.allSettled([
      jarvisGet<{ data: FollowUpDebt }>("read-models/follow-up-debt"),
      jarvisGet<{ data: TechnicianLoad }>("read-models/technician-load"),
    ])
    const [serviceDue, dataQuality] = await Promise.allSettled([
      jarvisGet<{ data: ServiceDue }>("read-models/service-due"),
      jarvisGet<{ data: DataQuality }>("read-models/data-quality"),
    ])
    const [insights, reliability] = await Promise.allSettled([
      jarvisGet<Insights>("insights"),
      jarvisGet<{ data: ReliabilityMetrics }>("read-models/reliability"),
    ])
    noteLaneOutcome("slow", [pipeline, cash, sla, stock, followUp, techLoad, serviceDue, dataQuality, insights, reliability])
    const anyDegraded = [pipeline, cash, sla, stock, followUp, techLoad, serviceDue, dataQuality].some((r) => r.status === "rejected")
    const anySucceeded = [pipeline, cash, sla, stock, followUp, techLoad, serviceDue, dataQuality].some((r) => r.status === "fulfilled")
    const nowTs = Date.now()
    setState((prev) => ({
      ...prev,
      slowLastSuccessMs: anySucceeded ? nowTs : prev.slowLastSuccessMs,
      pipelineHealth: pipeline.status === "fulfilled" ? pipeline.value.data : prev.pipelineHealth,
      cashCollections: cash.status === "fulfilled" ? cash.value.data : prev.cashCollections,
      slaBreaches: sla.status === "fulfilled" ? sla.value.data : prev.slaBreaches,
      stockRisk: stock.status === "fulfilled" ? stock.value.data : prev.stockRisk,
      followUpDebt: followUp.status === "fulfilled" ? followUp.value.data : prev.followUpDebt,
      technicianLoad: techLoad.status === "fulfilled" ? techLoad.value.data : prev.technicianLoad,
      serviceDue: serviceDue.status === "fulfilled" ? serviceDue.value.data : prev.serviceDue,
      dataQuality: dataQuality.status === "fulfilled" ? dataQuality.value.data : prev.dataQuality,
      insights: insights.status === "fulfilled" ? insights.value : prev.insights,
      reliability: reliability.status === "fulfilled" ? reliability.value.data : prev.reliability,
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
  }, [noteLaneOutcome])

  // ---- sanity lane ----
  const pollSanity = useCallback(async () => {
    if (!visibleRef.current) return
    // P1.T9: `allSettled` rather than `.catch(() => null)` — swallowing the error
    // threw away the status code, which is the one thing needed to tell "we were
    // refused" (stop) from "it broke" (back off).
    const [setupRes, integrationsRes] = await Promise.allSettled([
      jarvisGet<SetupStatus>("setup/status"),
      jarvisGet<IntegrationsStatus>("integrations/status"),
    ])
    noteLaneOutcome("sanity", [setupRes, integrationsRes])
    const res = setupRes.status === "fulfilled" ? setupRes.value : null
    const integrations = integrationsRes.status === "fulfilled" ? integrationsRes.value : null
    setState((prev) => ({
      ...prev,
      setupStatus: res ?? prev.setupStatus,
      setupDegraded: res === null,
      integrationsStatus: integrations ?? prev.integrationsStatus,
      integrationsDegraded: integrations === null,
    }))
  }, [noteLaneOutcome])

  useEffect(() => {
    setState((prev) => ({ ...prev, mountedAt: Date.now(), now: Date.now(), recordDecision, injectOptimisticPending }))
    const onVisibility = () => {
      const wasHidden = !visibleRef.current
      visibleRef.current = document.visibilityState !== "hidden"
      document.documentElement.setAttribute("data-hidden", (!visibleRef.current).toString())
      // P1.T9: returning to the tab must not resurrect a refused or signed-out
      // lane — that was one of the ways the 401 storm restarted itself.
      if (visibleRef.current && wasHidden && hasActiveSession() && !deniedRef.current) {
        void pollFast()
        void pollMedium()
        void pollSlow()
        void pollSanity()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    // P1.T9 / C-15 — the scheduler. Every lane reschedules itself rather than
    // running on a fixed interval, because "when do we ask again" now depends on
    // what happened last time:
    //   - no session          -> do not ask at all; re-check at the lane's interval
    //   - denied (401/403)    -> stop this lane permanently until the session changes
    //   - transient failure   -> BACKOFF_LADDER_MS[n]: 4 -> 8 -> 16 -> 32 -> 60 s
    //   - success             -> reset to the lane's own interval
    const timers = new Map<LaneName, number>()
    let stopped = false

    const runLane = (lane: LaneName, poll: () => Promise<void>) => {
      if (stopped) return
      const base = LANE_BASE_MS[lane]

      // Rule 1: a private lane never runs without a session. This alone takes the
      // signed-out page from ~90 requests/min to zero.
      if (!hasActiveSession()) {
        timers.set(lane, window.setTimeout(() => runLane(lane, poll), base))
        return
      }

      // Rule 2: we were refused. Asking again on a timer cannot change the answer.
      if (deniedRef.current) return

      void poll().finally(() => {
        if (stopped || deniedRef.current) return
        // Rule 3: back off on transient faults, reset on success.
        const delay = nextBackoffMs(failuresRef.current[lane]) || base
        timers.set(lane, window.setTimeout(() => runLane(lane, poll), delay))
      })
    }

    // Avoid mounting all four lanes simultaneously. Fast data makes the cockpit
    // useful first; the lower-priority lanes follow without a connection spike.
    runLane("fast", pollFast)
    runLane("medium", pollMedium)
    runLane("slow", pollSlow)
    runLane("sanity", pollSanity)

    // When a session appears (or is replaced), clear the refusal and restart every
    // lane immediately — a fresh token deserves a fresh answer, and waiting a full
    // interval after sign-in would be a visible dead patch.
    let hadSession = hasActiveSession()
    const tSession = window.setInterval(() => {
      const has = hasActiveSession()
      if (has === hadSession) return
      hadSession = has
      if (!has) return
      deniedRef.current = null
      failuresRef.current = { fast: 0, medium: 0, slow: 0, sanity: 0 }
      setState((prev) => (prev.accessDenied === null ? prev : { ...prev, accessDenied: null }))
      for (const [, id] of timers) window.clearTimeout(id)
      timers.clear()
      runLane("fast", pollFast)
      runLane("medium", pollMedium)
      runLane("slow", pollSlow)
      runLane("sanity", pollSanity)
    }, 1000)

    const tTick = setInterval(() => setState((prev) => ({ ...prev, now: Date.now() })), 1000)

    return () => {
      stopped = true
      document.removeEventListener("visibilitychange", onVisibility)
      for (const [, id] of timers) window.clearTimeout(id)
      timers.clear()
      window.clearInterval(tSession)
      clearInterval(tTick)
    }
  }, [pollFast, pollMedium, pollSlow, pollSanity, recordDecision, injectOptimisticPending])

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
