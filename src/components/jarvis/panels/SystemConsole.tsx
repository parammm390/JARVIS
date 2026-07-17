"use client"

// Live telemetry console — every line is a REAL HTTP request this page just made to
// the Finnor OS backend (method, route, status, measured ms). Nothing is scripted:
// the stream moves exactly as fast as the data core actually polls. This is the
// backend↔frontend integration made visible.

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { TerminalSquare } from "lucide-react"
import { onJarvisRequest, type JarvisRequestLog } from "../lib/api"

interface Line extends JarvisRequestLog {
  key: number
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-300"
  if (status === 0) return "text-red-400"
  if (status === 401 || status === 403) return "text-amber-300"
  if (status >= 400) return "text-red-300"
  return "text-cyan-300"
}

export function SystemConsole() {
  const [lines, setLines] = useState<Line[]>([])
  const keyRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      onJarvisRequest((r) => {
        keyRef.current += 1
        setLines((prev) => [...prev, { ...r, key: keyRef.current }].slice(-22))
      }),
    [],
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines])

  return (
    <div className="j-panel j-hud relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label flex items-center gap-2">
          <TerminalSquare className="h-3.5 w-3.5 text-cyan-300" /> Live Telemetry
        </span>
        <span className="j-chip bg-emerald-400/10 text-emerald-300">real requests</span>
      </div>
      <div ref={scrollRef} className="h-[196px] overflow-y-auto px-4 py-2 font-mono text-[10.5px] leading-[1.75]">
        {lines.length === 0 && <div className="text-[color:var(--j-text-faint)]">awaiting first poll…</div>}
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.div
              key={l.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="j-console-line flex gap-2 whitespace-nowrap"
            >
              <span className="text-[color:var(--j-text-faint)]">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span>
              <span className={l.method === "GET" ? "text-sky-300" : "text-violet-300"}>{l.method}</span>
              <span className="min-w-0 flex-1 truncate text-[color:var(--j-text-dim)]">{l.path}</span>
              <span className={statusColor(l.status)}>{l.status || "ERR"}</span>
              <span className="text-[color:var(--j-text-faint)]">{l.ms}ms</span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="flex items-center gap-1 text-cyan-300/70">
          <span>finnor-os</span>
          <span className="jarvis-cursor inline-block h-3 w-[7px] bg-cyan-300/80" />
        </div>
      </div>
    </div>
  )
}
