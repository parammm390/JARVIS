"use client"

// Upgrade of the console's Live Ops strip: rotates through REAL sentences only
// (§7.11) — topConcerns from /api/insights, the newest business event humanized,
// measured API latency, oldest pending-action age. When the API is degraded it
// falls back to the ambient stream, but every line is honestly prefixed "sim ·" —
// the old ticker let ambient lines masquerade as real; this fixes that.

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Volume2, VolumeX } from "lucide-react"
import { useJarvis as useJarvisData, ageMinutes } from "../lib/data-core"

// Ambient fallback pool — same content the console shipped with, now honestly labeled.
export const OPS_STREAM = [
  { icon: "📞", text: "Inbound call answered — sulfur smell, well water, Fort Wayne" },
  { icon: "🧪", text: "Water test booked · Tuesday 10:00 · Maple Ridge Rd" },
  { icon: "💬", text: "Filter-change reminder texted to 3 households" },
  { icon: "📦", text: "RO membranes at reorder threshold — flagged" },
  { icon: "🔎", text: "Competitor scan finished · 4 dealers found near Cedar Falls" },
  { icon: "🧾", text: "Invoice #2481 marked paid · $249 annual maintenance" },
  { icon: "🛡️", text: "PFAS compliance summary generated vs EPA 4 ppt MCL" },
  { icon: "🗓️", text: "Dale Brooks assigned · lead follow-up · 9 River Bend Ct" },
  { icon: "🧠", text: "Renewal window detected — 21 days out · Henderson AMC" },
  { icon: "✉️", text: "Post-install proposal drafted for 3 recent installs" },
]

export function OpsTicker({ soundOn, onToggleSound }: { soundOn: boolean; onToggleSound: () => void }) {
  const data = useJarvisData()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => i + 1), 3200)
    return () => clearInterval(t)
  }, [])

  const degraded = data.statsDegraded && data.readModelsDegraded
  const items = useMemo(() => {
    if (degraded) return OPS_STREAM.map((o) => ({ icon: o.icon, text: `sim · ${o.text}` }))

    const real: Array<{ icon: string; text: string }> = []
    for (const c of data.insights?.topConcerns ?? []) real.push({ icon: "🧠", text: c })
    const latestEvent = data.events[0]
    if (latestEvent) real.push({ icon: "⚡", text: `${latestEvent.eventType.replaceAll("_", " ")} · ${latestEvent.entityType}` })
    if (data.apiLatencyMs != null) real.push({ icon: "📡", text: `API latency ${data.apiLatencyMs}ms — measured this poll` })
    const oldest = data.pendingActions[data.pendingActions.length - 1]
    if (oldest) real.push({ icon: "🕐", text: `Oldest pending: ${oldest.actionType.replaceAll("_", " ")} · ${ageMinutes(oldest.createdAt, data.now)}m` })
    if (real.length === 0) return OPS_STREAM.map((o) => ({ icon: o.icon, text: `sim · ${o.text}` }))
    return real
  }, [degraded, data])

  const item = items[index % items.length]!

  return (
    <div className="relative flex items-center gap-3 overflow-hidden border-b border-white/8 bg-white/[0.03] px-5 py-2.5 backdrop-blur-sm">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-teal-200/90">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" /> Live Ops
      </span>
      <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 truncate text-[12px] font-bold text-white/75"
          >
            <span className="mr-2">{item.icon}</span>
            {item.text}
          </motion.div>
        </AnimatePresence>
      </div>
      <button
        onClick={onToggleSound}
        className="shrink-0 rounded-full border border-white/12 bg-white/5 p-1.5 text-white/60 transition hover:text-white"
        aria-label={soundOn ? "Mute console sounds" : "Unmute console sounds"}
      >
        {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
