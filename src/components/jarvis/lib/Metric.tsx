"use client"

import { CountUp } from "./CountUp"
import { LiveDot } from "../atmosphere"
import { Sparkline } from "../ui/primitives/Sparkline"

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
