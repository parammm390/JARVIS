"use client"

// C3.T2 — EmptyState with a next-action, per plan spec. `DemoExperience.tsx` has its
// own bespoke `EmptyStatePreview` (marketing-site demo, not the JARVIS console —
// different package, different audience) — this is the real jarvis/ primitive, no
// prior version existed under src/components/jarvis.
//
// F6.T1 — FLOW-88 EmptyTerrarium: an optional `family` prop layers one small ambient
// SVG diorama above the existing title/description/action, drawn from atmosphere.tsx's
// own gradient/glow vocabulary (never a new visual language). Backward compatible: no
// `family` renders byte-identical output to the pre-F6 component. Each diorama runs
// exactly one gentle loop (opacity breathe, ≥4s period — §2's "system alive" motion
// semantic) and pauses via IntersectionObserver when scrolled offscreen, the same
// convention bridge/Orb3D.tsx already established for its own ambient loop.

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"

export type EmptyFamily = "activity" | "approvals"

const FAMILY_GLYPH: Record<EmptyFamily, { stroke: string; glow: string; path: string }> = {
  // A calm current with a single drifting mote — activity/feed panels.
  activity: { stroke: "#22d3ee", glow: "rgba(34,211,238,0.35)", path: "M4 20 Q 20 8, 36 20 T 68 20" },
  // A still, closed valve — nothing pending to gate.
  approvals: { stroke: "#2dd4bf", glow: "rgba(45,212,191,0.32)", path: "M36 6 L36 34 M22 20 L50 20" },
}

// F6 verification's own reduced-motion Playwright pass caught a real hydration
// mismatch here (`useReducedMotion()` resolves SYNCHRONOUSLY on the client's first
// paint but is always `false`/`null` during SSR — the exact bug class hard rule
// F5/choreo.ts's header documents, and lib/charts.tsx's `useReducedMotionSafe()`
// already fixed this same way for chart primitives). `initial={false}` alone did
// NOT fix it: framer still paints the FIRST frame from `animate`, and `animate`
// itself was reading the raw hook. This wrapper deterministically returns `false`
// through SSR and the client's first paint (a plain `useState(false)` initializer),
// then updates in a `useEffect` — a post-hydration state change, never a
// hydration-time mismatch.
function useReducedMotionSafe(): boolean {
  const reduced = useReducedMotion()
  const [safe, setSafe] = useState(false)
  useEffect(() => setSafe(!!reduced), [reduced])
  return safe
}

function Diorama({ family }: { family: EmptyFamily }) {
  const reduced = useReducedMotionSafe()
  const ref = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? true), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const glyph = FAMILY_GLYPH[family]
  const animate = !reduced && inView ? { opacity: [0.4, 0.85, 0.4] } : { opacity: 0.65 }
  const transition = !reduced && inView ? { duration: 4.5, repeat: Infinity, ease: "easeInOut" as const } : { duration: 0 }
  return (
    <div ref={ref} aria-hidden className="mb-1 h-14 w-16">
      <motion.svg viewBox="0 0 72 40" className="h-full w-full" animate={animate} transition={transition}>
        <path d={glyph.path} fill="none" stroke={glyph.stroke} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} style={{ filter: `drop-shadow(0 0 6px ${glyph.glow})` }} />
      </motion.svg>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  tone = "neutral",
  family,
}: {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  /** Plan v3 P1.T5: §5.5's `unavailable:not-configured` row needs a setup *link*,
   *  not a callback. Takes precedence over `onAction` when both are given. */
  actionHref?: string
  /** Plan v3 P1.T5: §5.5 specifies "EmptyState amber" for `not-configured` —
   *  §5.2 binds amber to "degraded, partial, awaiting human", which an
   *  unconfigured integration is. Defaults to the pre-P1 neutral look. */
  tone?: "neutral" | "amber"
  /** FLOW-88 EmptyTerrarium: which plugin-family diorama to show above the text.
   *  Omit for the plain pre-F6 look (used by generic/unclassified empty states). */
  family?: EmptyFamily
}) {
  const amber = tone === "amber"
  const shell = amber ? "border-amber-400/30 bg-amber-400/[0.03]" : "border-white/10"
  const action = amber
    ? "border-amber-400/40 text-amber-200 hover:border-amber-400/70 hover:bg-amber-400/10"
    : "border-cyan-400/30 text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-400/10"
  return (
    <div className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center ${shell}`}>
      {family && <Diorama family={family} />}
      <div className={`text-[12px] font-bold ${amber ? "text-amber-200" : "text-[color:var(--j-text-dim)]"}`}>{title}</div>
      {description && <p className="max-w-xs text-[10.5px] leading-relaxed text-[color:var(--j-text-faint)]">{description}</p>}
      {actionLabel && actionHref && (
        <Link href={actionHref} className={`mt-2 rounded-full border px-3 py-1.5 text-[10px] font-bold ${action}`}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button onClick={onAction} className={`mt-2 rounded-full border px-3 py-1.5 text-[10px] font-bold ${action}`}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
