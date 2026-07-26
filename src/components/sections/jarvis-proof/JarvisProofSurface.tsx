// M1.T2, the visual token bridge's dark-surface half. jarvis-theme.css's --j-* tokens
// are scoped entirely to selectors under `.jarvis-root` (grepped, confirmed: the file
// declares custom properties there and nowhere sets a global background/color itself
// every real JARVIS component paints its own background/text via Tailwind arbitrary
// values reading those vars). Importing the stylesheet here is a plain global CSS
// import (no CSS-modules scoping exists in this app), so it's imported exactly once,
// at this single entry point, rather than re-imported by every consumer, Next.js/
// webpack would dedupe repeats anyway, but one canonical import site is the discipline
// hard rule 5 (bridge, don't duplicate) asks for.
//
// This wrapper is the ONLY place in the marketing site that mounts `.jarvis-root`
// every dark/proof section (Hero's Orb, the Command Bridge showcase, the merged
// demo's result card) renders inside one of these rather than hand-rolling its own
// dark chrome, so a future change to the real jarvis-theme tokens propagates here
// automatically instead of drifting.
import "@/components/jarvis/jarvis-theme.css"
import type { ReactNode } from "react"

export function JarvisProofSurface({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`jarvis-root ${className}`}
      style={{ background: "var(--j-bg)", color: "var(--j-text)" }}
    >
      {children}
    </div>
  )
}
