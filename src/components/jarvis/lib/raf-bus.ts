"use client"

// Single app-wide rAF driver. Every continuous animation that needs per-frame
// timing subscribes here instead of calling requestAnimationFrame itself.

type Frame = (t: number) => void
const subs = new Set<Frame>()
let running = false

function loop(t: number) {
  if (subs.size === 0) {
    running = false
    return
  }
  subs.forEach((f) => f(t))
  requestAnimationFrame(loop)
}

export function onFrame(f: Frame): () => void {
  subs.add(f)
  if (!running) {
    running = true
    requestAnimationFrame(loop)
  }
  return () => {
    subs.delete(f)
  }
}
