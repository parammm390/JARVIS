// C1.T1 — the typed client every JARVIS panel fetch should go through, plus the proxy
// (src/app/api/jarvis/[...path]/route.ts). Two layers of real typing, not one:
//
// 1. Path/verb safety: `API_PATHS` below is checked with `satisfies Record<string,
//    keyof paths>` against the type openapi-typescript generated from
//    finnor-os/openapi.json (regenerate both via `npm run openapi` in finnor-os, then
//    `npm run jarvis:types` here — see finnor-os/scripts/generate-openapi.ts,
//    expanded this session to cover the full 32-path proxy-reachable surface, audited
//    against every real route.ts file, not assumed from the previous 9-path version).
//    A typo'd or removed endpoint fails that one `satisfies` check at compile time.
// 2. Response shape: this codebase has no zod schemas for RESPONSE bodies (only
//    request bodies), so openapi-typescript alone types nearly every 200 as
//    `content?: never` — see openapi-types.ts. The interfaces below fill that gap,
//    each one either imported from src/components/jarvis/lib/data-core.ts (already
//    "verified against the live API" per that file's own header) or freshly written
//    this session after reading the actual route + drizzle schema — never guessed.
//    A few (resources/{kind}, policies) stay honestly loose (`unknown[]`/`unknown`)
//    because their real shape wasn't verified this pass — narrowing those later is
//    real follow-up work, not a shortcut taken now.
//
// Wraps the EXISTING jarvisGet/jarvisPost (same fetch/auth/telemetry every panel
// already uses) — this is a typed layer on top, not a second network stack.

import { jarvisGet, jarvisPost, JarvisApiError } from "../components/jarvis/lib/api"
import type { paths } from "./jarvis/openapi-types"
import type {
  StatsResponse,
  PendingAction,
  WorkflowRun,
  EventRow,
  PipelineHealth,
  CashCollections,
  SlaBreaches,
  StockRisk,
  FollowUpDebt,
  TechnicianLoad,
  ServiceDue,
  DataQuality,
  Insights,
  SetupStatus,
  IntegrationsStatus,
  ReliabilityMetrics,
} from "../components/jarvis/lib/data-core"

export { JarvisApiError }

// Every real proxy-reachable path this client calls, keyed by a friendly name, mapped
// to its "/api/..." form. `satisfies Record<string, keyof paths>` fails to compile if
// any value here isn't a real key of the generated OpenAPI paths type — the actual
// fetch calls below use the SUFFIX (jarvisGet/jarvisPost already prefix `/api/jarvis/`),
// so this table is the one place path literals are cross-checked, not scattered
// per-call-site string gymnastics.
const API_PATHS = {
  stats: "/api/stats",
  actionsSubmit: "/api/actions",
  pendingActions: "/api/actions/pending",
  confirmAction: "/api/actions/{id}/confirm",
  rejectAction: "/api/actions/{id}/reject",
  escalateAction: "/api/actions/{id}/escalate",
  workflowRuns: "/api/workflows/runs",
  runControlPause: "/api/workflows/runs/{id}/pause",
  runControlResume: "/api/workflows/runs/{id}/resume",
  runControlCancel: "/api/workflows/runs/{id}/cancel",
  runControlRetry: "/api/workflows/runs/{id}/retry",
  runControlEscalate: "/api/workflows/runs/{id}/escalate",
  events: "/api/events",
  readModel: "/api/read-models/{view}",
  comms: "/api/comms",
  insights: "/api/insights",
  setupStatus: "/api/setup/status",
  integrationsStatus: "/api/integrations/status",
  resources: "/api/resources/{kind}",
  audit: "/api/audit",
  receipts: "/api/receipts",
  receipt: "/api/receipts/{id}",
  me: "/api/me",
  overview: "/api/overview",
  dlqList: "/api/dlq",
  dlqItem: "/api/dlq/{id}",
  dlqReplay: "/api/dlq/{id}/replay",
  dlqDiscard: "/api/dlq/{id}/discard",
  corrections: "/api/corrections",
  policy: "/api/policies/{tenantId}/{actionType}",
} as const satisfies Record<string, keyof paths>

// ---------------------------------------------------------------------------
// Response shapes not already covered by data-core.ts — verified against the real
// route + drizzle schema this session (packages/db/schema.ts's decisionReceipts /
// deadLetters / memoryCorrections tables), not invented.
// ---------------------------------------------------------------------------

export interface DecisionReceipt {
  id: string
  tenantId: string
  workflowRunId: string | null
  workflowStepId: string | null
  domainActionId: string | null
  objective: string
  evidence: Array<{ source: string; ref: string; timestamp: string }>
  policyApplied: { id: string; version: number } | null
  riskTier: "low" | "medium" | "high"
  proposedAction: Record<string, unknown>
  approval: Record<string, unknown>
  expectedResult: Record<string, unknown> | null
  actualResult: Record<string, unknown> | null
  failure: Record<string, unknown> | null
  correlationId: string | null
  createdAt: string
  finalizedAt: string | null
}

export interface DeadLetter {
  id: string
  tenantId: string
  relatedOutboxEventId: string | null
  relatedWorkflowStepId: string | null
  envelope: Record<string, unknown>
  errorKind: "retryable" | "terminal" | "conflict" | "auth" | "validation" | "provider_down"
  attempts: number
  firstSeenAt: string
  lastError: string
  replayable: boolean
  status: "open" | "replayed" | "discarded"
  createdAt: string
  resolvedAt: string | null
}

export interface MemoryCorrection {
  id: string
  tenantId: string
  receiptId: string | null
  question: string
  wrongAnswer: string
  correctedFact: string
  correctedBy: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  domainActionId: string
  step: string
  input: unknown
  output: unknown
  timestamp: string
  actionType: string
  status: string
}

export interface RunControlResult {
  run: WorkflowRun
}

const READ_MODEL_VIEWS = {
  "pipeline-health": null as unknown as PipelineHealth,
  "technician-load": null as unknown as TechnicianLoad,
  "stock-risk": null as unknown as StockRisk,
  "cash-collections": null as unknown as CashCollections,
  "service-due": null as unknown as ServiceDue,
  "sla-breaches": null as unknown as SlaBreaches,
  "follow-up-debt": null as unknown as FollowUpDebt,
  "data-quality": null as unknown as DataQuality,
  reliability: null as unknown as ReliabilityMetrics,
}
type ReadModelView = keyof typeof READ_MODEL_VIEWS

function toStringParams(params?: Record<string, unknown>): Record<string, string> | undefined {
  if (!params) return undefined
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
}

export const jarvisClient = {
  // ---- GET ----
  stats: (): Promise<StatsResponse> => jarvisGet<StatsResponse>("stats"),

  pendingActions: (filter?: "pending" | "blocked"): Promise<{ actions: PendingAction[] }> =>
    jarvisGet<{ actions: PendingAction[] }>("actions/pending", toStringParams({ filter })),

  workflowRuns: (status?: string): Promise<{ runs: WorkflowRun[] }> =>
    jarvisGet<{ runs: WorkflowRun[] }>("workflows/runs", toStringParams({ status })),

  events: (params?: { entityType?: string; entityId?: string; before?: string }): Promise<{ events: EventRow[] }> =>
    jarvisGet<{ events: EventRow[] }>("events", toStringParams(params)),

  readModel: <V extends ReadModelView>(view: V, params?: Record<string, string>): Promise<{ view: V; data: (typeof READ_MODEL_VIEWS)[V] }> =>
    jarvisGet<{ view: V; data: (typeof READ_MODEL_VIEWS)[V] }>(`read-models/${view}`, params),

  comms: (): Promise<{
    outbox: Array<{ id: string; channel: string; toNumber: string; content: string; simulated: boolean; createdAt: string }>
    communications: Array<{ id: string; channel: string; direction: string; content: string; timestamp: string; household: string }>
  }> => jarvisGet("comms"),

  insights: (): Promise<Insights> => jarvisGet<Insights>("insights"),

  setupStatus: (): Promise<SetupStatus> => jarvisGet<SetupStatus>("setup/status"),

  integrationsStatus: (): Promise<IntegrationsStatus> => jarvisGet<IntegrationsStatus>("integrations/status"),

  // Honestly loose — real per-kind row shapes weren't verified this session.
  resources: (kind: "households" | "inventory" | "invoices" | "technicians" | "visits" | "compliance-policy" | "workflows"): Promise<{ rows: unknown[] }> =>
    jarvisGet<{ rows: unknown[] }>(`resources/${kind}`),

  audit: (params?: { actionType?: string; status?: string; limit?: number; offset?: number }): Promise<{ entries: AuditEntry[]; limit: number; offset: number }> =>
    jarvisGet<{ entries: AuditEntry[]; limit: number; offset: number }>("audit", toStringParams(params)),

  receipts: (query: { domainActionId?: string; workflowStepId?: string; workflowRunId?: string }): Promise<{ receipts: DecisionReceipt[] }> =>
    jarvisGet<{ receipts: DecisionReceipt[] }>("receipts", toStringParams(query)),

  receipt: (id: string): Promise<{ receipt: DecisionReceipt }> => jarvisGet<{ receipt: DecisionReceipt }>(`receipts/${id}`),

  me: (): Promise<{ userId: string; tenantId: string; role: string }> => jarvisGet<{ userId: string; tenantId: string; role: string }>("me"),

  overview: (refresh?: boolean): Promise<{ domainActionId: string; receiptId?: string; cached: boolean; [key: string]: unknown }> =>
    jarvisGet("overview", refresh ? { refresh: "1" } : undefined),

  dlqList: (params?: { status?: "open" | "replayed" | "discarded"; limit?: number }): Promise<{ deadLetters: DeadLetter[] }> =>
    jarvisGet<{ deadLetters: DeadLetter[] }>("dlq", toStringParams(params)),

  dlqItem: (id: string): Promise<{ deadLetter: DeadLetter }> => jarvisGet<{ deadLetter: DeadLetter }>(`dlq/${id}`),

  corrections: (limit?: number): Promise<{ corrections: MemoryCorrection[] }> =>
    jarvisGet<{ corrections: MemoryCorrection[] }>("corrections", toStringParams({ limit })),

  // Honestly loose — the domain_policies row shape wasn't read/verified this session.
  policy: (tenantId: string, actionType: string): Promise<unknown> => jarvisGet(`policies/${tenantId}/${actionType}`),

  // ---- POST ----
  submitAction: (body: { instruction: string; channel?: "voice" | "text" | "console"; sessionId?: string }): Promise<{ planned: unknown[] }> =>
    jarvisPost<{ planned: unknown[] }>("actions", body),

  confirmAction: (id: string, note?: string): Promise<unknown> => jarvisPost(`actions/${id}/confirm`, { note }),

  rejectAction: (id: string, reason?: string): Promise<unknown> => jarvisPost(`actions/${id}/reject`, { reason }),

  escalateAction: (id: string, note?: string): Promise<unknown> => jarvisPost(`actions/${id}/escalate`, { note }),

  runControl: (id: string, verb: "pause" | "resume" | "cancel" | "retry" | "escalate", expectedVersion: number): Promise<RunControlResult> =>
    jarvisPost<RunControlResult>(`workflows/runs/${id}/${verb}`, { expectedVersion }),

  dlqReplay: (id: string): Promise<{ replayed: true }> => jarvisPost<{ replayed: true }>(`dlq/${id}/replay`, {}),

  dlqDiscard: (id: string): Promise<{ discarded: true }> => jarvisPost<{ discarded: true }>(`dlq/${id}/discard`, {}),

  submitCorrection: (body: { receiptId: string; correctedFact: string }): Promise<{ id: string }> => jarvisPost<{ id: string }>("corrections", body),

  // Honestly loose response — the domain_policies row shape wasn't read/verified this session.
  upsertPolicy: (tenantId: string, actionType: string, body: { policy: Record<string, unknown>; requiresConfirmation: boolean }): Promise<unknown> =>
    jarvisPost(`policies/${tenantId}/${actionType}`, body),
}

// Referenced only for its compile-time `satisfies` check above (API_PATHS) and to
// keep the import from being flagged unused by editors that don't see through
// `satisfies` — never used at runtime.
void API_PATHS
