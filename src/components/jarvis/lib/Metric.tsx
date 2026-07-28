"use client"

import { CountUp } from "./CountUp"
import { LiveDot } from "../atmosphere"
import { Sparkline } from "../ui/primitives/Sparkline"
import { EmptyState } from "../ui/primitives/EmptyState"
import { ErrorState } from "../ui/primitives/ErrorState"
import { PermissionVeil } from "../ui/primitives/PermissionVeil"
import { SkeletonStat } from "../ui/primitives/Skeletons"
import { StaleFog } from "../ui/primitives/StaleFog"
import type { Truth } from "../kernel/types"

/**
 * Renders every number on the JARVIS page — and is the enforcement point for
 * plan v3 §5.5: a number cannot reach the screen without carrying how it is known.
 *
 * `value` is `Truth<number>`, not `number`. That is the whole point. A `known`,
 * `stale` or `partial` truth renders a number; every other status renders the
 * designed truthful state instead. This makes defect C-01 — a 401 rendering as a
 * confident `$0` with a sparkline, verified live on production — structurally
 * impossible rather than merely discouraged.
 *
 * The `source: "live" | "derived"` prop is gone (P1.T5). Provenance now travels
 * inside the Truth itself as `TruthSource`, so it can never disagree with the value.
 *
 * Every rendered number carries `data-truth` and `data-source`, which is what the
 * automated contradiction sweep (P7.T6) reads.
 */

// "2m ago" shape, matching StaleFog's own label vocabulary.
function ageLabel(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

export function Metric({
  label,
  value,
  unit,
  format,
  delta,
  sparkline,
  size = "md",
  onRetry,
  setupHref,
  emptyActionLabel,
  onEmptyAction,
}: {
  label: string
  value: Truth<number>
  unit?: string
  format?: (n: number) => string
  delta?: string | null
  sparkline?: number[]
  size?: "sm" | "md" | "lg"
  /** §5.5 `unavailable:network` — the Retry affordance. */
  onRetry?: () => void
  /** §5.5 `unavailable:not-configured` — the setup link. */
  setupHref?: string
  /** §5.5 `unknown:never-fetched` — "the action that creates one". */
  emptyActionLabel?: string
  onEmptyAction?: () => void
}) {
  const valueSize = size === "lg" ? "text-4xl" : size === "sm" ? "text-lg" : "text-2xl"

  const header = (
    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--j-text-dim)]">
      {value.status === "known" && value.source.startsWith("api:") && <LiveDot />}
      {label}
    </div>
  )

  // ---- §5.5: the statuses that must NOT render a number ------------------
  if (value.status === "unknown") {
    return (
      <div data-truth={value.status}>
        {header}
        {value.reason === "loading" ? (
          <SkeletonStat />
        ) : (
          <EmptyState title="Nothing here yet." actionLabel={emptyActionLabel} onAction={onEmptyAction} />
        )}
      </div>
    )
  }

  if (value.status === "denied") {
    return (
      <div data-truth={value.status}>
        {header}
        <PermissionVeil
          reason={value.reason === "signed-out" ? "Sign in to see this." : "Your role doesn't include this."}
        />
      </div>
    )
  }

  if (value.status === "unavailable") {
    if (value.reason === "not-configured") {
      return (
        <div data-truth={value.status}>
          {header}
          <EmptyState
            tone="amber"
            title="Not connected yet."
            actionLabel={setupHref ? "Set up" : undefined}
            actionHref={setupHref}
          />
        </div>
      )
    }
    // `network` and `server` both mean: we asked, and got no usable answer.
    // §5.5 specifies copy for `network` only — see ## BLOCKERS in the state file.
    return (
      <div data-truth={value.status}>
        {header}
        <ErrorState message="Can't reach JARVIS." onRetry={onRetry} />
        <div className="mt-1 text-[10px] text-[color:var(--j-text-faint)]">
          Last confirmed {ageLabel(Date.now() - value.sinceMs)}
        </div>
      </div>
    )
  }

  // ---- §5.5: known | stale | partial — a number may render ---------------
  const body = (
    <>
      <div className="flex items-baseline gap-1.5">
        <CountUp
          value={value.value}
          format={format}
          className={`font-black tabular-nums text-[color:var(--j-text)] ${valueSize}`}
        />
        {unit && <span className="text-xs font-bold text-[color:var(--j-text-dim)]">{unit}</span>}
        {delta && <span className="ml-1 rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-black text-teal-300">{delta}</span>}
      </div>
      {value.status === "partial" && (
        <span className="j-chip mt-1 inline-block bg-amber-400/10 text-amber-200">
          {value.capped} of {value.value} shown
        </span>
      )}
      {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}
    </>
  )

  return (
    <div data-truth={value.status} data-source={value.source}>
      {header}
      {value.status === "stale" ? (
        <StaleFog ageMs={value.ageMs} staleAfterMs={0} caption={`Last confirmed ${ageLabel(value.ageMs)}`}>
          {body}
        </StaleFog>
      ) : (
        body
      )}
    </div>
  )
}
