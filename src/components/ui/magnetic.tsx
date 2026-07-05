"use client"

import { ReactNode, useEffect, useRef, MouseEvent, CSSProperties } from "react"

interface MagneticProps {
  children: ReactNode
  strength?: number
  className?: string
  style?: CSSProperties
}

export function Magnetic({ children, strength = 0.35, className = "", style }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const targetRef = useRef({ x: 0, y: 0 })
  const enabledRef = useRef(false)

  useEffect(() => {
    enabledRef.current =
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current || !enabledRef.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    targetRef.current = { x: x * strength, y: y * strength }
    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        if (!ref.current) return
        ref.current.style.transform = `translate3d(${targetRef.current.x}px, ${targetRef.current.y}px, 0)`
        const inner = ref.current.firstElementChild as HTMLElement | null
        if (inner) {
          inner.style.transform = `translate3d(${targetRef.current.x * 0.28}px, ${targetRef.current.y * 0.28}px, 0)`
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
    ref.current.style.transform = `translate3d(0, 0, 0)`
    const inner = ref.current.firstElementChild as HTMLElement | null
    if (inner) inner.style.transform = `translate3d(0, 0, 0)`
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`inline-block transition-transform duration-500 ease-out will-change-transform motion-reduce:transform-none ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
