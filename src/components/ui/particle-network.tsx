"use client"

import { useEffect, useRef } from "react"

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  size: number
  baseSize: number
  phase: number
  wobble: number
}

export default function ParticleNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches
    if (!finePointer) return

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let width = window.innerWidth
    let height = window.innerHeight
    let scrollY = window.scrollY

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    resize()

    let particles: Particle[] = []
    const connectionDistance = 126
    const connectionDistanceSq = connectionDistance * connectionDistance
    const mouseRange = 320
    const mouseRangeSq = mouseRange * mouseRange
    const maxMouseLinks = 7

    const mouse = { x: -9999, y: -9999, vx: 0, vy: 0 }
    let lastMouseX = -9999
    let lastMouseY = -9999

    const buildParticles = () => {
      const count = Math.min(
        Math.max(Math.floor((width * height) / 19000), 56),
        118
      )
      particles = []
      for (let i = 0; i < count; i++) {
        const z = Math.random() * 0.78 + 0.32
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z,
          vx: (Math.random() - 0.5) * 0.42 * z,
          vy: (Math.random() - 0.5) * 0.42 * z,
          baseSize: Math.random() * 1.55 + 0.45,
          size: 0,
          phase: Math.random() * Math.PI * 2,
          wobble: Math.random() * 0.018 + 0.006,
        })
      }
      particles.forEach((p) => (p.size = p.baseSize * p.z))
    }
    buildParticles()

    const onMove = (e: MouseEvent) => {
      mouse.vx = e.clientX - lastMouseX
      mouse.vy = e.clientY - lastMouseY
      lastMouseX = e.clientX
      lastMouseY = e.clientY
      mouse.x = e.clientX
      mouse.y = e.clientY
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }
    const onResize = () => {
      resize()
      buildParticles()
    }
    const onScroll = () => {
      scrollY = window.scrollY
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseleave", onLeave)
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, { passive: true })

    let raf = 0
    let lastFrame = 0
    const draw = (time = 0) => {
      ctx.clearRect(0, 0, width, height)
      const scrollDrift = Math.sin(scrollY * 0.002) * 0.035

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const drift = Math.sin(time * p.wobble + p.phase) * 0.016 * p.z
        p.vx += Math.cos(p.phase + time * p.wobble * 0.7) * drift
        p.vy += Math.sin(p.phase + time * p.wobble * 0.9) * drift + scrollDrift * p.z
        p.x += p.vx
        p.y += p.vy

        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1

        const dx = mouse.x - p.x
        const dy = mouse.y - p.y
        const distSq = dx * dx + dy * dy

        if (distSq < mouseRangeSq) {
          const dist = Math.sqrt(distSq)
          const force = (mouseRange - dist) / mouseRange
          p.vx -= (dx / (dist || 1)) * force * 0.035 * p.z
          p.vy -= (dy / (dist || 1)) * force * 0.035 * p.z
        }

        p.vx *= 0.988
        p.vy *= 0.988

        const minSpeed = 0.085 * p.z
        if (Math.abs(p.vx) < minSpeed) p.vx = p.vx > 0 ? minSpeed : -minSpeed
        if (Math.abs(p.vy) < minSpeed) p.vy = p.vy > 0 ? minSpeed : -minSpeed

        const glow = 0.82 + Math.sin(time * 0.002 + p.phase) * 0.18
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(8,24,39,${(0.18 * p.z + 0.07) * glow})`
        ctx.fill()

        if (distSq < mouseRangeSq) {
          const halo = (1 - Math.sqrt(distSq) / mouseRange) * 0.12
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 4.2, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(30,91,141,${halo})`
          ctx.fill()
        }
      }

      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distSq = dx * dx + dy * dy
          if (distSq < connectionDistanceSq) {
            const dist = Math.sqrt(distSq)
            const op = (1 - dist / connectionDistance) * 0.075 * Math.min(a.z, b.z)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(8,24,39,${op})`
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        }
      }

      particles
        .map((p) => {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          return { particle: p, distSq: dx * dx + dy * dy }
        })
        .filter(({ distSq }) => distSq < mouseRangeSq)
        .sort((a, b) => a.distSq - b.distSq)
        .slice(0, maxMouseLinks)
        .forEach(({ particle, distSq }, index) => {
          const dist = Math.sqrt(distSq)
          const op = (1 - dist / mouseRange) * (0.42 - index * 0.022)
          ctx.beginPath()
          ctx.moveTo(particle.x, particle.y)
          ctx.lineTo(mouse.x, mouse.y)
          ctx.strokeStyle = `rgba(8,24,39,${op})`
          ctx.lineWidth = 1
          ctx.stroke()
        })
    }

    const animate = (time: number) => {
      if (!document.hidden && time - lastFrame >= 20) {
        draw(time)
        lastFrame = time
      }
      if (!reducedMotion) {
        raf = requestAnimationFrame(animate)
      }
    }
    draw()
    if (!reducedMotion) {
      raf = requestAnimationFrame(animate)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[2] opacity-32"
      style={{ background: "transparent" }}
      aria-hidden
    />
  )
}
