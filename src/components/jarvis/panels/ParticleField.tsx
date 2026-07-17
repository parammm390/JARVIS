"use client"

// Ambient reactive starfield. Pure decoration: 48 drifting dots plus short-lived
// spark bursts fired only from real events (WorkflowTheater step completion). No
// numerals, units, or data-shaped labels ever render here (§1 honesty engine).

import { useEffect, useRef } from "react"
import { onFrame } from "../lib/raf-bus"
import { consumeBursts } from "../lib/EventFX"

interface Particle {
  x: number
  y: number
  r: number
  vy: number
  alpha: number
  color: string
}
interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  bornAt: number
}

const COUNT = 48

function initParticles(w: number, h: number): Particle[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    x: ((i * 127) % 100) * (w / 100),
    y: ((i * 211) % 100) * (h / 100),
    r: 0.6 + (i % 3) * 0.5,
    vy: -(4 + ((i * 13) % 10)) / 1000,
    alpha: 0.12 + (i % 5) * 0.04,
    color: i % 2 === 0 ? "34,211,238" : "59,130,246",
  }))
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const sparksRef = useRef<Spark[]>([])
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    function resize() {
      const w = window.innerWidth
      const h = window.innerHeight
      canvas!.width = w * devicePixelRatio
      canvas!.height = h * devicePixelRatio
      ctx!.scale(devicePixelRatio, devicePixelRatio)
      particlesRef.current = initParticles(w, h)
    }
    resize()
    window.addEventListener("resize", resize)

    const draw = (t: number) => {
      if (document.visibilityState === "hidden") return
      const last = lastRef.current
      lastRef.current = t
      const dt = last == null ? 16 : Math.min(64, t - last)
      const w = window.innerWidth
      const h = window.innerHeight
      ctx!.clearRect(0, 0, w, h)

      for (const p of particlesRef.current) {
        p.y += p.vy * dt
        if (p.y < -4) p.y = h + 4
        if (p.y > h + 4) p.y = -4
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${p.color},${p.alpha})`
        ctx!.fill()
      }

      const fresh = consumeBursts()
      for (const b of fresh) {
        for (let k = 0; k < 6; k++) {
          const angle = (k * 60 * Math.PI) / 180
          sparksRef.current.push({ x: b.x, y: b.y, vx: (Math.cos(angle) * 40) / 1000, vy: (Math.sin(angle) * 40) / 1000, bornAt: t })
        }
      }
      sparksRef.current = sparksRef.current.filter((s) => t - s.bornAt < 600)
      for (const s of sparksRef.current) {
        const age = t - s.bornAt
        s.x += s.vx * dt
        s.y += s.vy * dt
        const alpha = Math.max(0, 1 - age / 600) * 0.8
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, 1.6, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(34,211,238,${alpha})`
        ctx!.fill()
      }
    }

    const off = onFrame(draw)
    return () => {
      off()
      window.removeEventListener("resize", resize)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="jarvis-ambient pointer-events-none fixed inset-0 -z-10" style={{ width: "100vw", height: "100vh" }} />
}
