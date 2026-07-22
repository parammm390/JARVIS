"use client"

// C3.T1 — decrypt/typewriter text reveal. `mode="typewriter"` generalizes the inline
// logic FlowCatalogAmbient.tsx's TypeSpeechDemo (FLOW-16) already hand-rolled —
// extracted here so there's one implementation, not two that can drift; that demo
// now imports from here (see FlowCatalogAmbient.tsx). `mode="decrypt"` is new:
// unrevealed characters scramble through a glyph set before locking to the real
// character, left-to-right.
//
// No Math.random() anywhere (this file lives under src/components/jarvis/**, where
// the repo's own eslintrc bans it — Phase 7 §7.8 anti-fake-metric rule) — scramble
// glyphs come from a small deterministic hash of (tick, charIndex), same technique
// atmosphere.tsx's bubble field already uses for the same reason.
//
// Reduced motion: both modes render the final text immediately, no reveal — and
// exactly like primitives.tsx's <Enter>/<Flight>, the reduced branch is applied only
// inside a post-mount effect, never in the initial render, so SSR (always
// non-reduced) and a reduced-motion client's first paint stay identical. Verified by
// following the identical pattern C2 root-caused and fixed for real via Playwright's
// emulateMedia — not re-deriving that fix, reusing its shape.

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"

const GLYPHS = "!<>-_\\/[]{}—=+*^?#"

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export function DecryptText({
  text,
  mode = "typewriter",
  charMs = 20,
  className,
  cursor = false,
}: {
  text: string
  mode?: "typewriter" | "decrypt"
  charMs?: number
  className?: string
  cursor?: boolean
}) {
  const reduced = useReducedMotion()
  const [revealed, setRevealed] = useState(0)
  const [tick, setTick] = useState(0)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (reduced) {
      setRevealed(text.length)
      return
    }
    setRevealed(0)
    setTick(0)
    const interval = window.setInterval(() => {
      frameRef.current += 1
      setTick(frameRef.current)
      setRevealed((r) => Math.min(text.length, r + 1))
    }, charMs)
    return () => window.clearInterval(interval)
  }, [text, reduced, charMs])

  const display =
    mode === "decrypt"
      ? text
          .split("")
          .map((c, i) => {
            if (i < revealed) return c
            if (c === " ") return " "
            const glyphIndex = Math.floor(hash(tick, i) * GLYPHS.length)
            return GLYPHS[glyphIndex]
          })
          .join("")
      : text.slice(0, revealed)

  return (
    <span className={className} data-fx="decrypt-text" data-mode={mode}>
      {display}
      {cursor && revealed < text.length && <span className="jarvis-cursor">▍</span>}
    </span>
  )
}
