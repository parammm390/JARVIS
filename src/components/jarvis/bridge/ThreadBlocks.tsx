"use client"

// The Instruction Thread — blocks ①–⑦ (plan v3 §6, P2.T7/T8/T9/T10/T11).
//
// Each block is a plain content component; `Thread.tsx` owns collapse/expand
// (§2.2: "Blocks never disappear. They collapse to a 40 px summary row... and
// re-expand on click") and mounts the shared motions from `kernel/choreography.ts`.

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import type { Thread, ThreadNode } from "../kernel/store"
import { cockpitRiseVariants, contextGatherChipVariants, planDrawNodeVariants, receiptSealVariants } from "../kernel/choreography"
import { sfx, stepCueThrottled } from "../sound"
import { ApprovalCockpit } from "./ApprovalCockpit"
import { WorkflowTheater } from "../panels/WorkflowTheater"
import { ReceiptContent } from "../lib/ReceiptDrawer"
import { useKernel } from "../kernel/store"
import { jarvisGet } from "../lib/api"
import { DecryptText } from "../ui/fx/DecryptText"

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function humanizeActionType(actionType: string): string {
  return actionType
    .replace(/^start_/, "")
    .replace(/_workflow$/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// ① HEARD
// ---------------------------------------------------------------------------
export function ThreadHeard({ thread, onCancel }: { thread: Thread; onCancel: () => void }) {
  const [showCancel, setShowCancel] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShowCancel(true), 800)
    return () => window.clearTimeout(t)
  }, [])
  const failed = thread.machine.instructionState === "failed" && thread.nodes.length === 0 && thread.submitError
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {/* M3 EchoResolve (§5.3): char-scrambled -> resolved L->R, 24ms/char cap.
            Reduced motion renders the final text immediately (DecryptText's own
            contract). */}
        <p className="j-fs-xl font-extrabold text-[color:var(--j-text)]">
          <DecryptText text={thread.instructionText} mode="decrypt" charMs={24} />
        </p>
        {failed && (
          <p className="j-fs-sm mt-2 text-[color:var(--j-red)]">
            {thread.submitError ?? "I couldn't send that."}{" "}
            <button type="button" className="underline" onClick={() => onCancel()}>
              Retry
            </button>
          </p>
        )}
      </div>
      <span className="j-chip shrink-0 border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">{thread.source === "voice" ? "VOICE" : "TYPED"}</span>
      {showCancel && thread.machine.instructionState !== "completed" && thread.machine.instructionState !== "failed" && thread.machine.instructionState !== "partial" && thread.machine.instructionState !== "cancelled" && (
        <button type="button" onClick={onCancel} className="j-fs-sm shrink-0 text-[color:var(--j-text-faint)] hover:text-[color:var(--j-text)]">
          Cancel
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ② UNDERSTOOD — P2 scope: "Context used" from the real plan response
// (groundedPayload), not real streamed per-event chips (that is P3's job — see
// PHASE 2's own "Exact user-visible result" carve-out in the plan).
// ---------------------------------------------------------------------------
export function ThreadUnderstood({ thread, reducedMotion }: { thread: Thread; reducedMotion: boolean }) {
  // jarvis-v3 P3.T7: real chips streamed in from `context_retrieved` trace events
  // (kernel/store.tsx's `applyTraceEvents`) lead the grid — M4 ContextGather fires
  // per chip as it actually arrives. The groundedPayload-derived chips (P2, from
  // the plan response) follow, additive — both are real, from different real
  // sources, never fabricated.
  const groundedChips = useMemo(() => {
    const out: { label: string; source: string }[] = []
    for (const node of thread.nodes) {
      for (const g of node.groundedPayload) {
        out.push({ label: `${g.field} · ${g.status.replace("_", " ")}`, source: "compiled plan · groundEntitiesWithDb" })
      }
    }
    return out
  }, [thread.nodes])
  const chips = useMemo(() => [...thread.contextChips, ...groundedChips], [thread.contextChips, groundedChips])

  // §5.4: "think | `understanding` begins | a single low tick, then silence."
  useEffect(() => {
    sfx.think()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id])

  if (thread.machine.instructionState === "captured") return null

  return (
    <div>
      <div className="j-label mb-2">Context used</div>
      {chips.length === 0 ? (
        <p className="j-fs-sm text-[color:var(--j-text-dim)]">I didn&rsquo;t need any business context for this one.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {chips.map((c, i) => (
            // Real finding via live testing (P3): the groundedPayload-derived
            // chips are genuinely NOT unique by label+source alone — every node
            // sharing the same grounded field name/status (e.g. 6 invoice
            // actions each grounding "invoiceId · verified") produces identical
            // content. The index suffix is safe here because chips only ever
            // APPEND (never reorder or remove mid-list, per applyTraceEvents /
            // this array's own construction), so index+content stays a stable
            // enough identity across renders.
            <motion.div
              key={`${c.label}·${c.source}·${i}`}
              {...contextGatherChipVariants(i, reducedMotion)}
              className="j-chip justify-start border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]"
              title={c.source}
            >
              {c.label}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ③ PLAN
// ---------------------------------------------------------------------------
function policyLine(nodes: ThreadNode[]): string {
  const v0 = nodes.some((n) => n.policyVersion === null || n.policyVersion === 0)
  if (v0) return "No policy is configured for this yet, so I'm defaulting to asking you."
  const first = nodes[0]
  const name = first ? humanizeActionType(first.actionType).toLowerCase().replace(/\s+/g, "_") : "this_action"
  const version = first?.policyVersion ?? 1
  return `Every one of these needs your approval — policy ${name} v${version} requires it for anything that moves money.`
}

export function ThreadPlan({ thread, reducedMotion }: { thread: Thread; reducedMotion: boolean }) {
  const state = thread.machine.instructionState
  if (state === "captured" || state === "understanding") return null
  if (state === "failed" && thread.nodes.length === 0) {
    return (
      <div>
        <div className="j-label mb-2">What I&rsquo;ll do</div>
        <p className="j-fs-base text-[color:var(--j-text)]">I couldn&rsquo;t turn that into anything I can do.</p>
        <p className="j-fs-sm mt-1 text-[color:var(--j-text-dim)]">Try naming a customer, an invoice, or a time window.</p>
      </div>
    )
  }
  return (
    <div>
      <div className="j-label mb-2">What I&rsquo;ll do</div>
      <div className="space-y-2">
        {thread.nodes.map((n, i) => (
          <motion.div
            key={n.id}
            {...planDrawNodeVariants(i, reducedMotion)}
            className="j-panel flex items-center justify-between gap-3 rounded-xl border border-white/8 px-3 py-2.5"
          >
            <span className="j-fs-base text-[color:var(--j-text)]">
              {humanizeActionType(n.actionType)}
              {n.targetLabel ? ` · ${n.targetLabel}` : ""}
            </span>
            {n.amountUsd !== null && <span className="j-fs-base font-bold tabular-nums text-[color:var(--j-green)]">{formatUsd(n.amountUsd)}</span>}
          </motion.div>
        ))}
      </div>
      {thread.nodes.length > 0 && (
        // M6 PolicyClamp (§5.3): a 2px amber bracket draws top->bottom, block
        // shifts right 4px, 300ms EASE_IO.
        <motion.div
          className="relative mt-3 pl-3"
          initial={reducedMotion ? { x: 0 } : { x: -4 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
        >
          <motion.span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[2px]"
            style={{ background: "var(--j-amber)", transformOrigin: "top" }}
            initial={reducedMotion ? { scaleY: 1 } : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
          />
          <p className="j-fs-sm text-[color:var(--j-text-dim)]">{policyLine(thread.nodes)}</p>
        </motion.div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ④ CLARIFY — never Approve/Reject (C-07). Answer/Skip/Cancel only.
// ---------------------------------------------------------------------------
export function ThreadClarify({ thread, onAnswer, onSkip, onCancel }: { thread: Thread; onAnswer: (text: string) => void; onSkip: () => void; onCancel: () => void }) {
  const clarification = thread.clarification
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [why, setWhy] = useState(false)
  // §6④ Sound: "propose at lower pitch" — the SAME shape the cockpit uses, not
  // a second unrelated cue.
  useEffect(() => {
    if (clarification) sfx.propose({ lower: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, Boolean(clarification)])
  if (!clarification) return null

  const submit = () => {
    const text = clarification.missingFields.length <= 1 ? Object.values(answers)[0] ?? "" : clarification.missingFields.map((f) => `${f}: ${answers[f] ?? ""}`).join("; ")
    if (!text.trim()) return
    onAnswer(text)
  }

  return (
    <div>
      <div className="j-label mb-2">I need one thing</div>
      <p className="j-fs-lg font-bold text-[color:var(--j-text)]">{clarification.question}</p>
      <div className="mt-3 space-y-2">
        {clarification.missingFields.map((field, i) => (
          <input
            key={field}
            autoFocus={i === 0}
            value={answers[field] ?? ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [field]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={field}
            className="j-fs-base h-12 w-full rounded-lg border border-white/10 bg-white/[.035] px-3 text-[color:var(--j-text)] outline-none focus:border-cyan-300/50"
          />
        ))}
      </div>
      {clarification.context && (
        <div className="mt-2">
          <button type="button" className="j-fs-sm text-[color:var(--j-text-faint)] underline" onClick={() => setWhy((w) => !w)}>
            Why I&rsquo;m asking
          </button>
          {why && <p className="j-fs-sm mt-1 text-[color:var(--j-text-dim)]">{clarification.context}</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} className="j-chip border border-cyan-300/30 bg-cyan-400/10 text-cyan-200">
          Answer
        </button>
        <button type="button" onClick={onSkip} className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">
          Skip
        </button>
        <button type="button" onClick={onCancel} className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ⑤ APPROVAL — depth 2, `ApprovalCockpit` reused unmodified. The BlastRadius
// header is THIS thread's own real count/amount, layered above the (tenant-
// wide, unscoped) reused component per this session's binding: reuse, don't
// rebuild `ApprovalCockpit`.
// ---------------------------------------------------------------------------
export function ThreadApprovalCockpit({ thread, onClose, reducedMotion }: { thread: Thread; onClose: () => void; reducedMotion: boolean }) {
  const total = thread.nodes.reduce((sum, n) => (n.amountUsd !== null ? sum + n.amountUsd : sum), 0)
  const rise = cockpitRiseVariants(reducedMotion)
  // §5.4: "propose | cockpit rises | two-note rising, brighter."
  useEffect(() => {
    sfx.propose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id])
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pt-[8vh] pb-24"
      style={{ backdropFilter: "blur(20px)" }}
      onMouseDown={onClose}
    >
      {/* M7 CockpitRise (§5.3): translateY(24px)->0, 380ms EASE_OUT. */}
      <motion.div
        initial={rise.initial}
        animate={rise.animate}
        transition={rise.transition}
        className="w-full max-w-[760px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="j-panel mb-3 rounded-xl border border-amber-300/20 px-4 py-3">
          <p className="j-fs-base font-bold text-[color:var(--j-text)]">
            {thread.nodes.length} action{thread.nodes.length === 1 ? "" : "s"} · {formatUsd(total)} · {thread.nodes.length} customer{thread.nodes.length === 1 ? "" : "s"} will be texted
          </p>
        </div>
        <ApprovalCockpit />
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// ⑥ EXECUTION — real `WorkflowTheater`, reused unmodified.
// ---------------------------------------------------------------------------
export function ThreadExecution({ thread }: { thread: Thread }) {
  // §4.7's "one fact, one selector" bans `useJarvis()` outside `kernel/` — this
  // isn't a displayed fact, just sound-cue bookkeeping, but the rule is a
  // blanket ban with no such carve-out. `kernel.selectorInput.runs` is the
  // sanctioned bridge (`useSelectorInput.ts`) exposing the SAME list.
  const kernel = useKernel()
  const stepsSeenRef = useMemoStepTracker(kernel.selectorInput.runs)
  useEffect(() => {
    if (stepsSeenRef.fired) stepCueThrottled()
  }, [stepsSeenRef.fired])
  if (thread.machine.instructionState !== "executing" && thread.machine.instructionState !== "verifying") return null
  return (
    <div>
      <div className="j-label mb-2">Doing it</div>
      <WorkflowTheater />
    </div>
  )
}

// Tiny local hook: fires `stepCueThrottled()` once per newly-completed step
// across any run, without duplicating WorkflowTheater's own step-completed
// bookkeeping. Kept file-local (§0.1 permits a small inline helper).
function useMemoStepTracker(runs: { steps: { id: string; status: string }[] }[]) {
  const [fired, setFired] = useState(0)
  const seenRef = useMemoRef(new Set<string>())
  useEffect(() => {
    let newlyDone = false
    for (const run of runs) {
      for (const step of run.steps) {
        if (step.status === "completed" && !seenRef.current.has(step.id)) {
          seenRef.current.add(step.id)
          newlyDone = true
        }
      }
    }
    if (newlyDone) setFired((f) => f + 1)
  }, [runs, seenRef])
  return { fired }
}

function useMemoRef<T>(initial: T): { current: T } {
  const ref = useState(() => ({ current: initial }))[0]
  return ref
}

// `ReceiptContent` (T11's reuse target) fetches by `decisionReceipts.id` via
// `GET /api/receipts/:id` — NOT the same id as a `domain_action`. The response
// this phase has never carries that receipt id directly, but the real,
// allowlisted `GET /api/receipts?domainActionId=` lookup (verified:
// `finnor-os/apps/api/app/api/receipts/route.ts`) resolves it — one extra real
// fetch per node, once the thread is terminal, no fabrication.
function useNodeReceiptIds(nodeIds: string[], enabled: boolean): Record<string, string> {
  const [ids, setIds] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void Promise.all(
      nodeIds.map(async (nodeId) => {
        if (ids[nodeId]) return
        try {
          const res = await jarvisGet<{ receipts: Array<{ id: string }> }>("receipts", { domainActionId: nodeId })
          const first = res.receipts[0]
          if (first && !cancelled) setIds((prev) => ({ ...prev, [nodeId]: first.id }))
        } catch {
          // No receipt yet for this node (e.g. it never reached execution) —
          // the honest fallback (no deep-link for that node) below handles it.
        }
      }),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds.join(","), enabled])
  return ids
}

// ---------------------------------------------------------------------------
// ⑦ RECEIPT
// ---------------------------------------------------------------------------
export function ThreadReceipt({ thread, reducedMotion }: { thread: Thread; reducedMotion: boolean }) {
  const state = thread.machine.instructionState
  const isTerminal = state === "completed" || state === "partial" || state === "failed" || state === "cancelled"
  useEffect(() => {
    if (isTerminal && (state === "completed" || state === "partial")) sfx.seal()
  }, [isTerminal, state])
  const nodeIds = useMemo(() => thread.nodes.map((n) => n.id), [thread.nodes])
  const receiptIds = useNodeReceiptIds(nodeIds, isTerminal)
  if (!isTerminal) return null

  if (state === "cancelled") {
    return (
      <div>
        <div className="j-label mb-2">What actually happened</div>
        <p className="j-fs-base text-[color:var(--j-text-dim)]">Cancelled — nothing was sent.</p>
      </div>
    )
  }

  const outcome = state === "completed" ? "sent" : state === "partial" ? "partly sent" : "couldn't be sent"

  return (
    <motion.div {...receiptSealVariants(reducedMotion)}>
      <div className="j-label mb-2">What actually happened</div>
      <p className="j-fs-base text-[color:var(--j-text)]">
        {thread.nodes.length} of {thread.nodes.length} action{thread.nodes.length === 1 ? "" : "s"} {outcome}.
      </p>
      <ul className="mt-3 space-y-1">
        {thread.nodes.map((n) =>
          receiptIds[n.id] ? (
            <li key={n.id}>
              <a href={`/jarvis/next#receipt-${receiptIds[n.id]}`} id={`receipt-${receiptIds[n.id]}`} className="j-fs-sm text-[color:var(--j-text-dim)] underline hover:text-cyan-200">
                {humanizeActionType(n.actionType)}
                {n.targetLabel ? ` · ${n.targetLabel}` : ""}
                {n.amountUsd !== null ? ` · ${formatUsd(n.amountUsd)}` : ""} — Copy receipt
              </a>
            </li>
          ) : (
            <li key={n.id} className="j-fs-sm text-[color:var(--j-text-dim)]">
              {humanizeActionType(n.actionType)}
              {n.targetLabel ? ` · ${n.targetLabel}` : ""}
              {n.amountUsd !== null ? ` · ${formatUsd(n.amountUsd)}` : ""}
            </li>
          ),
        )}
      </ul>
      {thread.nodes[0] && receiptIds[thread.nodes[0].id] && (
        <div className="j-panel mt-3 rounded-xl border border-white/8 p-3">
          {/* jarvis-v3 P4.T5: receiptRefreshTick bumps when the kernel's own
              payment-watch effect sees a real payment_recorded event for one
              of this thread's invoices — the SAME receipt re-fetches in
              place, no new view, no fresh page load required. */}
          <ReceiptContent receiptId={receiptIds[thread.nodes[0].id]!} refreshKey={thread.receiptRefreshTick} />
        </div>
      )}
    </motion.div>
  )
}
