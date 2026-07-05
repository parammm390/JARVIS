"use client"

import { useEffect, useRef } from "react"

export default function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const update = () => {
      if (!barRef.current) return
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = docHeight > 0 ? scrollTop / docHeight : 0
      barRef.current.style.transform = `scaleX(${progress})`
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed left-0 top-0 z-[100] h-[2px] w-full bg-white/5">
      <div
        ref={barRef}
        className="h-full origin-left bg-gradient-to-r from-white/40 via-white to-white/40 shadow-[0_0_10px_rgba(255,255,255,0.6)]"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  )
}
