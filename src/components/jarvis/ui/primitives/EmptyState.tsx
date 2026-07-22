"use client"

// C3.T2 — EmptyState with a next-action, per plan spec. `DemoExperience.tsx` has its
// own bespoke `EmptyStatePreview` (marketing-site demo, not the JARVIS console —
// different package, different audience) — this is the real jarvis/ primitive, no
// prior version existed under src/components/jarvis.

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
      <div className="text-[12px] font-bold text-[color:var(--j-text-dim)]">{title}</div>
      {description && <p className="max-w-xs text-[10.5px] leading-relaxed text-[color:var(--j-text-faint)]">{description}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-2 rounded-full border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-400/10"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
