"use client"

// C2.T2 — FPS meter harness. Plan requirement: "FPS ≥55 on the worst one (meter
// screenshot)" for the ambient/scene FLOW set. Real rAF-measured frame rate, not a
// simulated number — same honesty rule as everything else in this cockpit. Tracks a
// rolling 1s average plus the session-minimum, so a reviewer can screenshot proof of
// the worst moment instead of just whatever frame happened to be on screen.

import { useEffect, useRef, useState } from "react"

export function useFpsMeter() {
  const [fps, setFps] = useState<number | null>(null)
  const [minFps, setMinFps] = useState<number | null>(null)
  const frameCount = useRef(0)
  const windowStart = useRef(0)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    windowStart.current = performance.now()

    function tick(now: number) {
      frameCount.current += 1
      const elapsed = now - windowStart.current
      if (elapsed >= 1000) {
        const measured = Math.round((frameCount.current * 1000) / elapsed)
        setFps(measured)
        setMinFps((prev) => (prev === null ? measured : Math.min(prev, measured)))
        frameCount.current = 0
        windowStart.current = now
      }
      rafId.current = requestAnimationFrame(tick)
    }
    rafId.current = requestAnimationFrame(tick)
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    }
  }, [])

  return { fps, minFps, reset: () => setMinFps(null) }
}

export function FpsMeterHud() {
  const { fps, minFps, reset } = useFpsMeter()
  const tone = minFps === null ? "text-white/50" : minFps >= 55 ? "text-green-300" : "text-red-300"

  return (
    <div className="j-panel fixed bottom-4 right-4 z-50 flex items-center gap-3 px-3 py-1.5" data-testid="fps-meter">
      <span className="j-label">FPS</span>
      <span className={`font-mono text-[13px] font-black ${tone}`}>{fps ?? "…"}</span>
      <span className="text-[9px] text-[color:var(--j-text-faint)]">
        min <span className={tone}>{minFps ?? "…"}</span>
      </span>
      <button onClick={reset} className="rounded-full border border-white/12 px-2 py-0.5 text-[9px] font-bold text-white/50 hover:text-white">
        reset
      </button>
    </div>
  )
}
