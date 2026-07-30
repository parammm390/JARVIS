"use client"

// D1.T3 — the activity theater: real GET /api/activity (A2.T6) via useLiveQuery
// (C1.T2), SSE-first (B1's gateway, real token from the caller's own signed-in
// session — no service account minted) with the honest polling fallback documented
// in useLiveQuery.ts's own header. FLOW-02 CascadeStagger on new items, FLOW-03
// OdometerTicker not applicable here (no single rolling number), click → real
// DecisionReceipt via ReceiptDrawer for the two sources that have one
// (action_log/workflow_step — calls don't carry a receipt, so they're inert).

import { useEffect, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { jarvisClient, type ActivityItem, type ActivityPage } from "@/lib/jarvis-client"
import { useLiveQuery } from "@/lib/jarvis/useLiveQuery"
import { getCurrentAccessToken, useJarvisAuth } from "../lib/jarvis-auth"
import { requestReceiptScene } from "../lib/receipt-nav"
import { flash } from "../lib/EventFX"
import { Enter } from "../ui/motion/primitives"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { METEOR_FLIGHT_MS, publishActivityArrival, registerAnchor } from "../lib/pulse-bus"
import { EmptyState } from "../ui/primitives/EmptyState"
import { PermissionVeil } from "../ui/primitives/PermissionVeil"

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
  const feedRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const seenIdsRef = useRef<Set<string> | null>(null)

  // F2.T1/T2 — this feed is EventMeteor's (FLOW-39) real landing zone: registers its
  // own rect so ParticleField can draw a flight from the orb here without either
  // component knowing the other's DOM.
  useEffect(() => registerAnchor("activity-feed", () => feedRef.current?.getBoundingClientRect() ?? null), [])

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

  const items = useMemo(() => data?.items ?? [], [data])

  // F2.T2 — FLOW-39 EventMeteor's trigger: a genuinely new row, not a re-fetch of
  // rows already shown. The FIRST populated page is baseline, never a meteor storm
  // on mount; every id that appears afterward is real (an SSE frame or a poll that
  // actually changed) and fires exactly one meteor + one delayed row-flash, on the
  // same beat (METEOR_FLIGHT_MS) so the flight visually lands where the glow starts.
  useEffect(() => {
    if (items.length === 0) return
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(items.map((i) => i.id))
      return
    }
    const seen = seenIdsRef.current
    for (const item of items) {
      if (seen.has(item.id)) continue
      publishActivityArrival(item.id)
      const rowEl = rowRefs.current.get(item.id) ?? null
      window.setTimeout(() => flash(rowEl), METEOR_FLIGHT_MS)
    }
    seenIdsRef.current = new Set(items.map((i) => i.id))
  }, [items])

  // F7.T2 — FLOW-95 DrawerToPage: this used to hold `openReceiptId` locally and
  // render its own <ReceiptDrawer> here. The receipt scene now lives in Bridge's
  // CenterStage (a real center-stage swap, not a side panel), so a genuinely
  // resolved receipt id is handed off via receipt-nav's single-listener channel —
  // `rowLayoutId` is the SAME id this row's header wears below, giving
  // framer-motion a real shared element to fly (FLOW-96 ListToDetail), not a
  // fabricated one.
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
      if (receipt) requestReceiptScene({ receiptId: receipt.id, rowLayoutId: `receipt-row-${item.id}` })
    } catch {
      // No receipt reachable (not yet finalized, or none exists) — silently a no-op,
      // never a fake scene.
    }
  }

  if (!session) {
    return (
      <div className="j-panel p-4">
        <PermissionVeil reason="Sign in for the live activity feed — this pulls your own tenant's real events." actionLabel="Sign in" actionHref="/jarvis/login" />
      </div>
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
      <div ref={feedRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3" aria-live="polite" aria-relevant="additions text">
        {items.length === 0 && <EmptyState family="activity" title="No activity yet" description="The feed fills as Finnor works — approvals, workflow steps, and calls all land here." />}
        <AnimatePresence initial={false}>
          {items.map((item) => {
            // D3.T1: action_log rows now carry actionType+payload (GET /api/activity's
            // join into domain_actions) — the SAME ActionRenderer approvals/receipts
            // use, in compact mode. workflow_step/call rows don't have a registered
            // action type (their own taxonomy — StepIcon.tsx/VoiceCallScene cover
            // those elsewhere), so they keep the existing summarize() text.
            const actionType = item.source === "action_log" && typeof item.detail.actionType === "string" ? item.detail.actionType : null
            return (
              <Enter key={item.id} y={-6}>
                <button
                  ref={(el) => {
                    if (el) rowRefs.current.set(item.id, el)
                    else rowRefs.current.delete(item.id)
                  }}
                  type="button"
                  onClick={() => void openReceiptFor(item)}
                  disabled={item.source === "call"}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/6 bg-white/[0.015] px-2.5 py-1.5 text-left j-fs-micro hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-white/[0.015]"
                >
                  {/* F7.T2 — FLOW-96 ListToDetail: this dot shares a layoutId with the
                      receipt scene's header dot (Bridge.tsx's ReceiptScene) — the
                      SAME element genuinely flies from this row to that header when a
                      receipt for this item opens, rather than a plain cut. */}
                  <motion.span layoutId={`receipt-row-${item.id}`} className={`h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_ICON[item.source]}`} />
                  <span className="min-w-0 flex-1 truncate text-[color:var(--j-text)]">
                    {actionType ? <ActionRenderer actionType={actionType} payload={item.detail.payload} compact /> : summarize(item)}
                  </span>
                  <span className="shrink-0 j-fs-micro text-[color:var(--j-text-faint)]">{ageLabel(item.occurredAt)}</span>
                </button>
              </Enter>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
