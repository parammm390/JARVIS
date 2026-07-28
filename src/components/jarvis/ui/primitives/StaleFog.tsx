"use client"

// F6.T2 — FLOW-92 StaleFog: wraps a panel's content and, when the caller's own real
// lane timestamp is older than that lane's SLA, dims it under a subtle fog + shows an
// honest "as of" timestamp — never a fake "live" claim on data that hasn't actually
// refreshed. Callers pass their own real `ageMs` (data-core's `laneAgeMs` + a lane's
// own SLA constant, e.g. `SLOW_LANE_STALE_MS`) — this component invents no timing.

function ageLabel(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

export function StaleFog({
  ageMs,
  staleAfterMs,
  caption,
  children,
}: {
  /** Real age of the wrapped data, in ms (null = no successful fetch yet — never fogged, that's a loading/empty concern instead). */
  ageMs: number | null
  staleAfterMs: number
  /** Plan v3 P1.T5: override the chip text. §5.5 fixes the literal copy for a
   *  `Truth.stale` value as "Last confirmed 2m ago", which differs from this
   *  primitive's own default. Omit for the pre-P1 "as of Xm ago" default — callers
   *  that don't pass it render byte-identically to before. */
  caption?: string
  children: React.ReactNode
}) {
  const stale = ageMs !== null && ageMs > staleAfterMs
  return (
    <div className="relative">
      <div className={stale ? "opacity-70 saturate-[0.7] transition-[opacity,filter] duration-700" : "transition-[opacity,filter] duration-700"}>{children}</div>
      {stale && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end px-2 pb-1">
          <span className="j-chip bg-white/[0.06] text-[color:var(--j-text-faint)]">{caption ?? `as of ${ageLabel(ageMs!)}`}</span>
        </div>
      )}
    </div>
  )
}
