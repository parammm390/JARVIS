"use client"

import { useEffect, useRef, useState } from "react"

interface CounterProps {
  value: string
  duration?: number
  className?: string
}

export function Counter({ value, duration = 2, className = "" }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)
  const animated = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Parse prefix, number, and suffix for compact metric labels.
    const match = value.match(/^([^\d-]*)([\d.]+)(.*)$/)
    if (!match) {
      setDisplay(value)
      return
    }
    const [, prefix, numStr, suffix] = match
    const target = parseFloat(numStr)
    const isInt = !numStr.includes(".")

    setDisplay(`${prefix}0${suffix}`)

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !animated.current) {
            animated.current = true
            const start = performance.now()
            const tick = (now: number) => {
              const t = Math.min((now - start) / (duration * 1000), 1)
              const eased = 1 - Math.pow(1 - t, 3)
              const current = target * eased
              setDisplay(`${prefix}${isInt ? Math.round(current) : current.toFixed(1)}${suffix}`)
              if (t < 1) requestAnimationFrame(tick)
              else setDisplay(value)
            }
            requestAnimationFrame(tick)
          }
        })
      },
      { threshold: 0.4 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}
