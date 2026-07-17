"use client"

// The event->reaction conductor. Every visual here fires from a REAL data-core
// change event — nothing on a timer, nothing invented (see masterplan §1, §2).

import { useEffect, useRef, useState } from "react"
import { onJarvisEvent, type JarvisEventType } from "./data-core"

export function flash(el: HTMLElement | null, cls = "jarvis-flash"): void {
  if (!el) return
  el.classList.remove(cls)
  // force reflow so a re-trigger while already-flashing restarts the animation
  void el.offsetWidth
  el.classList.add(cls)
  const done = () => {
    el.classList.remove(cls)
    el.removeEventListener("animationend", done)
  }
  el.addEventListener("animationend", done)
  setTimeout(done, 700)
}

export function useFlashRef<T extends HTMLElement>(event: JarvisEventType, cls = "jarvis-flash") {
  const ref = useRef<T | null>(null)
  useEffect(() => onJarvisEvent(event, () => flash(ref.current, cls)), [event, cls])
  return ref
}

// Module-level burst queue: WorkflowTheater pushes {x,y} on real step completion;
// ParticleField drains it once per animation frame. Sparks carry no numerals.
let burstQueue: Array<{ x: number; y: number }> = []
export function burstAt(x: number, y: number): void {
  burstQueue.push({ x, y })
}
export function consumeBursts(): Array<{ x: number; y: number }> {
  const q = burstQueue
  burstQueue = []
  return q
}

let pulseCounter = 0

export function EventFXLayer() {
  const [pulses, setPulses] = useState<number[]>([])
  const [edgeGlow, setEdgeGlow] = useState(0)

  useEffect(() => {
    const offPoll = onJarvisEvent("poll-landed", () => {
      pulseCounter += 1
      const id = pulseCounter
      setPulses((p) => [...p.slice(-4), id])
      setTimeout(() => setPulses((p) => p.filter((x) => x !== id)), 750)
    })
    const offPending = onJarvisEvent("new-pending-action", () => {
      setEdgeGlow((k) => k + 1)
    })
    return () => {
      offPoll()
      offPending()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {pulses.map((id) => (
        <span key={id} className="jarvis-datapulse absolute left-0 top-0 h-[2px] w-[2px] rounded-full bg-cyan-300 shadow-[0_0_8px_2px_rgba(34,211,238,0.8)]" />
      ))}
      {edgeGlow > 0 && (
        <span
          key={edgeGlow}
          className="jarvis-edgepulse absolute inset-0"
          style={{ boxShadow: "inset 0 0 60px -20px var(--j-cyan)" }}
        />
      )}
    </div>
  )
}
