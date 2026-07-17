"use client"

// The identity element, v2 — an arc-reactor HUD orb: glowing core with specular
// highlight, two counter-rotating arc rings, a tick ring, and orbiting satellites.
// Voice-live triples ring speed and pulses the core with the REAL volume level;
// degraded shifts amber and slows. Pure SVG + transform animation.

import { motion, useReducedMotion } from "framer-motion"
import { useId } from "react"

export type VoiceState = "idle" | "connecting" | "live" | "speaking"

export function JarvisOrb({
  size = 64,
  voiceState = "idle",
  volumeLevel = 0,
  degraded = false,
}: {
  size?: number
  voiceState?: VoiceState
  volumeLevel?: number
  degraded?: boolean
}) {
  const id = useId()
  const reduced = useReducedMotion()
  const live = voiceState === "live" || voiceState === "speaking"
  const speaking = voiceState === "speaking"
  const S = 100
  const c = S / 2

  const coreA = speaking ? "#5eead4" : degraded ? "#fcd34d" : "#7dd3fc"
  const coreB = speaking ? "#0f766e" : degraded ? "#92400e" : "#1d4ed8"
  const ring = degraded ? "rgba(251,191,36,0.65)" : "rgba(34,211,238,0.85)"
  const ringDim = degraded ? "rgba(251,191,36,0.25)" : "rgba(59,130,246,0.35)"

  const spin = (dir: 1 | -1 = 1) => (reduced ? {} : { rotate: 360 * dir })
  const spinT = (dur: number) => ({ duration: live ? dur / 3 : degraded ? dur * 1.8 : dur, repeat: Infinity, ease: "linear" as const })

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* glow bed */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: degraded ? "0 0 26px rgba(251,191,36,0.3)" : `0 0 ${live ? 38 : 24}px rgba(34,211,238,${live ? 0.5 : 0.28})` }}
      />
      <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <radialGradient id={`${id}-core`} cx="36%" cy="30%" r="75%">
            <stop offset="0%" stopColor={coreA} />
            <stop offset="55%" stopColor={coreB} />
            <stop offset="100%" stopColor="#060b18" />
          </radialGradient>
          <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="transparent" />
            <stop offset="100%" stopColor={degraded ? "rgba(251,191,36,0.28)" : "rgba(34,211,238,0.3)"} />
          </radialGradient>
        </defs>

        {/* tick ring */}
        <g opacity={0.55}>
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2
            const r1 = 46
            const r2 = i % 6 === 0 ? 41.5 : 43.5
            return (
              <line
                key={i}
                x1={c + Math.cos(a) * r1}
                y1={c + Math.sin(a) * r1}
                x2={c + Math.cos(a) * r2}
                y2={c + Math.sin(a) * r2}
                stroke={ringDim}
                strokeWidth={i % 6 === 0 ? 1.6 : 0.9}
              />
            )
          })}
        </g>

        {/* counter-rotating arc rings */}
        <motion.g style={{ originX: "50%", originY: "50%" }} animate={spin(1)} transition={spinT(18)}>
          <circle cx={c} cy={c} r={37} fill="none" stroke={ring} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="58 174" />
          <circle cx={c} cy={c} r={37} fill="none" stroke={ring} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="12 220" strokeDashoffset={-120} opacity={0.7} />
        </motion.g>
        <motion.g style={{ originX: "50%", originY: "50%" }} animate={spin(-1)} transition={spinT(29)}>
          <circle cx={c} cy={c} r={31} fill="none" stroke={ringDim} strokeWidth={1.4} strokeLinecap="round" strokeDasharray="40 155" />
        </motion.g>

        {/* orbiting satellites */}
        {!reduced && (
          <>
            <motion.g style={{ originX: "50%", originY: "50%" }} animate={{ rotate: 360 }} transition={spinT(11)}>
              <circle cx={c + 37} cy={c} r={2.4} fill={ring} />
            </motion.g>
            <motion.g style={{ originX: "50%", originY: "50%" }} animate={{ rotate: -360 }} transition={spinT(17)}>
              <circle cx={c - 31} cy={c} r={1.7} fill={ringDim} />
            </motion.g>
          </>
        )}

        {/* core */}
        <motion.g
          style={{ originX: "50%", originY: "50%" }}
          animate={reduced ? {} : { scale: live ? 1 + Math.min(0.22, volumeLevel * 0.3) : [1, 1.05, 1] }}
          transition={live ? { type: "spring", stiffness: 300, damping: 18 } : { duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <circle cx={c} cy={c} r={24} fill={`url(#${id}-core)`} />
          <circle cx={c} cy={c} r={24} fill={`url(#${id}-halo)`} />
          <ellipse cx={c - 7} cy={c - 9} rx={8} ry={5} fill="rgba(255,255,255,0.35)" style={{ filter: "blur(3px)" }} />
        </motion.g>
      </svg>
    </div>
  )
}
