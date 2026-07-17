"use client"

// §7.13 — the movie moment, honest: each checklist line resolves when its REAL first
// fetch settles. Max 2.5s hard cap — whatever hasn't settled shows its real pending
// state and the overlay releases anyway. Runs once per session (sessionStorage).

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { JarvisOrb } from "../panels/JarvisOrb"
import { jarvisGet } from "./api"
import { sfx } from "../sound"

const OS_API = process.env.NEXT_PUBLIC_OS_API_URL

type LineState = "pending" | "settling" | "online" | "standalone"
interface Line {
  id: string
  label: string
  state: LineState
}

const INITIAL_LINES: Line[] = [
  { id: "core", label: "Linking Finnor OS core…", state: "pending" },
  { id: "models", label: "Hydrating operational read models…", state: "pending" },
  { id: "events", label: "Streaming business events…", state: "pending" },
  { id: "gate", label: "Arming approval gate…", state: "pending" },
  { id: "voice", label: "Voice systems standing by.", state: "pending" },
]

const SESSION_KEY = "jarvis_boot_shown"
const HARD_CAP_MS = 2500

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>(INITIAL_LINES)
  const [released, setReleased] = useState(false)

  useEffect(() => {
    sfx.bootHum()
    let cancelled = false
    const settle = (id: string, ok: boolean) => {
      if (cancelled) return
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, state: ok ? "online" : "standalone" } : l)))
    }
    setLines((ls) => ls.map((l) => ({ ...l, state: "settling" })))

    if (OS_API) {
      fetch(`${OS_API}/api/health`, { cache: "no-store" }).then((r) => settle("core", r.ok), () => settle("core", false))
    } else {
      settle("core", false)
    }
    jarvisGet("read-models/pipeline-health").then(() => settle("models", true), () => settle("models", false))
    jarvisGet("events").then(() => settle("events", true), () => settle("events", false))
    jarvisGet("actions/pending", { filter: "pending" }).then(() => settle("gate", true), () => settle("gate", false))
    import("@vapi-ai/web").then(() => settle("voice", true), () => settle("voice", false))

    const cap = setTimeout(() => {
      if (cancelled) return
      setLines((ls) => ls.map((l) => (l.state === "settling" ? { ...l, state: "standalone" } : l)))
      setReleased(true)
    }, HARD_CAP_MS)

    return () => {
      cancelled = true
      clearTimeout(cap)
    }
  }, [])

  useEffect(() => {
    if (lines.every((l) => l.state === "online" || l.state === "standalone")) {
      setReleased(true)
    }
  }, [lines])

  useEffect(() => {
    if (!released) return
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1")
      } catch {}
      onDone()
    }, 400)
    return () => clearTimeout(t)
  }, [released, onDone])

  function skip() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1")
    } catch {}
    onDone()
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#020617]"
        initial={{ opacity: 1 }}
        animate={{ opacity: released ? 0 : 1, scale: released ? 1.04 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        onClick={skip}
        style={{ pointerEvents: released ? "none" : "auto" }}
      >
        <JarvisOrb size={96} voiceState="connecting" />
        <div className="mt-8 space-y-2 text-center">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-[12px]">
              <span className={l.state === "online" ? "text-teal-300" : l.state === "standalone" ? "text-amber-300" : "text-white/30"}>
                {l.state === "online" ? "✓ ONLINE" : l.state === "standalone" ? "— STANDALONE" : "…"}
              </span>
              <span className="text-white/60">{l.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 text-[10px] uppercase tracking-widest text-white/20">Click to skip</div>
      </motion.div>
    </AnimatePresence>
  )
}

export function shouldShowBoot(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== "1"
  } catch {
    return false
  }
}
