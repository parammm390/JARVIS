"use client"

import { ReactNode, useRef, MouseEvent } from "react"

interface TiltCardProps {
  children: ReactNode
  className?: string
  intensity?: number
  glare?: boolean
}

export function TiltCard({ children, className = "", intensity = 8, glare = true }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const pointerRef = useRef({ px: 0.5, py: 0.5 })

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    pointerRef.current = { px, py }
    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        if (!ref.current) return
        const { px: nextX, py: nextY } = pointerRef.current
        const rx = (nextY - 0.5) * -intensity
        const ry = (nextX - 0.5) * intensity
        ref.current.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`
        if (glareRef.current) {
          glareRef.current.style.setProperty("--glare-x", `${nextX * 100}%`)
          glareRef.current.style.setProperty("--glare-y", `${nextY * 100}%`)
          glareRef.current.style.opacity = "1"
        }
      })
    }
  }

  const handleLeave = () => {
    if (!ref.current) return
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    ref.current.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0)`
    if (glareRef.current) {
      glareRef.current.style.opacity = "0"
    }
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`relative transition-transform duration-300 ease-out will-change-transform ${className}`}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
      {glare && (
        <div
          ref={glareRef}
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
          style={{
            mixBlendMode: "overlay",
            background:
              "radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255,255,255,0.18), transparent 50%)",
          }}
        />
      )}
    </div>
  )
}
