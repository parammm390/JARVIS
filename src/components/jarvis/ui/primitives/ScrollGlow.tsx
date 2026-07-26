"use client"

// F1.T2 — FLOW-34 ScrollGlow: top/bottom fade + edge glow that appears ONLY while
// the wrapped container genuinely has more content to scroll to (real scrollTop/
// scrollHeight, never a static decoration). CSS recipe (.j-scrollglow) lives in
// jarvis-theme.css; this wrapper toggles the two data attrs it reads from real
// scroll position. Reduced motion: the fades are opacity-only static overlays
// already (no loop to reduce) — nothing further needed.

import { useEffect, useRef, type ReactNode } from "react"

export function ScrollGlow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const atTop = el.scrollTop <= 1
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      el.dataset.scrollTop = String(atTop)
      el.dataset.scrollBottom = String(atBottom)
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={ref} className={`j-scrollglow overflow-y-auto ${className}`} data-scroll-top="true" data-scroll-bottom="true">
      {children}
    </div>
  )
}
