"use client"

// §7.9 — newest business events, colored dot by family, humanized eventType.
import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { LiveDot } from "../atmosphere"
import { useJarvis, onJarvisEvent, ageLabel, type EventRow } from "../lib/data-core"
import { eventPingThrottled } from "../sound"

function familyColor(eventType: string): string {
  if (eventType.startsWith("quote_")) return "bg-violet-400"
  if (eventType.startsWith("appointment_")) return "bg-blue-400"
  if (eventType.startsWith("payment_") || eventType.startsWith("invoice_")) return "bg-green-400"
  if (eventType.startsWith("contact_") || eventType.startsWith("lead_")) return "bg-cyan-400"
  if (eventType.startsWith("work_order_")) return "bg-amber-400"
  return "bg-white/40"
}

export function ActivityRail() {
  const data = useJarvis()
  const pausedRef = useRef(false)
  const queueRef = useRef<EventRow[]>([])
  const [displayEvents, setDisplayEvents] = useState<EventRow[]>(data.events)

  useEffect(() => onJarvisEvent("new-business-event", () => eventPingThrottled()), [])

  useEffect(() => {
    if (pausedRef.current) {
      queueRef.current = data.events
      return
    }
    setDisplayEvents(data.events)
  }, [data.events])

  const items = displayEvents.slice(0, 20)

  return (
    <div
      className="j-panel"
      onMouseEnter={() => {
        pausedRef.current = true
      }}
      onMouseLeave={() => {
        pausedRef.current = false
        if (queueRef.current.length > 0) {
          setDisplayEvents(queueRef.current)
          queueRef.current = []
        }
      }}
    >
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--j-text-dim)]">
          <LiveDot /> System Activity
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {items.length === 0 && <div className="text-[12px] text-[color:var(--j-text-faint)]">No events yet — the timeline fills as Finnor works.</div>}
          {items.map((e) => (
            <motion.div key={e.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-[11px]">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${familyColor(e.eventType)}`} />
              <span className="min-w-0 flex-1 truncate text-[color:var(--j-text)]">{e.eventType.replaceAll("_", " ")}</span>
              <span className="shrink-0 rounded-full bg-white/6 px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--j-text-faint)]">{e.entityType}</span>
              <span className="shrink-0 text-[color:var(--j-text-faint)]">{ageLabel(e.occurredAt, data.now)}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
