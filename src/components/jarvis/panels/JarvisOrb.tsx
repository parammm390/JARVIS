"use client"

// §7.2 — the identity element. One component, `size` prop: sidebar 64px, command bar
// 44px, call panel 120px. Idle breathing; voice-live speeds the rings + pulses with
// volumeLevel; speaking shifts hue; degraded systemStatus dims and ambers.

import { motion, useReducedMotion } from "framer-motion"

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
  const reduced = useReducedMotion()
  const live = voiceState === "live" || voiceState === "speaking"
  const speaking = voiceState === "speaking"

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: speaking
            ? "radial-gradient(circle at 35% 30%, #5eead4, #0e7490)"
            : degraded
              ? "radial-gradient(circle at 35% 30%, #fbbf24, #78350f)"
              : "radial-gradient(circle at 35% 30%, #22d3ee, #1e3a8a)",
        }}
        animate={reduced ? {} : { scale: live ? [1, 1 + volumeLevel * 0.18, 1] : [1, 1.04, 1] }}
        transition={{ duration: live ? 0.5 : degraded ? 5 : 4, repeat: Infinity, ease: "easeInOut" }}
      />
      {!reduced && (
        <>
          <motion.div
            className="absolute inset-[-15%] rounded-full border"
            style={{ borderColor: speaking ? "rgba(94,234,212,0.4)" : "rgba(34,211,238,0.35)", borderStyle: "dashed" }}
            animate={{ rotate: 360 }}
            transition={{ duration: live ? 6 : degraded ? 30 : 18, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute inset-[-26%] rounded-full border"
            style={{ borderColor: "rgba(59,130,246,0.22)", borderStyle: "dashed" }}
            animate={{ rotate: -360 }}
            transition={{ duration: live ? 10 : degraded ? 44 : 31, repeat: Infinity, ease: "linear" }}
          />
        </>
      )}
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: degraded ? "0 0 24px rgba(251,191,36,0.25)" : `0 0 ${live ? 36 : 22}px rgba(34,211,238,${live ? 0.45 : 0.25})` }}
      />
    </div>
  )
}
