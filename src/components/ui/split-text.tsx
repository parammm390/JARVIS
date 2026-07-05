"use client"

import { useEffect, useRef, ReactNode } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import SplitType from "split-type"

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger)
}

interface SplitTextProps {
  children: ReactNode
  as?: keyof JSX.IntrinsicElements
  className?: string
  delay?: number
  stagger?: number
  trigger?: "scroll" | "load"
  type?: "chars" | "words" | "lines"
}

export function SplitText({
  children,
  as: Tag = "div",
  className = "",
  delay = 0,
  stagger = 0.025,
  trigger = "load",
  type = "chars",
}: SplitTextProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const split = new SplitType(el as HTMLElement, {
      types: type === "lines" ? "lines" : type === "words" ? "words" : "words,chars",
    })

    const targets =
      type === "lines" ? split.lines : type === "words" ? split.words : split.chars
    if (!targets) return

    gsap.set(targets, { y: "110%", opacity: 0, rotateX: -45 })

    const anim = gsap.to(targets, {
      y: 0,
      opacity: 1,
      rotateX: 0,
      duration: 1.1,
      ease: "expo.out",
      stagger,
      delay,
      paused: trigger === "scroll",
    })

    let st: ScrollTrigger | undefined
    if (trigger === "scroll") {
      st = ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => anim.play(),
      })
    }

    return () => {
      anim.kill()
      st?.kill()
      split.revert()
    }
  }, [delay, stagger, trigger, type])

  const Component = Tag as any
  return (
    <Component ref={ref as any} className={className} style={{ perspective: "1000px" }}>
      {children}
    </Component>
  )
}
