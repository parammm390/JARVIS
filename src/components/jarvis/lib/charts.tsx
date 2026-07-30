"use client"

// Pure-SVG chart primitives shared by every panel. No chart library, no filters —
// gradients + stroke animation only (§3 neon line style, §9 perf rules). Every chart
// on the page binds to REAL data; these components never invent points.

import { useEffect, useId, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { EASE } from "../ui/motion/tokens"

// FLOW-81 AxisEtch: how long the baseline etches in before the data draw starts
// (opt-in per call site via the `axisEtch` prop below — a 96x40 KPI tile is too
// small for a baseline to read, a 260-wide analytics chart is not).
const AXIS_ETCH_DURATION = 0.22

// F5.T5 — found + fixed during this phase's own reduced-motion Playwright pass
// (a real hydration mismatch: "strokeDasharray" server/client prop mismatch on
// AreaSparkline's draw-in path): `useReducedMotion()` resolves to `null` during
// SSR and SYNCHRONOUSLY to the real boolean on the client's first render (the same
// finding choreo.ts's header already documents for `initial`-branching — this file
// had the identical bug, just never exercised by a reduced-motion probe before
// now). Every chart primitive below reads `reduced` through this wrapper instead
// of `useReducedMotion()` directly: it deterministically returns `false` on SSR
// AND on the client's first paint (a plain `useState(false)` initializer, not a
// browser API read), then updates to the real value in a `useEffect` — a
// post-hydration state change, never a hydration-time mismatch. Same "mounted-flag"
// convention bridge/Orb3D already established.
function useReducedMotionSafe(): boolean {
  const reduced = useReducedMotion()
  const [safe, setSafe] = useState(false)
  useEffect(() => setSafe(!!reduced), [reduced])
  return safe
}

export function toPoints(values: number[], w: number, h: number, pad = 3): Array<[number, number]> {
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

/** Gradient area + glowing line, draws itself in. The reference image's KPI sparkline.
 *  FLOW-84 SparkPulse is always-on (the trailing circle's opacity blink, LiveDot
 *  lineage) — every consumer gets a live-looking latest point for free. FLOW-81
 *  AxisEtch is opt-in via `axisEtch` (see the module-level comment on why). */
export function AreaSparkline({
  values,
  width = 110,
  height = 42,
  color = "var(--j-cyan)",
  className = "",
  axisEtch = false,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  className?: string
  axisEtch?: boolean
}) {
  const id = useId()
  const reduced = useReducedMotionSafe()
  const pts = toPoints(values, width, height)
  if (pts.length < 2) return null
  const line = smoothPath(pts)
  const area = `${line} L${width},${height} L0,${height} Z`
  const drawDelay = axisEtch && !reduced ? AXIS_ETCH_DURATION : 0
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={`overflow-visible ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {axisEtch && (
        <motion.line
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke="rgba(148,178,209,0.18)"
          strokeWidth={1}
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduced ? 0 : AXIS_ETCH_DURATION, ease: EASE.standard }}
        />
      )}
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
        transition={{ duration: 1.1, delay: drawDelay, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* FLOW-84 SparkPulse: the latest real point blinks, same opacity curve
          lineage as atmosphere.tsx's LiveDot. */}
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.4} fill={color}>
        {!reduced && <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />}
      </circle>
    </svg>
  )
}

/** Donut with per-segment draw-in (FLOW-83 DonutCarve's lathe motion) plus an
 *  externally-controlled active segment that lifts via a thickness/opacity
 *  emphasis (no radius translate — keeps the ring geometrically simple). `active`
 *  is driven by the caller (e.g. a hovered legend row), not internal SVG hover, so
 *  it composes with the decorative `aria-hidden` svg below. Segments must be real
 *  counts. */
export function Donut({
  segments,
  size = 128,
  thickness = 14,
  centerLabel,
  centerSub,
  active,
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  thickness?: number
  centerLabel?: string
  centerSub?: string
  active?: string | null
}) {
  const reduced = useReducedMotionSafe()
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
            const isActive = active != null && active === seg.label
            const isDimmed = active != null && !isActive
            return (
              <motion.circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeLinecap="butt"
                strokeDasharray={`${dash} ${gap}`}
                initial={reduced ? { strokeDashoffset: offset, strokeWidth: thickness, opacity: 1 } : { strokeDashoffset: offset + dash, strokeWidth: thickness, opacity: 1 }}
                animate={{ strokeDashoffset: offset, strokeWidth: isActive ? thickness + 4 : thickness, opacity: isDimmed ? 0.45 : 1 }}
                transition={{
                  strokeDashoffset: { duration: 0.9, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] },
                  strokeWidth: { duration: 0.2, ease: EASE.decelerate },
                  opacity: { duration: 0.2 },
                }}
              />
            )
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {centerLabel && <div className="text-xl font-black tabular-nums text-[color:var(--j-text)]">{centerLabel}</div>}
        {centerSub && <div className="j-fs-micro font-bold uppercase tracking-widest text-[color:var(--j-text-dim)]">{centerSub}</div>}
      </div>
    </div>
  )
}

/** Horizontal gradient bar — the reference's inquiry-type rows. FLOW-82 BarSettle:
 *  a spring settle (not a decelerate-curve tween) staggered by `index`, which the
 *  caller passes as the bar's position in its already value-sorted list — so the
 *  biggest bar settles first, exactly the "staggered by value order" spec. */
export function GradientBar({ pct, from, to, index = 0 }: { pct: number; from: string; to: string; index?: number }) {
  const reduced = useReducedMotionSafe()
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/6">
      <motion.div
        className="h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${from}, ${to})` }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 26, delay: index * 0.06 }}
      />
    </div>
  )
}

/** FLOW-85 DeltaShimmer: one-shot green/amber shimmer sweep across a delta chip
 *  when its underlying real label changes (never on first mount) — reduced: the
 *  chip's existing color tick only, no sweep. Tabular-nums enforced via `.j-num`. */
export function DeltaChip({ label, tone }: { label: string; tone: "up" | "warn" }) {
  const reduced = useReducedMotionSafe()
  const [pulseKey, setPulseKey] = useState(0)
  const mounted = useRef(false)
  const prevLabel = useRef(label)
  useEffect(() => {
    if (mounted.current && prevLabel.current !== label) setPulseKey((k) => k + 1)
    mounted.current = true
    prevLabel.current = label
  }, [label])
  const sweepColor = tone === "warn" ? "rgba(251,191,36,0.35)" : "rgba(45,212,191,0.35)"
  return (
    <span
      className={`j-chip j-num relative shrink-0 overflow-hidden ${tone === "warn" ? "bg-amber-400/12 text-amber-300" : "bg-teal-400/12 text-teal-300"}`}
    >
      {!reduced && (
        <motion.span
          key={pulseKey}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(90deg, transparent, ${sweepColor}, transparent)` }}
          initial={{ x: "-120%" }}
          animate={{ x: "120%" }}
          transition={{ duration: 0.5, ease: EASE.standard }}
        />
      )}
      <span className="relative">{label}</span>
    </span>
  )
}

/** FLOW-86 BandBreath: a forecast confidence band drawn behind a line, breathing
 *  (opacity oscillation, period 4.2s — the motion-semantics table's "ambience
 *  respires, period >=4s" row). Renders NOTHING if `band` is absent — the
 *  graceful-absent contract for `Insights.forecastBand` (data-core.ts), a field
 *  typed now but not yet returned by any real API deploy (B3's job). Never a
 *  fabricated band. */
export function ForecastBand({ band, width = 260, height = 44 }: { band?: Array<{ lo: number; hi: number }>; width?: number; height?: number }) {
  const reduced = useReducedMotionSafe()
  if (!band || band.length < 2) return null
  const values = band.flatMap((b) => [b.lo, b.hi])
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const n = band.length
  const x = (i: number) => (i / (n - 1)) * width
  const y = (v: number) => height - ((v - min) / range) * height
  const top = band.map((b, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(b.hi)}`).join(" ")
  const bottom = band
    .map((b, i) => [i, b] as const)
    .reverse()
    .map(([i, b]) => `L${x(i)},${y(b.lo)}`)
    .join(" ")
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <motion.path
        d={`${top} ${bottom} Z`}
        fill="var(--j-violet)"
        initial={{ opacity: reduced ? 0.12 : 0.08 }}
        animate={reduced ? { opacity: 0.12 } : { opacity: [0.08, 0.16, 0.08] }}
        transition={reduced ? { duration: 0 } : { duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  )
}

/** FLOW-87 AnomalyFlare: a ring flare + annotation chip at a marked point.
 *  Renders NOTHING unless a real `point`+`label` are supplied — the same
 *  graceful-absent contract as ForecastBand above, for `Insights.anomalies`. */
export function AnomalyFlare({ point, label }: { point?: { x: number; y: number } | null; label?: string }) {
  const reduced = useReducedMotionSafe()
  if (!point || !label) return null
  return (
    <div className="pointer-events-none absolute" style={{ left: point.x, top: point.y }} aria-hidden>
      <motion.span
        className="absolute -inset-2 rounded-full border-2 border-red-400/70"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={reduced ? { scale: 1, opacity: 0.7 } : { scale: [0.6, 1.6], opacity: [0, 0.7, 0] }}
        transition={reduced ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: EASE.decelerate }}
      />
      <span className="absolute left-2 top-2 whitespace-nowrap rounded-md border border-red-400/40 bg-red-950/80 px-1.5 py-0.5 j-fs-micro font-bold text-red-200">
        {label}
      </span>
    </div>
  )
}
