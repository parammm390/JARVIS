"use client"

// D3.T3 — flagship 6/8: start_invoice_to_cash_workflow (invoice-to-cash plugin).
// "Cash river: particles invoice→paid, aging narrows."
//
// Real shape note: the top-level payload is just {invoiceId, contactId?, channel} —
// the actual dollar amount only appears inside the async workflow's own step
// payloads (create_payment_link's {amountUsd}, sync_invoice's {amountUsd, memo,
// customerName, customerPhone} — invoice-to-cash/index.ts:109-136), which live on
// workflow_steps, not this action's payload. Rather than fabricate a dollar figure,
// this renders the real 3-stage pipeline (create_payment_link → send_message →
// sync_invoice) as a labeled progress rail and shows amountUsd/memo only when the
// caller actually passes the richer step-shaped object through (e.g. a receipt
// context with the step payload attached).

import { Landmark } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Panel } from "../../primitives/Panel"
import { EASE } from "../../motion/tokens"
import type { ActionRendererProps } from "../types"

interface InvoiceToCashPayload {
  invoiceId?: string
  contactId?: string
  channel?: "sms" | "email"
  amountUsd?: number
  memo?: string
}

const STAGES = ["create payment link", "send message", "sync invoice"] as const

export function InvoiceToCashScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as InvoiceToCashPayload
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <Landmark className="h-3 w-3 shrink-0 text-cyan-300" />
        <span className="truncate text-[color:var(--j-text)]">
          invoice {p.invoiceId ? p.invoiceId.slice(0, 8) : ""}… → cash via {p.channel ?? "sms"}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-cyan-400/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Landmark className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[9px] font-black uppercase tracking-widest text-cyan-300">Invoice → Cash</span>
        {typeof p.amountUsd === "number" && <span className="ml-auto font-black text-[color:var(--j-text)]">${p.amountUsd.toFixed(2)}</span>}
      </div>

      <div className="relative flex items-center justify-between px-1">
        <div className="absolute left-3 right-3 top-3 h-0.5 overflow-hidden rounded-full bg-white/8">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-400/40 via-cyan-300 to-teal-300/40"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={reduced ? { duration: 0 } : { duration: 2.2, repeat: Infinity, ease: EASE.standard }}
          />
        </div>
        {STAGES.map((s, i) => (
          <div key={s} className="relative z-10 flex flex-col items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full border border-cyan-300/50 bg-[#0a1220]" />
            <span className="max-w-[70px] text-center text-[8.5px] leading-tight text-[color:var(--j-text-faint)]">{s}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1 text-[10px] text-[color:var(--j-text-dim)]">
        {p.invoiceId && <span className="rounded-full bg-white/6 px-2 py-0.5 font-mono">invoice {p.invoiceId.slice(0, 8)}…</span>}
        <span className="rounded-full bg-white/6 px-2 py-0.5">via {p.channel ?? "sms"}</span>
      </div>
      {p.memo && <div className="mt-1.5 text-[10px] italic text-[color:var(--j-text-faint)]">{p.memo}</div>}
    </Panel>
  )
}
