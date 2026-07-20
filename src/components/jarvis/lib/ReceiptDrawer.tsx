"use client"

// Phase 7 (§7.3) — "one click from any action/answer to its full receipt": evidence,
// citations, policy, expected vs actual, failure + recovery path. Shared by the
// Approval Inbox (ApprovalDock) and the live run timeline (WorkflowTheater) so the
// same honest, complete view backs both entry points.

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { jarvisGet } from "./api"

export interface FullReceipt {
  id: string
  objective: string
  evidence: Array<{ source: string; ref: string; timestamp: string }>
  policyApplied: { id: string; version: number } | null
  riskTier: "low" | "medium" | "high"
  proposedAction: unknown
  approval: { required: boolean; approvedBy?: string; at?: string }
  expectedResult: unknown
  actualResult: unknown
  failure: { errorKind: string; message: string; recoveryPath: string } | null
  correlationId: string | null
  createdAt: string
  finalizedAt: string | null
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-[color:var(--j-text-faint)]">none yet</span>
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-2 font-mono text-[10px] text-[color:var(--j-text-dim)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">{label}</div>
      {children}
    </div>
  )
}

export function ReceiptDrawer({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const [receipt, setReceipt] = useState<FullReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReceipt(null)
    setError(null)
    jarvisGet<{ receipt: FullReceipt }>(`receipts/${receiptId}`)
      .then((r) => {
        if (!cancelled) setReceipt(r.receipt)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load this receipt.")
      })
    return () => {
      cancelled = true
    }
  }, [receiptId])

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="fixed right-0 top-0 z-[61] h-full w-full max-w-md overflow-y-auto border-l border-[color:var(--j-border)] bg-[#070d1a] p-5"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-[color:var(--j-text)]">Why?</h3>
          <button onClick={onClose} className="rounded-full border border-white/12 px-3 py-1 text-xs text-white/60 hover:text-white">
            Close
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}

        {!receipt && !error && (
          <div className="space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
            <div className="h-16 animate-pulse rounded-lg bg-white/5" />
            <div className="h-16 animate-pulse rounded-lg bg-white/5" />
          </div>
        )}

        {receipt && (
          <>
            <Section label="Objective">
              <div className="text-[12px] leading-relaxed text-[color:var(--j-text)]">{receipt.objective}</div>
            </Section>

            <div className="mb-4 flex flex-wrap gap-1">
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black uppercase text-white/60">{receipt.riskTier} risk</span>
              {receipt.policyApplied && (
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/60">
                  policy {receipt.policyApplied.id.slice(0, 8)} · v{receipt.policyApplied.version}
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${receipt.finalizedAt ? "bg-teal-300/12 text-teal-200" : "bg-amber-300/12 text-amber-200"}`}>
                {receipt.finalizedAt ? "finalized" : "in progress"}
              </span>
            </div>

            {receipt.evidence.length > 0 && (
              <Section label="Evidence / citations">
                <div className="flex flex-wrap gap-1">
                  {receipt.evidence.map((e, i) => (
                    <span key={i} title={new Date(e.timestamp).toLocaleString()} className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-white/60">
                      {e.source}:{e.ref}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section label="Approval">
              <div className="text-[11px] text-[color:var(--j-text-dim)]">
                {receipt.approval.required ? (receipt.approval.approvedBy ? `approved by ${receipt.approval.approvedBy}` : "awaiting approval") : "no approval required (ungated read)"}
                {receipt.approval.at ? ` · ${new Date(receipt.approval.at).toLocaleString()}` : ""}
              </div>
            </Section>

            <Section label="Expected result">
              <JsonBlock value={receipt.expectedResult} />
            </Section>

            <Section label="Actual result">
              <JsonBlock value={receipt.actualResult} />
            </Section>

            {receipt.failure && (
              <Section label="Failure + recovery path">
                <div className="rounded-lg border border-red-400/25 bg-red-400/5 p-2 text-[11px] text-red-300">
                  <div className="font-bold">{receipt.failure.errorKind}</div>
                  <div className="mt-1">{receipt.failure.message}</div>
                  <div className="mt-1 text-red-200/80">recovery: {receipt.failure.recoveryPath}</div>
                </div>
              </Section>
            )}

            <div className="font-mono text-[9.5px] text-[color:var(--j-text-faint)]">
              opened {new Date(receipt.createdAt).toLocaleString()}
              {receipt.finalizedAt ? ` · finalized ${new Date(receipt.finalizedAt).toLocaleString()}` : ""}
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
