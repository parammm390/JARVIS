"use client"

import { useEffect } from "react"
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion"

/** Springs to new values on change — never re-animates from 0 on a routine poll. */
export function CountUp({
  value,
  format,
  className = "",
}: {
  value: number
  format?: (n: number) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const motionVal = useMotionValue(value)
  // Reduced motion: near-infinite stiffness collapses the spring to an instant jump.
  const spring = useSpring(motionVal, reduced ? { stiffness: 100000, damping: 1000 } : { stiffness: 120, damping: 20, mass: 0.6 })
  const display = useTransform(spring, (n) => (format ? format(n) : Math.round(n).toLocaleString()))

  useEffect(() => {
    motionVal.set(value)
  }, [value, motionVal])

  return <motion.span className={className}>{display}</motion.span>
}
