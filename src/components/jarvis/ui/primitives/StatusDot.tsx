"use client"

// C3.T2 — StatusDot: a general health/status indicator (ok/degraded/down/unknown),
// distinct from atmosphere.tsx's <LiveDot> (which specifically marks "this number
// came from a live fetch this render" — a data-provenance signal, not a health
// state). Reuses the identical animate-ping pulse technique LiveDot already
// established rather than inventing a second pulse animation; only "ok" pulses
// (matching LiveDot's own restraint — a constantly-pulsing red/amber dot next to
// every degraded row would violate hard rule #10's ≤2-ambient-loops discipline once
// D1's pulse bar renders several of these at once).

const STATUS_COLOR: Record<Status, string> = {
  ok: "#2dd4bf",
  degraded: "#fbbf24",
  down: "#f87171",
  unknown: "#64809f",
}

export type Status = "ok" | "degraded" | "down" | "unknown"

export function StatusDot({ status, className = "" }: { status: Status; className?: string }) {
  const color = STATUS_COLOR[status]
  return (
    <span className={`relative inline-flex h-1.5 w-1.5 ${className}`} aria-hidden data-status={status}>
      {status === "ok" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: color }} />}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  )
}
