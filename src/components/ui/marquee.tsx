"use client"

import { ReactNode } from "react"

interface MarqueeProps {
  children: ReactNode
  duration?: number
  reverse?: boolean
  className?: string
}

export function Marquee({ children, duration = 35, reverse = false, className = "" }: MarqueeProps) {
  return (
    <div className={`group relative flex w-full overflow-hidden ${className}`}>
      <div
        className="flex shrink-0 items-center justify-around gap-12 px-6 [animation-play-state:running] group-hover:[animation-play-state:paused]"
        style={{
          animation: `${reverse ? "marquee-reverse" : "marquee"} ${duration}s linear infinite`,
        }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="flex shrink-0 items-center justify-around gap-12 px-6 [animation-play-state:running] group-hover:[animation-play-state:paused]"
        style={{
          animation: `${reverse ? "marquee-reverse" : "marquee"} ${duration}s linear infinite`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
