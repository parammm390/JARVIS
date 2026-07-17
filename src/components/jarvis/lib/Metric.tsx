"use client"

import { CountUp } from "./CountUp"
import { LiveDot } from "../atmosphere"

/**
 * Renders every number on the JARVIS page. Grep-able definition of done: no raw
 * `{number}` interpolations inside panel JSX — everything real goes through here.
 */
export function Metric({
  label,
  value,
  source,
  unit,
  format,
  delta,
  sparkline,
  size = "md",
}: {
  label: string
  value: number
  source: "live" | "derived"
  unit?: string
  format?: (n: number) => string
  delta?: string | null
  sparkline?: number[]
  size?: "sm" | "md" | "lg"
}) {
  const valueSize = size === "lg" ? "text-4xl" : size === "sm" ? "text-lg" : "text-2xl"
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--j-text-dim)]">
        {source === "live" && <LiveDot />}
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <CountUp value={value} format={format} className={`font-black tabular-nums text-[color:var(--j-text)] ${valueSize}`} />
        {unit && <span className="text-xs font-bold text-[color:var(--j-text-dim)]">{unit}</span>}
        {delta && <span className="ml-1 rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-black text-teal-300">{delta}</span>}
      </div>
      {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const w = 96
  const h = 28
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const path = `M${points.join(" L")}`
  const areaPath = `${path} L${w},${h} L0,${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="mt-1.5 overflow-visible">
      <path d={areaPath} fill="url(#sparkline-fade)" opacity={0.25} />
      <path d={path} fill="none" stroke="var(--j-cyan)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="sparkline-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--j-cyan)" />
          <stop offset="100%" stopColor="var(--j-cyan)" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  )
}
