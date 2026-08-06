"use client"

// Phase 7 (§7.3) — "one click from any action/answer to its full receipt": evidence,
// citations, policy, expected vs actual, failure + recovery path. Shared by the
// Approval Inbox (ApprovalDock) and the live run timeline (WorkflowTheater) so the
// same honest, complete view backs both entry points.

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { useReducedMotion, motion } from "framer-motion"
import { Tag, User, Calendar, MessageSquare, Wrench, FileText, Package, DollarSign } from "lucide-react"
import { jarvisGet, jarvisPost } from "./api"
import { receiptCopyText, receiptHash } from "./receipt-nav"
import { useLanePresentation } from "../kernel/useSelectorInput"
import { Drawer } from "../ui/primitives/Drawer"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { getRendererEntry } from "../ui/renderers/registry"
import { RiskBadge, type RiskTier } from "../ui/primitives/RiskBadge"
import { Stagger } from "../ui/motion/primitives"
import { FieldList, ThreadVerification, type PredictedOutcome, type PredictionDiff } from "../bridge/ThreadVerification"
import { isSandboxStep, SANDBOX_LITERAL } from "./sandbox-detection"
import { RecoveryPanel } from "../bridge/RecoveryPanel"
import { recoveryKindFromErrorKind } from "../kernel/recovery"
import { CompensationReceipt, compensationReceiptFromActual } from "../bridge/CompensationReceipt"
import { useJarvisAuth } from "./jarvis-auth"
import { isLegalReceiptRecovery, receiptRecoveryVerb } from "./receipt-recovery"

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
  /** Durable receipt→run foreign key returned by the receipt endpoint. A run
   * control also requires the run's current optimistic-lock version, so this is
   * resolved through the existing read-only workflow-runs endpoint before a
   * Retry/Escalate control is exposed. */
  workflowRunId: string | null
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

function resultStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.status === "string" && record.status.trim()) return record.status
  if (record.output && typeof record.output === "object" && !Array.isArray(record.output)) {
    const output = record.output as Record<string, unknown>
    if (typeof output.status === "string" && output.status.trim()) return output.status
  }
  return null
}

function receiptOutcomeLabel(receipt: FullReceipt): string {
  if (receipt.failure) return `Failed · ${receipt.failure.errorKind}`
  if (!receipt.finalizedAt) return "Awaiting recorded outcome"
  const status = resultStatus(receipt.actualResult)
  return status ? `Recorded · ${status}` : "Recorded outcome"
}

type ReceiptRun = { id: string; status: string; version: number }

// D3.T1 — `proposedAction` (declared on FullReceipt but never rendered before this
// session, grepped/confirmed) is always shaped `{stepType, payload}` — every receipt,
// sync or async, is opened by openReceiptForFirstClaim (workflow-runtime/src/
// steps.ts) which sets stepType to the domain action's actual actionType for
// single-step commands (runtime-bridge.ts:92: `stepType: params.actionType`), or to
// a named sub-step for the 4 async workflow-kind types (e.g. hold_appointment —
// StepIcon.tsx's own taxonomy, not one of the 41 registered types). Registered
// stepTypes get the SAME ActionRenderer approvals/feed use; an unregistered one
// (a real sub-step, not a bug) gets a designed one-liner, never raw JSON.
/** `proposedAction` is always `{stepType, payload}` (see this section's own
 *  header comment) — shared by the sandbox-honesty banner above and the
 *  section below, rather than each re-deriving it. Returns "" (never null)
 *  so `isSandboxStep`'s own lookup table simply finds no entry — no separate
 *  null-handling branch needed at either call site. */
function stepTypeOf(proposedAction: unknown): string {
  const obj = proposedAction && typeof proposedAction === "object" ? (proposedAction as Record<string, unknown>) : null
  return obj && typeof obj.stepType === "string" ? obj.stepType : ""
}

function ProposedActionSection({ proposedAction }: { proposedAction: unknown }) {
  const obj = proposedAction && typeof proposedAction === "object" ? (proposedAction as Record<string, unknown>) : null
  const stepType = stepTypeOf(proposedAction) || null
  if (!stepType) return <span className="text-[color:var(--j-text-faint)]">none yet</span>
  if (!getRendererEntry(stepType)) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2 j-fs-micro text-[color:var(--j-text-dim)]">
        {stepType.replaceAll("_", " ")} — workflow sub-step, not a top-level action type
      </div>
    )
  }
  return <ActionRenderer actionType={stepType} payload={obj!.payload} />
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 j-fs-micro font-black uppercase tracking-widest text-[color:var(--j-text-faint)]">{label}</div>
      {children}
    </div>
  )
}

function ReceiptRecoveryPanel({
  receipt,
  run,
  role,
  onReceiptChanged,
}: {
  receipt: FullReceipt
  run: ReceiptRun | null
  role: ReturnType<typeof useJarvisAuth>["role"]
  onReceiptChanged?: () => void
}) {
  const [correcting, setCorrecting] = useState(false)
  const [correctedFact, setCorrectedFact] = useState("")
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const kind = receipt.failure ? recoveryKindFromErrorKind(receipt.failure.errorKind) : null
  const verb = receiptRecoveryVerb(receipt)
  const compensation = compensationReceiptFromActual(receipt.actualResult)
  const onRecover = kind && verb && run && role === "owner" && isLegalReceiptRecovery(verb, run.status)
    ? async () => {
        await jarvisPost(`workflows/runs/${run.id}/${verb}`, { expectedVersion: run.version })
        onReceiptChanged?.()
      }
    : kind === "compensated" && compensation
      ? async () => { document.getElementById(`compensation-${compensation.caseId}`)?.scrollIntoView({ block: "center" }) }
      : kind === "invalid_input" && role === "owner"
        ? async () => { setCorrecting(true) }
      : undefined

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = correctedFact.trim()
    if (!value) return
    setCorrectionError(null)
    try {
      await jarvisPost("corrections", { receiptId: receipt.id, correctedFact: value })
      setCorrectedFact("")
      setCorrecting(false)
      onReceiptChanged?.()
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "Correction request failed")
    }
  }

  // The taxonomy decides the visible label/copy. A callback exists only when the
  // receipt's actual run, current version, legal transition, and owner gate all
  // agree. A compensated receipt can target its already-rendered, backend case
  // record. RecoveryPanel otherwise remains honest and does not render an inert
  // control; the other taxonomy operations need their own contracts.
  if (!kind) return null
  return (
    <div className="space-y-2">
      <RecoveryPanel kind={kind} onRecover={onRecover} errorDetail={receipt.failure!.message} />
      {correcting && (
        <form onSubmit={submitCorrection} className="rounded-xl border border-red-400/25 bg-red-400/5 p-3">
          <textarea
            aria-label="Corrected fact"
            required
            value={correctedFact}
            onChange={(event) => setCorrectedFact(event.target.value)}
            className="min-h-20 w-full rounded-lg border border-white/15 bg-black/20 p-2 j-fs-sm text-white outline-none focus:border-cyan-300/60"
          />
          <div className="mt-2 flex justify-end">
            <button type="submit" className="inline-flex min-h-12 items-center rounded-full border border-red-300/30 px-3 py-1.5 j-fs-micro font-bold text-red-100 hover:border-red-300/60 hover:bg-red-300/10">Correct</button>
          </div>
          {correctionError && <p role="alert" className="mt-2 j-fs-micro text-red-100/80">{correctionError}</p>}
        </form>
      )}
    </div>
  )
}

// F7.T2 — DrawerToPage (FLOW-95) extracted this fetch+render body out of the Drawer
// shell so a second real consumer (bridge/Bridge.tsx's center-stage ReceiptScene)
// can reuse the SAME data path and sections instead of re-implementing them —
// `ReceiptDrawer` below is now a thin `<Drawer>` wrapper around this, byte-identical
// output for every existing call site (DailyBriefing/ApprovalDock/WorkflowTheater/
// ApprovalCockpit's own drawer-only consumers, none of which change in this phase).
export function ReceiptContent({
  receiptId,
  headerLayoutId,
  refreshKey,
}: {
  receiptId: string
  headerLayoutId?: string
  /** jarvis-v3 P4.T5: bump this (e.g. on a real `payment_recorded` business
   *  event matching this thread's own invoice) to re-fetch the SAME receipt
   *  id — "the receipt updates in place" (§6⑦), never a second receipt view
   *  and never a flash back to the loading skeleton for an already-shown one. */
  refreshKey?: number
}) {
  const [receipt, setReceipt] = useState<FullReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receiptRun, setReceiptRun] = useState<ReceiptRun | null>(null)
  const [localRefreshKey, setLocalRefreshKey] = useState(0)
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle")
  const [copyError, setCopyError] = useState<string | null>(null)
  const reducedMotion = useReducedMotion() ?? false
  const { setupStatus } = useLanePresentation()
  const { role } = useJarvisAuth()
  const updateKey = (typeof refreshKey === "number" ? refreshKey : 0) + localRefreshKey

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

  // A receipt exposes its durable run id, while the version belongs to the
  // live-run read model. Resolve the two source-backed facts before rendering
  // a mutation control; do not guess a version from the receipt timestamp.
  useEffect(() => {
    const runId = receipt?.workflowRunId
    if (!runId) {
      setReceiptRun(null)
      return
    }
    let cancelled = false
    void jarvisGet<{ runs: ReceiptRun[] }>("workflows/runs")
      .then(({ runs }) => {
        if (!cancelled) setReceiptRun(runs.find((run) => run.id === runId) ?? null)
      })
      .catch(() => {
        if (!cancelled) setReceiptRun(null)
      })
    return () => { cancelled = true }
  }, [receipt?.workflowRunId])

  // A silent re-fetch of the SAME receipt — no skeleton flash, no clearing the
  // currently-shown data first. A failed silent refresh is swallowed (the
  // already-displayed receipt just stays as it was; the next real poll tries
  // again) rather than replacing good data with an error banner.
  useEffect(() => {
    if (!updateKey) return
    let cancelled = false
    jarvisGet<{ receipt: FullReceipt }>(`receipts/${receiptId}`)
      .then((r) => {
        if (!cancelled) setReceipt(r.receipt)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId, updateKey])

  async function copyReceipt() {
    if (!receipt) return
    const href = new URL(`/jarvis/next${receiptHash(receipt.id)}`, window.location.origin).toString()
    const text = receiptCopyText({ receiptId: receipt.id, objective: receipt.objective, outcome: receiptOutcomeLabel(receipt), href })
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const input = document.createElement("textarea")
        input.value = text
        input.setAttribute("readonly", "")
        input.style.position = "fixed"
        input.style.opacity = "0"
        document.body.appendChild(input)
        input.select()
        const copied = document.execCommand("copy")
        input.remove()
        if (!copied) throw new Error("clipboard unavailable")
      }
      setCopyError(null)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1600)
    } catch {
      setCopyError("Couldn’t copy the receipt summary.")
    }
  }

  return (
    <>
        {error && <div className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 j-fs-micro text-red-300">{error}</div>}

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
              data-liveframe-motion="LF-16"
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
                <div className="j-fs-sm leading-relaxed text-[color:var(--j-text)]">{receipt.objective}</div>
              </Section>
              <div className="flex flex-wrap gap-1">
                <RiskBadge tier={receipt.riskTier as RiskTier} />
                {receipt.policyApplied && (
                  <span className="rounded-full bg-white/8 px-2 py-0.5 j-fs-micro font-black text-white/60">
                    policy {receipt.policyApplied.id.slice(0, 8)} · v{receipt.policyApplied.version}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 j-fs-micro font-black ${receipt.finalizedAt ? "bg-teal-300/12 text-teal-200" : "bg-amber-300/12 text-amber-200"}`}>
                  {receipt.finalizedAt ? "finalized" : "in progress"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="j-fs-micro font-bold text-[color:var(--j-text-dim)]" data-receipt-outcome>{receiptOutcomeLabel(receipt)}</span>
                <button type="button" onClick={() => void copyReceipt()} className="inline-flex min-h-12 items-center rounded-full border border-cyan-300/25 px-3 py-1.5 j-fs-micro font-black text-cyan-100 hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  {copyState === "copied" ? "Receipt copied" : "Copy receipt"}
                </button>
              </div>
              {copyError && <p role="alert" className="mt-2 j-fs-micro text-amber-200">{copyError}</p>}
              {/* jarvis-v3 P4.T6 (§8 PHASE 4) — sandbox honesty: this receipt's
                  own step (create_payment_link/send_message) resolved to a
                  non-real provider. Literal string, never disguised as a real
                  send. `stepTypeOf` mirrors ProposedActionSection's own
                  extraction below — proposedAction is always {stepType, payload}. */}
              {isSandboxStep(stepTypeOf(receipt.proposedAction), setupStatus?.environment?.bindings) && (
                <p className="mt-2 j-fs-micro font-bold text-amber-200/90">{SANDBOX_LITERAL}</p>
              )}
            </motion.div>

            {/* jarvis-v3 P4.T3 — predicted <-> actual (§6⑦), the moat moment: this
                is the SAME section every receipt renders, so a payment webhook
                landing later (P4.T4) and re-fetching this same receipt id makes
                the diff genuinely get truer in place, not a separate view. */}
            <ThreadVerification predicted={receipt.predicted ?? null} predictionDiff={receipt.predictionDiff ?? null} reducedMotion={reducedMotion} refreshKey={updateKey} />
            <CompensationReceipt actualResult={receipt.actualResult} />

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
                              className="inline-flex items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 j-fs-micro text-white/60"
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
                    <div className="j-fs-micro text-[color:var(--j-text-dim)]">
                      {receipt.approval.required ? (receipt.approval.approvedBy ? `approved by ${receipt.approval.approvedBy}` : "awaiting approval") : "no approval required (ungated read)"}
                      {receipt.approval.at ? ` · ${new Date(receipt.approval.at).toLocaleString()}` : ""}
                    </div>
                  </Section>,
                  <Section key="proposed" label="Proposed action">
                    <ProposedActionSection proposedAction={receipt.proposedAction} />
                  </Section>,
                  <Section key="tool-outcome" label="Tool outcome">
                    <div className="j-fs-micro text-[color:var(--j-text-dim)]" data-receipt-tool-outcome>{receiptOutcomeLabel(receipt)}</div>
                  </Section>,
                  <Section key="timing" label="Run timing">
                    <div className="space-y-1 j-fs-micro text-[color:var(--j-text-dim)]" data-receipt-timing>
                      <div>Opened · {new Date(receipt.createdAt).toLocaleString()}</div>
                      <div>{receipt.finalizedAt ? `Finalized · ${new Date(receipt.finalizedAt).toLocaleString()}` : "Still reconciling · no finalized time recorded"}</div>
                    </div>
                  </Section>,
                  <Section key="expected" label="Expected result">
                    <FieldList value={receipt.expectedResult} />
                  </Section>,
                  <Section key="actual" label="Actual result">
                    <FieldList value={receipt.actualResult} />
                  </Section>,
                  receipt.failure ? (
                    <Section key="failure" label="Failure + recovery path">
                      <div className="space-y-2">
                        <div className="j-fs-micro text-red-200/80">backend kind: {receipt.failure.errorKind} · {receipt.failure.recoveryPath}</div>
                        <ReceiptRecoveryPanel receipt={receipt} run={receiptRun} role={role} onReceiptChanged={() => setLocalRefreshKey((key) => key + 1)} />
                      </div>
                    </Section>
                  ) : null,
                ] as ReactNode[]
              ).filter(Boolean)}
            </Stagger>

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
