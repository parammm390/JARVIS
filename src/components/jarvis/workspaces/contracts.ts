import type { InstructionState } from "../kernel/types"

export type WorkspaceKind =
  | "customer"
  | "customer-cohort"
  | "schedule"
  | "money"
  | "research"
  | "plan"
  | "campaign"
  | "execution"
  | "receipt"
  | "recovery"

export type OperationalQueryIntent =
  | "customer_lookup"
  | "customer_cohort"
  | "schedule_range"
  | "money_summary"
  | "work_list"
  | "inventory_status"
  | "agent_activity"
  | "business_state"
  | "company_context"

export interface QueryPageInfo {
  limit: number
  returned: number
  totalCount: number | null
  totalCountExact: boolean
  hasMore: boolean
  nextCursor: string | null
  truncated: boolean
}

export interface QuerySource {
  kind: "canonical_postgres"
  tables: string[]
}

export interface QueryResultBase {
  kind: "operational_query_result"
  version: 1
  intent: OperationalQueryIntent
  status: "ok" | "ambiguous" | "not_found"
  source: QuerySource
  asOf: string
  count: number
  truncated: boolean
  page: QueryPageInfo
  data: Record<string, unknown>
}

export interface CustomerLookupRow {
  householdId: string
  displayName: string | null
  address: string
  contacts: Array<{
    id: string
    name: string
    role: string | null
    methods: Array<{ methodType: string; value: string }>
  }>
  matchedBy: string[]
  createdAt: string
}

export interface CustomerLookupResult extends QueryResultBase {
  intent: "customer_lookup"
  resolution: "exact" | "unique" | "ambiguous" | "not_found"
  rows: CustomerLookupRow[]
}

export interface CustomerCohortRow {
  householdId: string
  displayName: string | null
  address: string
  lastInteractionAt: string | null
  qualifiesBecause: "never_active" | "before_cutoff"
}

export interface CustomerCohortResult extends QueryResultBase {
  intent: "customer_cohort"
  cohort: "inactive"
  minDaysInactive: number
  cutoff: string
  rows: CustomerCohortRow[]
}

export interface ScheduleRow {
  kind: "appointment" | "service_visit" | "work_order"
  id: string
  scheduledAt: string
  status: string
  technician: { id: string; name: string } | null
  household: { id: string; displayName: string | null; address: string } | null
  subjectType?: string
  durationMinutes?: number | null
}

export interface ScheduleRangeResult extends QueryResultBase {
  intent: "schedule_range"
  range: { start: string; end: string }
  timeZone: string
  localDateRange?: { startDate: string; endDate?: string }
  rows: ScheduleRow[]
}

export interface MoneyStatusSummary {
  status: string
  count: number
  totalUsd: number
}

export interface MoneySummaryResult extends QueryResultBase {
  intent: "money_summary"
  range: { start: string; end: string } | null
  paymentLinksAwaitingPayment: number | null
  invoices: MoneyStatusSummary[]
  collections: MoneyStatusSummary[]
  totals: { invoicedUsd: number; collectedUsd: number; pendingCollectionUsd: number }
}

export interface WorkListResult extends QueryResultBase {
  intent: "work_list"
  works: Array<{ id: string; status: string; channel: string; sessionId: string | null; createdAt: string; updatedAt: string }>
  workOrders: Array<{ id: string; household: { id: string; displayName: string | null; address: string } | null; technician: { id: string; name: string } | null; type: string; status: string; scheduledAt: string | null; createdAt: string }>
  tasks: Array<{ id: string; subjectType: string; subjectId: string; title: string; dueAt: string | null; assigneeType: string | null; assigneeId: string | null; status: string; priority: string; createdAt: string }>
}

export interface InventoryStatusResult extends QueryResultBase {
  intent: "inventory_status"
  items: Array<{ id: string; sku: string; name: string; quantity: number; reorderThreshold: number; unitCostUsd: number | null; lowStock: boolean }>
  warehouseStock: Array<{ id: string; warehouseId: string; warehouseName: string | null; sku: string; quantity: number; reorderThreshold: number; unitOfMeasure: string; lowStock: boolean }>
  openProcurement: Array<{ id: string; warehouseId: string; warehouseName: string | null; sku: string; quantityOrdered: number; status: string; expectedAt: string | null; createdAt: string }>
}

export interface AgentActivityResult extends QueryResultBase {
  intent: "agent_activity"
  range: { start: string; end: string }
  timeZone: string
  users: Array<{ id: string; email: string; role: string; createdAt: string }>
  technicians: Array<{ id: string; name: string }>
  actions: Array<{ id: string; actionType: string; status: string; step: string | null; occurredAt: string }>
  workflows: Array<{ id: string; workflowType: string; status: string; occurredAt: string }>
  calls: Array<{ id: string; conversationId: string | null; direction: string; startedAt: string | null; endedAt: string | null; endedReason: string | null; occurredAt: string }>
}

export interface BusinessStateResult extends QueryResultBase {
  intent: "business_state"
  pipeline: Record<string, Array<{ status: string; count: number }>>
  operations: Record<string, Array<{ status: string; count: number }> | number>
}

export interface CompanyContextResult extends QueryResultBase {
  intent: "company_context"
  resolution: "exact" | "unique" | "ambiguous" | "not_found"
  context: null | {
    anchor: { entityType: string; entityId: string }
    household: { id: string; displayName: string | null; address: string }
    nodes: Array<{ entityType: string; entityId: string; label: string | null; status: string | null; occurredAt: string | null }>
    relationships: Array<{ from: { entityType: string; entityId: string }; relationship: string; to: { entityType: string; entityId: string }; source: { table: string; column: string } }>
    truncated: boolean
  }
}

export type OperationalQueryResult =
  | CustomerLookupResult
  | CustomerCohortResult
  | ScheduleRangeResult
  | MoneySummaryResult
  | WorkListResult
  | InventoryStatusResult
  | AgentActivityResult
  | BusinessStateResult
  | CompanyContextResult

export interface OperationalQueryExecution {
  request: { intent: OperationalQueryIntent; [key: string]: unknown }
  result: OperationalQueryResult
  metadata: {
    queryId: string
    source: string
    durationMs: number
    startedAt: string
    completedAt: string
    timeZone?: string
  }
}

export interface WorkspaceAction {
  id: string
  actionType: string
  targetLabel: string | null
  amountUsd: number | null
  payload: Record<string, unknown>
  reasoning?: string
  dependsOn?: string[] | null
  policyVersion: number | null
}

export interface WorkspaceAnswer {
  spokenSummary: string
  displaySummary?: string
  facts?: Array<{ label: string; value: string; source?: string }>
  evidence?: Array<{ source: string; ref: string; timestamp?: string; title?: string }>
  query?: OperationalQueryExecution
}

export interface WorkspaceProjection {
  key: string
  kind: WorkspaceKind
  title: string
  eyebrow: string
  description: string
  state: InstructionState
  workId: string | null
  instructionId: string | null
  instruction: string
  updatedAtMs: number
  actions: WorkspaceAction[]
  answer?: WorkspaceAnswer | null
  query?: OperationalQueryExecution | null
  persisted?: boolean
}

export function isOperationalQueryExecution(value: unknown): value is OperationalQueryExecution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const execution = value as Record<string, unknown>
  if (!execution.request || typeof execution.request !== "object" || Array.isArray(execution.request)) return false
  if (!execution.result || typeof execution.result !== "object" || Array.isArray(execution.result)) return false
  if (!execution.metadata || typeof execution.metadata !== "object" || Array.isArray(execution.metadata)) return false
  const result = execution.result as Record<string, unknown>
  const metadata = execution.metadata as Record<string, unknown>
  return result.kind === "operational_query_result"
    && result.version === 1
    && typeof result.intent === "string"
    && typeof result.asOf === "string"
    && typeof metadata.queryId === "string"
}
