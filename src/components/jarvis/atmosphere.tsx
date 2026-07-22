"use client"

// Cinematic atmosphere layer for the JARVIS console: aurora lighting, film grain,
// rising water bubbles, and a caustic shimmer band. Pure decoration — every element
// is pointer-events-none and aria-hidden; the console works identically without it.

import { motion } from "framer-motion"
import { useMemo } from "react"

// Film grain as an inline SVG turbulence texture — no asset request, ~300 bytes.
// Exported so ui/fx/Glass.tsx (C3.T1) can reuse the identical texture for the
// glass material's noise variant instead of shipping a second data URI.
export const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")"

export function ConsoleAtmosphere() {
  // Deterministic bubble field (no Math.random → no hydration drift).
  const bubbles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${(i * 137) % 100}%`,
        size: 3 + ((i * 53) % 7),
        duration: 11 + ((i * 31) % 12),
        delay: (i * 17) % 14,
        drift: ((i * 29) % 40) - 20,
      })),
    [],
  )

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2rem]">
      {/* deep-water base grade */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_0%,#0a1a33_0%,#050b16_45%,#03141c_100%)]" />

      {/* aurora lighting — three slow-drifting light masses */}
      <motion.div
        className="absolute -left-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-teal-400/14 blur-[110px]"
        animate={{ x: [0, 70, -20, 0], y: [0, 40, 10, 0], scale: [1, 1.15, 0.95, 1] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-52 top-24 h-[30rem] w-[30rem] rounded-full bg-sky-500/12 blur-[120px]"
        animate={{ x: [0, -60, 30, 0], y: [0, 60, -20, 0], scale: [1, 0.9, 1.12, 1] }}
        transition={{ duration: 31, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[-12rem] left-1/3 h-[26rem] w-[36rem] rounded-full bg-indigo-500/10 blur-[130px]"
        animate={{ x: [0, 50, -50, 0], opacity: [0.7, 1, 0.6, 0.7] }}
        transition={{ duration: 37, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* caustic shimmer — a slow diagonal light band, like light through water */}
      <motion.div
        className="absolute inset-y-0 w-[55%] rotate-[18deg] bg-gradient-to-r from-transparent via-teal-200/[0.05] to-transparent"
        animate={{ x: ["-70%", "260%"] }}
        transition={{ duration: 17, repeat: Infinity, ease: "linear" }}
      />

      {/* rising bubbles — the water in the machine */}
      {bubbles.map((b, i) => (
        <motion.span
          key={i}
          className="absolute bottom-[-24px] rounded-full border border-teal-200/25 bg-teal-100/10"
          style={{ left: b.left, width: b.size, height: b.size }}
          animate={{ y: [0, -900], x: [0, b.drift], opacity: [0, 0.7, 0.5, 0] }}
          transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: "linear" }}
        />
      ))}

      {/* grid etching + film grain for texture */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: "linear-gradient(rgba(148,233,222,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148,233,222,.5) 1px, transparent 1px)", backgroundSize: "44px 44px" }}
      />
      <div className="absolute inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />

      {/* vignette grade */}
      <div className="absolute inset-0 bg-[radial-gradient(90%_80%_at_50%_35%,transparent_55%,rgba(2,8,18,0.55)_100%)]" />
    </div>
  )
}

// Exported so ui/fx/Glow.tsx (C3.T1) drives the same tier→shadow mapping on
// non-glass surfaces (badges, buttons) — one glow vocabulary, not two.
export const GLOW_SHADOW: Record<string, string> = {
  cyan: "var(--j-glow-cyan)",
  teal: "var(--j-glow-teal)",
  green: "var(--j-glow-green)",
  red: "var(--j-glow-red)",
  amber: "var(--j-glow-amber)",
  none: "none",
}

/**
 * Glass card with a gradient light-catching border and an optional colored glow.
 * `noise` (C3.T1) layers the same film-grain SVG turbulence ConsoleAtmosphere uses,
 * mixed with `overlay` at low opacity so it reads as material texture rather than
 * visible static — contrast-audited against jarvis-root's two real mood variants
 * (default cyan / standalone amber, see JARVIS-MAESTRO-STATE.md C3 notes).
 */
export function Glass({
  className = "",
  children,
  glow = "none",
  noise = false,
}: {
  className?: string
  children: React.ReactNode
  glow?: "cyan" | "teal" | "green" | "red" | "amber" | "none"
  noise?: boolean
}) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br from-teal-200/25 via-white/[0.07] to-sky-400/20 p-[1px] ${className}`}>
      <div
        className="relative h-full overflow-hidden rounded-[calc(1rem-1px)] bg-[#071120]/85 backdrop-blur-xl transition-shadow duration-300"
        style={{ boxShadow: GLOW_SHADOW[glow] }}
      >
        {noise && (
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}

/** Small teal pulse marking a value as LIVE (read from a real endpoint this render). */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-1.5 w-1.5 ${className}`} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "var(--live-dot-color)" }} />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--live-dot-color)" }} />
    </span>
  )
}
