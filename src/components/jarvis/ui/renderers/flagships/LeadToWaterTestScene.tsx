"use client"

// D3.T3 — flagship 8/8: start_water_test_workflow (lead-to-water-test plugin).
// "Liquid funnel" — the plan's 3-stage async workflow (hold_appointment →
// send_confirmation_call → confirm_appointment, lead-to-water-test/index.ts:76-109)
// rendered as a narrowing funnel, using the real top-level payload fields
// (scheduledAt, phoneNumber, confirmationMessage) that actually exist on the
// approval-gated draft.

import { motion, useReducedMotion } from "framer-motion"
import { Waves } from "lucide-react"
import { Panel } from "../../primitives/Panel"
import { EASE } from "../../motion/tokens"
import { formatDateOnly, formatDateTime } from "../fields"
import type { ActionRendererProps } from "../types"

interface LeadToWaterTestPayload {
  householdId?: string
  technicianId?: string
  scheduledAt?: string
  phoneNumber?: string
  confirmationMessage?: string
}

const STAGES = [
  { label: "hold appointment", width: 100 },
  { label: "send confirmation call", width: 68 },
  { label: "confirm appointment", width: 40 },
]

export function LeadToWaterTestScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as LeadToWaterTestPayload
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <Waves className="h-3 w-3 shrink-0 text-teal-300" />
        <span className="truncate text-[color:var(--j-text)]">
          lead → water test · {p.scheduledAt ? formatDateOnly(p.scheduledAt) : "unscheduled"}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-teal-300/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Waves className="h-3.5 w-3.5 text-teal-300" />
        <span className="text-[9px] font-black uppercase tracking-widest text-teal-300">Lead → Water Test</span>
      </div>

      <div className="mx-auto flex max-w-[220px] flex-col items-center gap-1.5">
        {STAGES.map((s, i) => (
          <motion.div
            key={s.label}
            className="flex h-6 items-center justify-center rounded-md bg-gradient-to-b from-teal-300/25 to-cyan-400/15 text-[9px] font-bold text-teal-100"
            style={{ width: `${s.width}%` }}
            initial={{ opacity: 0, scaleX: 0.8 }}
            animate={{ opacity: 1, scaleX: 1, transition: reduced ? { duration: 0 } : { duration: 0.4, delay: i * 0.12, ease: EASE.decelerate } }}
          >
            {s.label}
          </motion.div>
        ))}
      </div>

      <div className="mt-3 space-y-1 text-[10.5px] text-[color:var(--j-text-dim)]">
        {p.scheduledAt && (
          <div>
            scheduled: <span className="font-black text-[color:var(--j-text)]">{formatDateTime(p.scheduledAt)}</span>
          </div>
        )}
        {p.phoneNumber && <div>phone: {p.phoneNumber}</div>}
      </div>
      {p.confirmationMessage && (
        <div className="mt-2 rounded-lg bg-white/[0.03] p-2 text-[10px] leading-relaxed text-[color:var(--j-text-faint)]">{p.confirmationMessage}</div>
      )}
    </Panel>
  )
}
