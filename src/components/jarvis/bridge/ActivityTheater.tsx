"use client"

// D1.T3 — the activity theater: real GET /api/activity (A2.T6) via useLiveQuery
// (C1.T2), SSE-first (B1's gateway, real token from the caller's own signed-in
// session — no service account minted) with the honest polling fallback documented
// in useLiveQuery.ts's own header. FLOW-02 CascadeStagger on new items, FLOW-03
// OdometerTicker not applicable here (no single rolling number), click → real
// DecisionReceipt via ReceiptDrawer for the two sources that have one
// (action_log/workflow_step — calls don't carry a receipt, so they're inert).

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { jarvisClient, type ActivityItem, type ActivityPage } from "@/lib/jarvis-client"
import { useLiveQuery } from "@/lib/jarvis/useLiveQuery"
import { getCurrentAccessToken, useJarvisAuth } from "../lib/jarvis-auth"
import { ReceiptDrawer } from "../lib/ReceiptDrawer"
import { Enter } from "../ui/motion/primitives"

const SOURCE_ICON: Record<ActivityItem["source"], string> = {
  action_log: "bg-cyan-400",
  workflow_step: "bg-teal-400",
  call: "bg-violet-400",
}

function summarize(item: ActivityItem): string {
  const d = item.detail
  if (item.source === "action_log") return typeof d.step === "string" ? d.step.replaceAll("_", " ") : "action step"
  if (item.source === "workflow_step") {
    const type = typeof d.stepType === "string" ? d.stepType.replaceAll("_", " ") : "workflow step"
    const status = typeof d.status === "string" ? d.status : ""
    return status ? `${type} — ${status}` : type
  }
  const dir = typeof d.direction === "string" ? d.direction : "call"
  return `${dir} call`
}

function ageLabel(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

function sseUrlFor(): string | undefined {
  const base = process.env.NEXT_PUBLIC_JARVIS_SSE_URL
  if (!base) return undefined
  const token = getCurrentAccessToken()
  if (!token) return undefined
  return `${base}/events?token=${encodeURIComponent(token)}`
}

export function ActivityTheater() {
  const { session } = useJarvisAuth()
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null)

  const { data, connection } = useLiveQuery<ActivityPage, string>({
    sseUrl: sseUrlFor(),
    fetchPage: async (cursor) => {
      const page = await jarvisClient.activity({ since: cursor ?? undefined, limit: 30 })
      return { ...page, cursor: page.nextCursor }
    },
    reduce: (prev, next) => ({
      items: [...next.items, ...(prev?.items ?? [])].slice(0, 40),
      nextCursor: next.nextCursor,
      hasMore: next.hasMore,
    }),
    visibleIntervalMs: 3000,
    blurredIntervalMs: 20000,
    enabled: !!session,
  })

  const items = data?.items ?? []

  async function openReceiptFor(item: ActivityItem): Promise<void> {
    try {
      const query =
        item.source === "action_log" && typeof item.detail.domainActionId === "string"
          ? { domainActionId: item.detail.domainActionId }
          : item.source === "workflow_step"
            ? { workflowStepId: item.id }
            : null
      if (!query) return
      const res = await jarvisClient.receipts(query)
      const receipt = res.receipts[0]
      if (receipt) setOpenReceiptId(receipt.id)
    } catch {
      // No receipt reachable (not yet finalized, or none exists) — silently a no-op,
      // never a fake drawer.
    }
  }

  if (!session) {
    return (
      <div className="j-panel p-4 text-center text-[11px] text-[color:var(--j-text-faint)]">Sign in for the live activity feed</div>
    )
  }

  return (
    <div className="j-panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Activity Theater</span>
        <span className={`j-chip ${connection === "sse" ? "bg-cyan-400/12 text-cyan-300" : connection === "polling" ? "bg-white/6 text-[color:var(--j-text-faint)]" : "bg-white/4 text-[color:var(--j-text-faint)]"}`}>
          {connection}
        </span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {items.length === 0 && <div className="text-[11px] text-[color:var(--j-text-faint)]">No activity yet — the feed fills as Finnor works.</div>}
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <Enter key={item.id} y={-6}>
              <button
                type="button"
                onClick={() => void openReceiptFor(item)}
                disabled={item.source === "call"}
                className="flex w-full items-center gap-2 rounded-lg border border-white/6 bg-white/[0.015] px-2.5 py-1.5 text-left text-[11px] hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-white/[0.015]"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_ICON[item.source]}`} />
                <span className="min-w-0 flex-1 truncate text-[color:var(--j-text)]">{summarize(item)}</span>
                <span className="shrink-0 text-[9px] text-[color:var(--j-text-faint)]">{ageLabel(item.occurredAt)}</span>
              </button>
            </Enter>
          ))}
        </AnimatePresence>
      </div>
      {openReceiptId && <ReceiptDrawer receiptId={openReceiptId} onClose={() => setOpenReceiptId(null)} />}
    </div>
  )
}
