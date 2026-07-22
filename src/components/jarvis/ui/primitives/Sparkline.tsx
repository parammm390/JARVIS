"use client"

// C3.T2 — extracted from lib/Metric.tsx, which had this exact implementation
// private to itself. Pulled out so it's a named, reusable primitive (StatCard below
// composes it directly) instead of two Sparkline implementations able to drift —
// Metric.tsx now imports from here instead of defining its own.

export function Sparkline({ values }: { values: number[] }) {
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
