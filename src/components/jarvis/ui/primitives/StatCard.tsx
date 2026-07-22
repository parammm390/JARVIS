"use client"

// C3.T2 — StatCard: Panel + the existing Metric (lib/Metric.tsx — "renders every
// number on the JARVIS page", per that file's own header) composed into one card.
// No new number-rendering logic here; Metric already owns that, StatCard just gives
// it a Panel shell so callers don't hand-wrap `<Panel><Metric/></Panel>` themselves.

import { Panel } from "./Panel"
import { Metric } from "../../lib/Metric"

export function StatCard({
  label,
  value,
  source,
  unit,
  format,
  delta,
  sparkline,
  hot = false,
  className = "",
}: {
  label: string
  value: number
  source: "live" | "derived"
  unit?: string
  format?: (n: number) => string
  delta?: string | null
  sparkline?: number[]
  hot?: boolean
  className?: string
}) {
  return (
    <Panel hot={hot} className={`p-4 ${className}`}>
      <Metric label={label} value={value} source={source} unit={unit} format={format} delta={delta} sparkline={sparkline} />
    </Panel>
  )
}
