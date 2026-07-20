"use client"

// Phase 7 (§7.6) — the daily briefing: real get_business_overview data (risks,
// overdue work, opportunities, upcoming visits), receipted with real citations
// (GET /api/overview, finnor-os), one click from any figure to the approval inbox
// or the full "Why?" receipt. Not part of the shared fast/medium/slow poller
// (data-core.ts) on purpose — this is an on-demand daily artifact a dealer opens
// once, not a value that should keep minting fresh receipts every few seconds.

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, AlertTriangle } from "lucide-react"
import { jarvisGet } from "../lib/api"
import { hasActiveSession } from "../lib/jarvis-auth"
import { ReceiptDrawer } from "../lib/ReceiptDrawer"

interface OverviewResponse {
  domainActionId: string
  cached: boolean
  spokenSummary?: string
  citations?: Array<{ source: string; ref: string; timestamp: string }>
  leads: { total: number }
  pending: { total: number; awaitingApproval: number; needsHumanReview: number; blockedIntegration: number }
  inventory: { lowStockCount: number; lowStockItems: string[] }
  invoices: { overdueCount: number; overdueTotalUsd: number; unpaidSentCount: number; unpaidSentTotalUsd: number }
  visits: { upcomingCount: number; next: string[] }
}

function WhyBriefingButton({ domainActionId }: { domainActionId: string }) {
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "loading" | "none">("idle")

  async function open() {
    if (state === "loading") return
    setState("loading")
    try {
      const res = await jarvisGet<{ receipts: Array<{ id: string }> }>("receipts", { domainActionId })
      if (res.receipts.length > 0) {
        setReceiptId(res.receipts[0]!.id)
        setState("idle")
      } else {
        setState("none")
      }
    } catch {
      setState("none")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={state === "loading"}
        className="text-[10px] font-black uppercase tracking-wide text-cyan-300/80 hover:text-cyan-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        {state === "loading" ? "Loading…" : state === "none" ? "No receipt yet" : "Why? →"}
      </button>
      {receiptId && <ReceiptDrawer receiptId={receiptId} onClose={() => setReceiptId(null)} />}
    </>
  )
}

export function DailyBriefing() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh: boolean) => {
    if (!hasActiveSession()) return
    setLoading(true)
    setError(null)
    try {
      const res = await jarvisGet<OverviewResponse>("overview", refresh ? { refresh: "1" } : undefined)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the briefing.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  if (!hasActiveSession()) return null

  return (
    <div className="j-panel">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2.5">
        <span className="j-label">Daily Briefing</span>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-full border border-white/12 px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wide text-white/50 transition hover:text-cyan-200 disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <div className="px-4 py-3">
        {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}
        {!data && !error && <div className="h-20 animate-pulse rounded-lg bg-white/5" />}
        {data && (
          <>
            <p className="text-[12px] leading-relaxed text-[color:var(--j-text)]">{data.spokenSummary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <a href="#approval-dock" className="rounded-lg border border-white/8 bg-white/[0.02] p-2 text-center transition hover:border-cyan-300/30">
                <div className="text-lg font-black text-[color:var(--j-text)]">{data.pending.total}</div>
                <div className="text-[9px] uppercase tracking-wide text-[color:var(--j-text-faint)]">pending</div>
              </a>
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 text-center">
                <div className="text-lg font-black text-[color:var(--j-text)]">{data.leads.total}</div>
                <div className="text-[9px] uppercase tracking-wide text-[color:var(--j-text-faint)]">leads</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 text-center">
                <div className={`text-lg font-black ${data.invoices.overdueCount > 0 ? "text-red-300" : "text-[color:var(--j-text)]"}`}>${data.invoices.overdueTotalUsd.toFixed(0)}</div>
                <div className="text-[9px] uppercase tracking-wide text-[color:var(--j-text-faint)]">overdue</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 text-center">
                <div className="text-lg font-black text-[color:var(--j-text)]">{data.visits.upcomingCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-[color:var(--j-text-faint)]">upcoming visits</div>
              </div>
            </div>
            {data.inventory.lowStockCount > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-200">
                <AlertTriangle className="h-3 w-3" /> {data.inventory.lowStockItems.join(", ")}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {data.citations?.map((c, i) => (
                  <span key={i} title={new Date(c.timestamp).toLocaleString()} className="rounded-full bg-white/6 px-2 py-0.5 text-[9px] text-white/50">
                    {c.source}
                  </span>
                ))}
              </div>
              <WhyBriefingButton domainActionId={data.domainActionId} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
