"use client"

// Phase 7 (§7.3) — "one click from any action/answer to its full receipt": evidence,
// citations, policy, expected vs actual, failure + recovery path. Shared by the
// Approval Inbox (ApprovalDock) and the live run timeline (WorkflowTheater) so the
// same honest, complete view backs both entry points.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { useReducedMotion, motion } from "framer-motion"
import { Tag, User, Calendar, MessageSquare, Wrench, FileText, Package, DollarSign } from "lucide-react"
import { jarvisGet } from "./api"
import { Drawer } from "../ui/primitives/Drawer"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { getRendererEntry } from "../ui/renderers/registry"
import { RiskBadge, type RiskTier } from "../ui/primitives/RiskBadge"
import { Stagger } from "../ui/motion/primitives"
import { FieldList, ThreadVerification, type PredictedOutcome, type PredictionDiff } from "../bridge/ThreadVerification"

// F3.T3 — FLOW-58's sibling receipt-depth task: evidence source iconography. A
// keyword lookup against the REAL `source` string every evidence row already
// carries (packages/shared-types' DecisionReceipt) — never a fabricated taxonomy,
// just a designed icon instead of the bare source string for the common families;
// an unmatched source still renders honestly (its own text label), just no icon.
const SOURCE_ICON: Array<{ match: RegExp; Icon: typeof Tag }> = [
  { match: /price.?book|pricing/i, Icon: DollarSign },
  { match: /crm|lead|household|customer/i, Icon: User },
  { match: /schedul|visit|appointment/i, Icon: Calendar },
  { match: /sms|communicat|notify|message/i, Icon: MessageSquare },
  { match: /technician|maintenance|equipment/i, Icon: Wrench },
  { match: /inventory|stock|part/i, Icon: Package },
  { match: /tag|label/i, Icon: Tag },
]
function sourceIcon(source: string) {
  return SOURCE_ICON.find((s) => s.match.test(source))?.Icon ?? FileText
}

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
  /** jarvis-v3 P4.T1: the plugin's own simulate() prediction and its field-level
   *  diff against the real outcome, joined server-side from this receipt's own
   *  domain_action. Both null when no real simulate() ran for this action type
   *  — the honest "No prediction was recorded" case, never a fabricated one. */
  predicted?: PredictedOutcome | null
  predictionDiff?: PredictionDiff | null
}

// D3.T1 — `proposedAction` (declared on FullReceipt but never rendered before this
// session, grepped/confirmed) is always shaped `{stepType, payload}` — every receipt,
// sync or async, is opened by openReceiptForFirstClaim (workflow-runtime/src/
// steps.ts) which sets stepType to the domain action's actual actionType for
// single-step commands (runtime-bridge.ts:92: `stepType: params.actionType`), or to
// a named sub-step for the 4 async workflow-kind types (e.g. hold_appointment —
// StepIcon.tsx's own taxonomy, not one of the 41 registered types). Registered
// stepTypes get the SAME ActionRenderer approvals/feed use; an unregistered one
// (a real sub-step, not a bug) gets a designed one-liner, never raw JSON.
function ProposedActionSection({ proposedAction }: { proposedAction: unknown }) {
  const obj = proposedAction && typeof proposedAction === "object" ? (proposedAction as Record<string, unknown>) : null
  const stepType = obj && typeof obj.stepType === "string" ? obj.stepType : null
  if (!stepType) return <span className="text-[color:var(--j-text-faint)]">none yet</span>
  if (!getRendererEntry(stepType)) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[11px] text-[color:var(--j-text-dim)]">
        {stepType.replaceAll("_", " ")} — workflow sub-step, not a top-level action type
      </div>
    )
  }
  return <ActionRenderer actionType={stepType} payload={obj!.payload} />
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">{label}</div>
      {children}
    </div>
  )
}

// F7.T2 — DrawerToPage (FLOW-95) extracted this fetch+render body out of the Drawer
// shell so a second real consumer (bridge/Bridge.tsx's center-stage ReceiptScene)
// can reuse the SAME data path and sections instead of re-implementing them —
// `ReceiptDrawer` below is now a thin `<Drawer>` wrapper around this, byte-identical
// output for every existing call site (DailyBriefing/ApprovalDock/WorkflowTheater/
// ApprovalCockpit's own drawer-only consumers, none of which change in this phase).
export function ReceiptContent({ receiptId, headerLayoutId }: { receiptId: string; headerLayoutId?: string }) {
  const [receipt, setReceipt] = useState<FullReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reducedMotion = useReducedMotion() ?? false

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
    <>
        {error && <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">{error}</div>}

        {!receipt && !error && (
          <div className="space-y-3">
            <div className="jarvis-skeleton-tide h-4 w-2/3 rounded bg-white/5" />
            <div className="jarvis-skeleton-tide h-16 rounded-lg bg-white/5" style={{ "--tide-delay": "120ms" } as CSSProperties} />
            <div className="jarvis-skeleton-tide h-16 rounded-lg bg-white/5" style={{ "--tide-delay": "240ms" } as CSSProperties} />
          </div>
        )}

        {receipt && (
          <>
            {/* F3.T3 — risk material header: RiskBadge's own three real materials
                (green glass / amber steel / red obsidian, C3) replace the plain pill,
                with a faint tier-matched wash behind the whole header — presentation
                of the SAME riskTier the receipt already carries, no new data.
                F7.T2 — FLOW-96 ListToDetail: when a Bridge-side caller supplies
                `headerLayoutId` (the same id it put on the originating feed row),
                this header becomes the OTHER end of that shared-layout id, so
                framer-motion genuinely flies/morphs the row into this header instead
                of a plain cut. Undefined (every existing Drawer-only call site) is a
                no-op layoutId — byte-identical output, confirmed by the snapshot
                suite below. */}
            <motion.div
              layoutId={headerLayoutId}
              className="-mx-5 -mt-5 mb-4 border-b border-white/6 px-5 pb-4 pt-5"
              style={{
                background:
                  receipt.riskTier === "high"
                    ? "linear-gradient(180deg, rgba(248,113,113,0.08), transparent)"
                    : receipt.riskTier === "medium"
                      ? "linear-gradient(180deg, rgba(245,185,66,0.08), transparent)"
                      : "linear-gradient(180deg, rgba(52,211,153,0.06), transparent)",
              }}
            >
              <Section label="Objective">
                <div className="text-[12px] leading-relaxed text-[color:var(--j-text)]">{receipt.objective}</div>
              </Section>
              <div className="flex flex-wrap gap-1">
                <RiskBadge tier={receipt.riskTier as RiskTier} />
                {receipt.policyApplied && (
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black text-white/60">
                    policy {receipt.policyApplied.id.slice(0, 8)} · v{receipt.policyApplied.version}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${receipt.finalizedAt ? "bg-teal-300/12 text-teal-200" : "bg-amber-300/12 text-amber-200"}`}>
                  {receipt.finalizedAt ? "finalized" : "in progress"}
                </span>
              </div>
            </motion.div>

            {/* jarvis-v3 P4.T3 — predicted <-> actual (§6⑦), the moat moment: this
                is the SAME section every receipt renders, so a payment webhook
                landing later (P4.T4) and re-fetching this same receipt id makes
                the diff genuinely get truer in place, not a separate view. */}
            <ThreadVerification predicted={receipt.predicted ?? null} predictionDiff={receipt.predictionDiff ?? null} reducedMotion={reducedMotion} />

            {/* F3.T3 — stagger-unfurl: the remaining sections cascade in (30ms/item,
                <Stagger>, C2's own primitive) instead of all appearing at once —
                presentation only, same data, same order. */}
            <Stagger staggerMs={45} className="space-y-0">
              {(
                [
                  receipt.evidence.length > 0 ? (
                    <Section key="evidence" label="Evidence / citations">
                      <div className="flex flex-wrap gap-1">
                        {receipt.evidence.map((e, i) => {
                          const Icon = sourceIcon(e.source)
                          return (
                            <span
                              key={i}
                              title={new Date(e.timestamp).toLocaleString()}
                              className="inline-flex items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-white/60"
                            >
                              <Icon className="h-2.5 w-2.5 shrink-0" />
                              {e.source}:{e.ref}
                            </span>
                          )
                        })}
                      </div>
                    </Section>
                  ) : null,
                  <Section key="approval" label="Approval">
                    <div className="text-[11px] text-[color:var(--j-text-dim)]">
                      {receipt.approval.required ? (receipt.approval.approvedBy ? `approved by ${receipt.approval.approvedBy}` : "awaiting approval") : "no approval required (ungated read)"}
                      {receipt.approval.at ? ` · ${new Date(receipt.approval.at).toLocaleString()}` : ""}
                    </div>
                  </Section>,
                  <Section key="proposed" label="Proposed action">
                    <ProposedActionSection proposedAction={receipt.proposedAction} />
                  </Section>,
                  <Section key="expected" label="Expected result">
                    <FieldList value={receipt.expectedResult} />
                  </Section>,
                  <Section key="actual" label="Actual result">
                    <FieldList value={receipt.actualResult} />
                  </Section>,
                  receipt.failure ? (
                    <Section key="failure" label="Failure + recovery path">
                      <div className="rounded-lg border border-red-400/25 bg-red-400/5 p-2 text-[11px] text-red-300">
                        <div className="font-bold">{receipt.failure.errorKind}</div>
                        <div className="mt-1">{receipt.failure.message}</div>
                        <div className="mt-1 text-red-200/80">recovery: {receipt.failure.recoveryPath}</div>
                      </div>
                    </Section>
                  ) : null,
                ] as ReactNode[]
              ).filter(Boolean)}
            </Stagger>

            <div className="mt-4 font-mono text-[9.5px] text-[color:var(--j-text-faint)]">
              opened {new Date(receipt.createdAt).toLocaleString()}
              {receipt.finalizedAt ? ` · finalized ${new Date(receipt.finalizedAt).toLocaleString()}` : ""}
            </div>
          </>
        )}
    </>
  )
}

export function ReceiptDrawer({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  return (
    <Drawer title="Why?" onClose={onClose}>
      <ReceiptContent receiptId={receiptId} />
    </Drawer>
  )
}
