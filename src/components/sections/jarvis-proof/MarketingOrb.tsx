"use client"

// M1.T3 — a thin marketing-side driver for the real Orb3D (src/components/jarvis/
// bridge/Orb3D.tsx), reused completely unmodified: same component, same props, same
// IntersectionObserver-pause / prefers-reduced-motion / low-device-memory guards. The
// only new code here is the autoplay script — on the real Bridge, `live` comes from
// useOrbLiveState() reading actual app state; on a public marketing page there is no
// signed-in session to read, so this steps through the same OrbState vocabulary on a
// fixed loop instead. This is presentation of what the orb *can* show, not a claim
// that a real workflow is running — callers should keep it inside a section that
// makes that context clear (the Hero copy, not a "live" label).
import { useEffect, useState } from "react"
import { Orb3D, type OrbLiveState } from "@/components/jarvis/bridge/Orb3D"

const SCRIPT: Array<{ live: OrbLiveState; holdMs: number }> = [
  { live: { state: "idle", activeRunCount: 0 }, holdMs: 2600 },
  { live: { state: "planning", activeRunCount: 0 }, holdMs: 2200 },
  { live: { state: "executing", activeRunCount: 1 }, holdMs: 1400 },
  { live: { state: "executing", activeRunCount: 2 }, holdMs: 1400 },
  { live: { state: "executing", activeRunCount: 3 }, holdMs: 2000 },
]

export function MarketingOrb({ className = "h-[440px] w-[440px]" }: { className?: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setStep((s) => (s + 1) % SCRIPT.length), SCRIPT[step]!.holdMs)
    return () => clearTimeout(timer)
  }, [step])

  return (
    <div className={className}>
      <Orb3D live={SCRIPT[step]!.live} />
    </div>
  )
}
