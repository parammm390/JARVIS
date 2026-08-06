"use client"

// C3.T1 — grid backdrop, Bridge-only per plan spec (JARVIS-MAESTRO-PLAN.md
// §6/C3.T1). D1's Command Bridge (center stage) is the intended real mount point —
// this component doesn't mount itself anywhere today, it's built now so D1 can drop
// it in without re-deriving the CSS. The resting canvas uses only the static
// perspective floor; event-led motion belongs to the field/atmosphere owners and
// must never read as a continuous scan.

export function GridBackdrop({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="jarvis-gridfloor jarvis-ambient" />
    </div>
  )
}
