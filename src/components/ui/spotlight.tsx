"use client"

import { useEffect, useRef } from "react"

export function Spotlight({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      tx = e.clientX - rect.left
      ty = e.clientY - rect.top
    }

    const tick = () => {
      cx += (tx - cx) * 0.12
      cy += (ty - cy) * 0.12
      el.style.background = `radial-gradient(600px circle at ${cx}px ${cy}px, rgba(255,255,255,0.10), transparent 45%)`
      raf = requestAnimationFrame(tick)
    }

    const parent = el.parentElement
    if (parent) {
      parent.addEventListener("mousemove", handleMove)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (parent) parent.removeEventListener("mousemove", handleMove)
    }
  }, [])

  return <div ref={ref} className={`pointer-events-none absolute inset-0 ${className}`} />
}
