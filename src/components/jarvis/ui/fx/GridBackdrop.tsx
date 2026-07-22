"use client"

// C3.T1 — grid/scanline backdrop, Bridge-only per plan spec (JARVIS-MAESTRO-PLAN.md
// §6/C3.T1). D1's Command Bridge (center stage) is the intended real mount point —
// this component doesn't mount itself anywhere today, it's built now so D1 can drop
// it in without re-deriving the CSS. Composes two keyframes that already exist in
// jarvis-theme.css (both already reduced-motion-safe there): `.jarvis-gridfloor`
// (perspective grid floor, already used ambient-wide in JarvisCommandCenter) and
// `.jarvis-scan` (horizontal sweep, already used in WorkflowTheater) — reuse, not a
// third grid implementation.

export function GridBackdrop({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="jarvis-gridfloor jarvis-ambient" />
      <div className="jarvis-scan jarvis-ambient absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/[0.04] to-transparent" />
    </div>
  )
}
