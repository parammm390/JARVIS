"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import CustomCursor from "@/components/ui/custom-cursor"
import ParticleNetwork from "@/components/ui/particle-network"
import ScrollProgress from "@/components/ui/scroll-progress"
import GrainOverlay from "@/components/ui/grain-overlay"
import SmoothScroll from "@/components/ui/smooth-scroll"
import { FinnorAIConcierge } from "@/components/ai-concierge/FinnorAIConcierge"

/** Marketing chrome owns the public site; JARVIS owns its own atmosphere,
 * scroll containers, and action surfaces. */
export default function GlobalChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  if (pathname?.startsWith("/jarvis")) return <>{children}</>

  return (
    <SmoothScroll>
      <ParticleNetwork />
      <CustomCursor />
      <ScrollProgress />
      <GrainOverlay />
      {children}
      <FinnorAIConcierge />
    </SmoothScroll>
  )
}
