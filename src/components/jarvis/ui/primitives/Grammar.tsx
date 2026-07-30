"use client"

// F1.T2 — three small FLOW-26..37 behaviors that are hooks/tiny components rather
// than whole primitives: FLOW-36 CountBadgePop, FLOW-31 CopyFlash, FLOW-37
// InlineEditRipple. Each binds to a real event (onJarvisEvent diff, a real clipboard
// write, a real field save) — never a generic prop-change trigger (F2: real state or
// labeled fixture).

import { useEffect, useRef, useState } from "react"
import { onJarvisEvent, type JarvisEventType } from "../../lib/data-core"

/** FLOW-36 CountBadgePop — pops 1.25x + one ripple ONLY when the bound
 * onJarvisEvent type fires (a real diff), never on every render where `count`
 * happens to differ. Reuses `.jarvis-pop` (jarvis-theme.css, already shipped).
 * `fixturePulse` is a Stage-only escape hatch: incrementing it also pops, so the
 * Stage's Replay button can demo the behavior without a real backend diff firing
 * onJarvisEvent — production call sites never pass it. */
export function CountBadgePop({
  count,
  event,
  className = "",
  fixturePulse,
}: {
  count: number
  event: JarvisEventType
  className?: string
  fixturePulse?: number
}) {
  const [pop, setPop] = useState(0)
  useEffect(() => onJarvisEvent(event, () => setPop((p) => p + 1)), [event])
  useEffect(() => {
    if (fixturePulse === undefined) return
    setPop((p) => p + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixturePulse])
  return (
    <span key={pop} className={`jarvis-pop inline-flex items-center justify-center ${className}`} data-flow="36-count-badge-pop">
      {count}
    </span>
  )
}

/** FLOW-31 CopyFlash — on a real `navigator.clipboard.write`, flashes the trigger
 * accent + shows a "copied" chip anchored at the pointer for ~900ms. */
export function useCopyFlash() {
  const [flashAt, setFlashAt] = useState<{ x: number; y: number; id: number } | null>(null)
  const seq = useRef(0)

  async function copy(text: string, e: React.MouseEvent) {
    await navigator.clipboard.writeText(text)
    const id = seq.current++
    setFlashAt({ x: e.clientX, y: e.clientY, id })
    window.setTimeout(() => setFlashAt((cur) => (cur?.id === id ? null : cur)), 900)
  }

  const Overlay = flashAt ? (
    <span
      key={flashAt.id}
      className="jarvis-rise pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-full rounded-full border border-cyan-300/40 bg-cyan-400/15 px-2 py-0.5 j-fs-micro font-bold uppercase tracking-wider text-cyan-200"
      style={{ left: flashAt.x, top: flashAt.y - 8 }}
    >
      copied
    </span>
  ) : null

  return { copy, Overlay }
}

/** FLOW-37 InlineEditRipple — on a real field save, ripples the underline once
 * (`.jarvis-underline-ripple`, jarvis-theme.css). `trigger()` re-fires the class by
 * forcing a reflow, matching EventFX.flash's restart-safe pattern. */
export function useInlineEditRipple<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  function trigger() {
    const el = ref.current
    if (!el) return
    el.classList.remove("jarvis-underline-ripple")
    void el.offsetWidth
    el.classList.add("jarvis-underline-ripple")
  }
  return { ref, trigger }
}
