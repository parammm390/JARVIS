"use client"

// §7.8 — newest 8 comms (sandbox outbox merged with real communications_log).
import { Mail, MessageSquare, Phone } from "lucide-react"
import { motion } from "framer-motion"
import { LiveDot } from "../atmosphere"
import { useJarvis, ageLabel } from "../lib/data-core"

const CHANNEL_ICON: Record<string, typeof Mail> = { sms: MessageSquare, call: Phone, email: Mail }

function maskNumber(n?: string): string {
  if (!n) return ""
  return n.length > 4 ? `…${n.slice(-4)}` : n
}

export function CommsFeed() {
  const data = useJarvis()
  const items = data.comms.slice(0, 8)
  return (
    <div className="j-panel">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--j-text-dim)]">
          <LiveDot /> Comms
        </div>
        <div className="space-y-2">
          {items.length === 0 && <div className="text-[12px] text-[color:var(--j-text-faint)]">No messages yet.</div>}
          {items.map((c) => {
            const Icon = CHANNEL_ICON[c.channel] ?? MessageSquare
            return (
              <motion.div key={c.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg border border-white/8 bg-white/[0.015] p-2.5">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[color:var(--j-text-dim)]">
                  <Icon className="h-3 w-3" />
                  {c.channel}
                  {c.toNumber && <span className="text-[color:var(--j-text-faint)]">→ {maskNumber(c.toNumber)}</span>}
                  {c.household && <span className="text-[color:var(--j-text-faint)]">· {c.household}</span>}
                  <span className="ml-auto text-[color:var(--j-text-faint)]">{ageLabel(c.createdAt, data.now)}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-[color:var(--j-text)]">{c.content.slice(0, 90)}</div>
                {c.simulated && <span className="mt-1 inline-block rounded-full bg-amber-300/12 px-2 py-0.5 text-[9px] font-black text-amber-200">simulated delivery</span>}
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
