"use client"

// C2 — shared card chrome for the FLOW catalog (used by both FlowCatalog.tsx,
// FLOW-01..13, and FlowCatalogAmbient.tsx, FLOW-14..25) so the Stage lists every
// entry with identical id/title/reduced-motion-fallback presentation.

import type { ReactNode } from "react"

export function ReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-white/12 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/60 hover:border-cyan-400/40 hover:text-cyan-200"
    >
      Replay
    </button>
  )
}

export function FlowCard({
  id,
  title,
  reducedFallback,
  children,
}: {
  id: string
  title: string
  reducedFallback: string
  children: ReactNode
}) {
  return (
    <div className="j-panel flex flex-col gap-2 p-4" data-flow-card={id}>
      <div className="flex items-center justify-between">
        <span className="j-label">
          {id} · {title}
        </span>
      </div>
      <div className="flex min-h-[64px] items-center justify-center rounded-xl border border-white/6 bg-black/20 p-3">{children}</div>
      <p className="text-[9.5px] leading-relaxed text-[color:var(--j-text-faint)]">Reduced-motion: {reducedFallback}</p>
    </div>
  )
}
