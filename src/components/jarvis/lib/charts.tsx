"use client"

// Pure-SVG chart primitives shared by every panel. No chart library, no filters —
// gradients + stroke animation only (§3 neon line style, §9 perf rules). Every chart
// on the page binds to REAL data; these components never invent points.

import { useId } from "react"
import { motion, useReducedMotion } from "framer-motion"

function toPoints(values: number[], w: number, h: number, pad = 3): Array<[number, number]> {
  if (values.length === 0) return []
  if (values.length === 1) return [[w / 2, h / 2]]
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  return values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - pad - ((v - min) / range) * (h - pad * 2),
  ])
}

function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return ""
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    const cx = (x0 + x1) / 2
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`
  }
  return d
}

/** Gradient area + glowing line, draws itself in. The reference image's KPI sparkline. */
export function AreaSparkline({
  values,
  width = 110,
  height = 42,
  color = "var(--j-cyan)",
  className = "",
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}) {
  const id = useId()
  const reduced = useReducedMotion()
  const pts = toPoints(values, width, height)
  if (pts.length < 2) return null
  const line = smoothPath(pts)
  const area = `${line} L${width},${height} L0,${height} Z`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={`overflow-visible ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fade)`} />
      <path d={line} fill="none" stroke={color} strokeWidth={6} opacity={0.18} style={{ filter: "blur(4px)" }} />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.4} fill={color}>
        {!reduced && <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />}
      </circle>
    </svg>
  )
}

/** Donut with per-segment draw-in. Segments must be real counts. */
export function Donut({
  segments,
  size = 128,
  thickness = 14,
  centerLabel,
  centerSub,
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  thickness?: number
  centerLabel?: string
  centerSub?: string
}) {
  const reduced = useReducedMotion()
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offsetAcc = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(100,128,159,0.12)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((seg, i) => {
            const frac = seg.value / total
            const dash = frac * c
            const gap = c - dash
            const offset = -offsetAcc
            offsetAcc += dash
            return (
              <motion.circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={`${dash} ${gap}`}
                initial={reduced ? { strokeDashoffset: offset } : { strokeDashoffset: offset + dash }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 0.9, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />
            )
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {centerLabel && <div className="text-xl font-black tabular-nums text-[color:var(--j-text)]">{centerLabel}</div>}
        {centerSub && <div className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">{centerSub}</div>}
      </div>
    </div>
  )
}

/** Horizontal gradient bar with animated width — the reference's inquiry-type rows. */
export function GradientBar({ pct, from, to }: { pct: number; from: string; to: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/6">
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${from}, ${to})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}
