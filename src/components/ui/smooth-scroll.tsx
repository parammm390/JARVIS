"use client"

import { ReactNode, useEffect } from "react"
import Lenis from "lenis"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger)
}

export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) return

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1,
      touchMultiplier: 1.2,
      anchors: {
        offset: -84,
        duration: 1,
      },
      prevent: (node) =>
        node instanceof HTMLElement &&
        Boolean(node.closest("[data-lenis-prevent]")),
    })

    lenis.on("scroll", ScrollTrigger.update)

    let rafId = 0
    const raf = (time: number) => {
      lenis.raf(time * 1000)
    }

    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(500, 33)

    const refresh = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => ScrollTrigger.refresh())
    }
    window.addEventListener("resize", refresh)
    window.addEventListener("hashchange", refresh)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", refresh)
      window.removeEventListener("hashchange", refresh)
      gsap.ticker.remove(raf)
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
