"use client"

import { Metric } from "../lib/Metric"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { mapTruth, selectCollectedUsd, selectOpenLeads, selectOverdueInvoices, selectPendingApprovals, selectRunsInFlight, selectStuckRuns } from "../kernel/selectors"
import type { Truth } from "../kernel/types"
import { useSelectorInput } from "../kernel/useSelectorInput"
import type { ExperienceMetricKey, ExperienceRole } from "../lib/workspace-config"
import { useJarvisAuth } from "../lib/jarvis-auth"

type MetricDefinition = {
  label: string
  roles: ReadonlySet<ExperienceRole>
  format?: (value: number) => string
}

const usd = (value: number) => `$${Math.round(value).toLocaleString()}`

/** One allowlisted registry for every manifest-addressable metric. Values are
 * still produced by existing selectors/read models and always retain Truth state. */
export const EXPERIENCE_METRIC_REGISTRY: Record<ExperienceMetricKey, MetricDefinition> = {
  pending_approvals: { label: "Awaiting approval", roles: new Set(["owner", "dispatcher"]) },
  collected_usd: { label: "Collected", roles: new Set(["owner"]), format: usd },
  overdue_invoice_value: { label: "Overdue", roles: new Set(["owner"]), format: usd },
  open_leads: { label: "Open leads", roles: new Set(["owner"]) },
  runs_in_flight: { label: "Runs in flight", roles: new Set(["owner", "dispatcher"]) },
  stuck_runs: { label: "Stuck runs", roles: new Set(["owner", "dispatcher"]) },
  stock_risk_items: { label: "Stock risks", roles: new Set(["owner"]) },
  technician_load: { label: "Assigned field load", roles: new Set(["owner", "dispatcher"]) },
  assigned_work_today: { label: "Assigned today", roles: new Set(["owner", "technician"]) },
}

function projectionTruth(value: number | null, error: Error | null, atMs: number | null, authenticated: boolean): Truth<number> {
  if (!authenticated) return { status: "denied", reason: "signed-out" }
  if (error) return { status: "unavailable", reason: "network", sinceMs: atMs ?? Date.now() }
  if (value === null) return { status: "unknown", reason: "loading" }
  return { status: "known", value, source: "api:read-model", atMs: atMs ?? Date.now() }
}

function useRegisteredMetrics(keys: readonly ExperienceMetricKey[]): Record<ExperienceMetricKey, Truth<number>> {
  const input = useSelectorInput()
  const { session } = useJarvisAuth()
  const authenticated = Boolean(session)
  const stock = useBusinessProjection(businessProjections.stockRisk(), { enabled: authenticated && keys.includes("stock_risk_items") })
  const technicians = useBusinessProjection(businessProjections.technicianLoad(), { enabled: authenticated && keys.includes("technician_load") })
  const assigned = useBusinessProjection(businessProjections.technicianDay(), { enabled: authenticated && keys.includes("assigned_work_today") })
  return {
    pending_approvals: selectPendingApprovals(input),
    collected_usd: selectCollectedUsd(input),
    overdue_invoice_value: mapTruth(selectOverdueInvoices(input), (value) => value.totalUsd),
    open_leads: selectOpenLeads(input),
    runs_in_flight: selectRunsInFlight(input),
    stuck_runs: selectStuckRuns(input),
    stock_risk_items: projectionTruth(stock.data ? stock.data.belowThreshold.length : null, stock.error, stock.updatedAt, authenticated),
    technician_load: projectionTruth(technicians.data ? technicians.data.reduce((total, technician) => total + technician.upcomingAppointments + technician.openWorkOrders, 0) : null, technicians.error, technicians.updatedAt, authenticated),
    assigned_work_today: projectionTruth(assigned.data ? assigned.data.workOrders.length + assigned.data.visits.length : null, assigned.error, assigned.updatedAt, authenticated),
  }
}

export function RegisteredMetricStrip({ keys, role, heroKey }: { keys: readonly ExperienceMetricKey[]; role: ExperienceRole; heroKey?: ExperienceMetricKey | null }) {
  const values = useRegisteredMetrics(keys)
  const allowed = keys.filter((key) => EXPERIENCE_METRIC_REGISTRY[key].roles.has(role))
  if (allowed.length === 0) return null
  return (
    <div className="jarvis-experience-metrics" data-experience-metric-count={allowed.length}>
      {allowed.map((key) => {
        const definition = EXPERIENCE_METRIC_REGISTRY[key]
        return <div key={key} className="jarvis-experience-metric" data-metric-key={key} data-hero={heroKey === key ? "true" : undefined}><Metric label={definition.label} value={values[key]} format={definition.format} size={heroKey === key ? "lg" : "sm"} /></div>
      })}
    </div>
  )
}

export function isRegisteredMetricForRole(key: string, role: ExperienceRole): boolean {
  return Boolean(EXPERIENCE_METRIC_REGISTRY[key as ExperienceMetricKey]?.roles.has(role))
}
