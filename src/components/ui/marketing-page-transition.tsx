"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { usePathname } from "next/navigation"

export default function MarketingPageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reducedMotion = useReducedMotion()

  if (reducedMotion) return <>{children}</>

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -7 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        style={{ minWidth: 0, overflow: "clip" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
