"use client"

// F6.T2 — FLOW-93 PermissionVeil: formalizes the `!session`/`role !== "owner"` guard
// blocks already scattered across bridge/panels (ActivityTheater, PulseBar, Stage) as
// plain one-line text — never fake data behind an unauthorized wall, always an honest
// reason + the real next action (sign in / owner-only). A frosted static veil, not an
// ambient loop — permission state doesn't change on its own, so there's nothing here
// that should ever be "alive."

import Link from "next/link"
import { Lock } from "lucide-react"

export function PermissionVeil({
  reason,
  actionLabel,
  actionHref,
}: {
  reason: string
  actionLabel?: string
  actionHref?: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-6 py-8 text-center backdrop-blur-sm">
      <Lock className="h-4 w-4 text-[color:var(--j-text-faint)]" aria-hidden />
      <p className="max-w-xs text-[11px] leading-relaxed text-[color:var(--j-text-dim)]">{reason}</p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="mt-1 rounded-full border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-400/10">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
