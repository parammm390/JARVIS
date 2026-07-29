"use client"

// JARVIS kernel — the store (plan v3 P2.T1/§4.1).
//
// "The kernel wraps lib/data-core.ts; it never replaces it." This file is the
// strangler seam: it mounts the SAME `JarvisDataProvider`/`JarvisAuthProvider`
// P1 already gates every private lane through, and layers the instruction
// machine + presence derivation + (P2-scope, polling-only) transport health on
// top, all built from the pure functions in `machine.ts`/`presence.ts`/
// `transport.ts` so the actual decision logic stays unit-testable without a DOM
// (BLOCKER B-1's own resolution, carried forward from P1).
//
// P2 has no real instruction-event stream yet (P3 adds `instruction_events` and
// `domain_actions.instruction_id` — P3.T1). Until then, this store correlates a
// thread's own approval/execution outcome by set-diffing the kernel's own
// snapshots ("which pending rows/runs are new since this thread's own moment")
// rather than an authoritative backend link. That is honest for the golden
// journey's own stated scope — "one active thread expanded at a time" (§2.3) —
// and is explicitly superseded once P3 ships real per-instruction correlation.
// Every place this matters is commented at the point it happens, not just here.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { JarvisAuthProvider, useJarvisAuth } from "../lib/jarvis-auth"
import { JarvisDataProvider, useJarvis } from "../lib/data-core"
import { useSelectorInput, useLanePresentation, type LanePresentation } from "./useSelectorInput"
import type { SelectorInput } from "./selectors"
import {
  selectCollectedUsd,
  selectOverdueInvoices,
  selectPendingApprovals,
  selectRunsInFlight,
} from "./selectors"
import { initialMachineState, transition, type MachineState } from "./machine"
import { derivePresence } from "./presence"
import { deriveTransportHealth, type TransportHealth } from "./transport"
import {
  getOrCreateSessionId,
  submitInstruction,
  type InstructionSource,
  type PlannedActionResponse,
} from "./instruction"
import type { InstructionState, Presence, Truth } from "./types"

// ---------------------------------------------------------------------------
// Thread shape
// ---------------------------------------------------------------------------

export interface ThreadNode {
  id: string
  actionType: string
  amountUsd: number | null
  targetLabel: string | null
  policyId: string | null
  policyVersion: number | null
  groundedPayload: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>
  payload: Record<string, unknown>
  reasoning?: string
}

export interface ClarificationData {
  question: string
  missingFields: string[]
  context?: string
}

/** P2-scope correlation bookkeeping (see file header). Superseded by P3's real
 *  `domain_actions.instruction_id`.
 *
 *  `enteredAtMs`/`everPendingIds` exist because of a real race found via a live
 *  test against a real tenant (not a hypothetical): the moment the machine
 *  enters `awaiting_approval`, `data.pendingActions` is whatever the fast lane
 *  last polled — possibly from BEFORE this submission, i.e. it does not yet
 *  contain our new node ids at all. Evaluating "is anything still pending"
 *  against that stale snapshot reads as "already fully decided, 0 approved",
 *  which the machine (correctly, given that input) sends to `cancelled` — even
 *  when the real action is a perfectly normal gated approval nobody has looked
 *  at yet, or an ungated action that auto-executed with nothing to approve at
 *  all. `enteredAtMs` gates evaluation until a poll has actually landed since
 *  we started watching; `everPendingIds` remembers which of our own node ids
 *  were EVER actually seen sitting in the pending list, so "never appeared at
 *  all" (auto-executed, ungated) can be told apart from "appeared, then a real
 *  human decision removed it." */
interface ApprovalWatch {
  pendingNodeIds: Set<string>
  approvalsAtStart: number
  rejectionsAtStart: number
  enteredAtMs: number
  everPendingIds: Set<string>
}
interface RunWatch {
  priorRunIds: Set<string>
  correlatedRunIds: Set<string>
}

export interface Thread {
  id: string
  sessionId: string
  source: InstructionSource
  instructionText: string
  createdAtMs: number
  machine: MachineState
  nodes: ThreadNode[]
  clarification: ClarificationData | null
  submitError: string | null
  approvalWatch: ApprovalWatch | null
  runWatch: RunWatch | null
  /** Wall-clock ms the machine reached a terminal state, or null. Drives the 4s
   *  "resolved"/"wounded" presence bloom (§5.3 M15 / §6⑦) via `terminalDecayActive`. */
  terminalAtMs: number | null
  /** True the moment the machine EVER enters "executing", never reset. A
   *  rejected/cancelled thread reaches a terminal state (§4.4) without ever
   *  executing anything — found via a real live test (a rejected approval
   *  still showed a collapsed "Execution: Executed" row, a real truth
   *  violation this field exists to prevent). Gates whether the Execution
   *  block exists in Thread.tsx at all, instead of inferring it from "reached
   *  any terminal state." */
  everExecuted: boolean
}

const TERMINAL_DECAY_MS = 4000

let fallbackIdCounter = 0

// See kernel/instruction.ts's own `uuid()` for why this is a monotonic tiebreaker
// rather than a Math.random() fallback — this repo's ESLint rule bans it outright
// under src/components/jarvis (Phase 7 §7.8).
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  fallbackIdCounter += 1
  return `nocrypto-${Date.now()}-${fallbackIdCounter}`
}

function pickTargetLabel(payload: Record<string, unknown>): string | null {
  for (const key of ["householdLabel", "contactName", "name", "address", "phone"]) {
    const v = payload[key]
    if (typeof v === "string" && v.trim()) return v
  }
  return null
}

function pickAmountUsd(payload: Record<string, unknown>): number | null {
  const v = payload.amountUsd
  return typeof v === "number" ? v : null
}

function nodeFromPlanned(p: PlannedActionResponse): ThreadNode {
  const payload = (p.payload ?? {}) as Record<string, unknown>
  return {
    id: p.id,
    actionType: p.actionType,
    amountUsd: pickAmountUsd(payload),
    targetLabel: pickTargetLabel(payload),
    policyId: p.policyId,
    policyVersion: p.policyVersion ?? null,
    groundedPayload: p.groundedPayload ?? [],
    payload,
    reasoning: p.reasoning,
  }
}

function isTerminal(state: InstructionState): boolean {
  return state === "completed" || state === "partial" || state === "failed" || state === "cancelled"
}

// ---------------------------------------------------------------------------
// Kernel context
// ---------------------------------------------------------------------------

export interface KernelState {
  thread: Thread | null
  presence: Presence
  transport: TransportHealth
  selectorInput: SelectorInput
  lane: LanePresentation
  overdueInvoices: Truth<{ count: number; totalUsd: number }>
  collectedUsd: Truth<number>
  pendingApprovals: Truth<number>
  runsInFlight: Truth<number>
  micOpen: boolean
  voiceSpeaking: boolean
  setVoiceIndicators: (next: { micOpen?: boolean; speaking?: boolean }) => void
  submit: (text: string, source: InstructionSource) => Promise<void>
  answerClarification: (text: string) => Promise<void>
  cancelThread: () => void
}

const KernelContext = createContext<KernelState | null>(null)

export function useKernel(): KernelState {
  const ctx = useContext(KernelContext)
  if (!ctx) throw new Error("useKernel() called outside <KernelProvider>")
  return ctx
}

function KernelInner({ children }: { children: React.ReactNode }) {
  const data = useJarvis()
  const auth = useJarvisAuth()
  const selectorInput = useSelectorInput()
  const lane = useLanePresentation()

  const [thread, setThread] = useState<Thread | null>(null)
  const [micOpen, setMicOpen] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [terminalDecayActive, setTerminalDecayActive] = useState(false)
  const decayTimerRef = useRef<number | null>(null)

  const setVoiceIndicators = useCallback((next: { micOpen?: boolean; speaking?: boolean }) => {
    if (next.micOpen !== undefined) setMicOpen(next.micOpen)
    if (next.speaking !== undefined) setVoiceSpeaking(next.speaking)
  }, [])

  // ---- transport health (P2 scope: polling only, §7.1) ----
  const degradedSinceRef = useRef<number | null>(null)
  useEffect(() => {
    if (data.statsDegraded) {
      if (degradedSinceRef.current === null) degradedSinceRef.current = data.now
    } else {
      degradedSinceRef.current = null
    }
  }, [data.statsDegraded, data.now])
  const degradedForMs = data.statsDegraded && degradedSinceRef.current !== null ? data.now - degradedSinceRef.current : null
  const transport = deriveTransportHealth({ signedIn: !!auth.session, statsDegraded: data.statsDegraded, degradedForMs })

  // ---- terminal decay timer (4s bloom, §5.3 M15) ----
  useEffect(() => {
    if (!thread || !isTerminal(thread.machine.instructionState) || thread.terminalAtMs === null) return
    setTerminalDecayActive(true)
    const elapsed = Date.now() - thread.terminalAtMs
    const remaining = Math.max(0, TERMINAL_DECAY_MS - elapsed)
    if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current)
    decayTimerRef.current = window.setTimeout(() => setTerminalDecayActive(false), remaining)
    return () => {
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.machine.instructionState, thread?.terminalAtMs])

  const presence = derivePresence({
    transport,
    activeInstructionState: thread ? thread.machine.instructionState : null,
    terminalDecayActive,
    voiceSpeaking,
    micOpen,
    blockedCount: data.blockedActions.length,
    needsHumanReviewCount: data.blockedActions.filter((a) => a.status === "needs_human_review").length,
  })

  // ---- approval-watch reconciliation (P2-scope correlation, see file header) ----
  useEffect(() => {
    if (!thread || thread.machine.instructionState !== "awaiting_approval" || !thread.approvalWatch) return
    const watch = thread.approvalWatch

    // Don't evaluate against a pendingActions snapshot older than the moment we
    // started watching — see ApprovalWatch's own doc comment for the real race
    // this guards against.
    if (data.lastPollAtMs === null || data.lastPollAtMs <= watch.enteredAtMs) return

    const currentlyPending = new Set(data.pendingActions.map((a) => a.id))
    const everPendingIds = new Set(watch.everPendingIds)
    for (const id of watch.pendingNodeIds) {
      if (currentlyPending.has(id)) everPendingIds.add(id)
    }
    const stillPending = [...watch.pendingNodeIds].filter((id) => currentlyPending.has(id))

    if (stillPending.length > 0) {
      // Still waiting on at least one real decision — just remember what we've
      // seen pending so far and check again on the next poll.
      if (everPendingIds.size !== watch.everPendingIds.size) {
        setThread((prev) => (prev && prev.id === thread.id ? { ...prev, approvalWatch: { ...watch, everPendingIds } } : prev))
      }
      return
    }

    // Nothing of ours is currently pending. Split into "genuinely gated, and a
    // real decision removed it" vs. "never appeared pending at all" (ungated,
    // auto-executed — nothing for a human to approve, so it counts as approved).
    const neverGatedCount = watch.pendingNodeIds.size - everPendingIds.size
    const sessionApproved = Math.max(0, data.approvalsThisSession - watch.approvalsAtStart)
    const sessionRejected = Math.max(0, data.rejectionsThisSession - watch.rejectionsAtStart)
    const totalDecided = watch.pendingNodeIds.size
    const approvedCount = Math.min(totalDecided, neverGatedCount + sessionApproved)
    const rejectedCount = Math.min(totalDecided - approvedCount, sessionRejected)

    setThread((prev) => {
      if (!prev || prev.id !== thread.id) return prev
      const nextMachine = transition(prev.machine, { type: "APPROVAL_DECIDED", approvedCount, rejectedCount, totalDecided })
      const nowExecuting = nextMachine.instructionState === "executing"
      return {
        ...prev,
        machine: nextMachine,
        approvalWatch: null,
        runWatch: nowExecuting ? { priorRunIds: new Set(data.runs.map((r) => r.id)), correlatedRunIds: new Set() } : prev.runWatch,
        terminalAtMs: isTerminal(nextMachine.instructionState) ? Date.now() : prev.terminalAtMs,
        everExecuted: prev.everExecuted || nowExecuting,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.machine.instructionState, data.pendingActions, data.approvalsThisSession, data.rejectionsThisSession, data.lastPollAtMs])

  // ---- run-watch correlation + terminal detection (P2-scope, see file header) ----
  useEffect(() => {
    if (!thread || thread.machine.instructionState !== "executing" || !thread.runWatch) return
    const watch = thread.runWatch
    const expected = thread.nodes.length
    const newlySeen = data.runs.filter((r) => !watch.priorRunIds.has(r.id) && !watch.correlatedRunIds.has(r.id)).map((r) => r.id)
    const correlated = newlySeen.length > 0 ? new Set([...watch.correlatedRunIds, ...newlySeen]) : watch.correlatedRunIds
    if (correlated.size !== watch.correlatedRunIds.size) {
      setThread((prev) => (prev && prev.id === thread.id ? { ...prev, runWatch: { ...watch, correlatedRunIds: correlated } } : prev))
      return
    }
    if (correlated.size === 0 || correlated.size < expected) return // still waiting for every run to appear
    const relevantTerminal = data.terminalRuns.filter((r) => correlated.has(r.id))
    if (relevantTerminal.length < correlated.size) return // not all correlated runs are terminal yet
    const ok = relevantTerminal.filter((r) => r.status === "completed").length
    const failed = relevantTerminal.length - ok
    setThread((prev) => {
      if (!prev || prev.id !== thread.id) return prev
      const nextMachine = transition(prev.machine, { type: "TERMINAL", ok, failed, total: relevantTerminal.length })
      return { ...prev, machine: nextMachine, runWatch: null, terminalAtMs: isTerminal(nextMachine.instructionState) ? Date.now() : prev.terminalAtMs }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.machine.instructionState, data.runs, data.terminalRuns])

  const runSubmission = useCallback(
    async (text: string, source: InstructionSource, existing: Thread | null) => {
      const sessionId = existing?.sessionId ?? getOrCreateSessionId(source)
      const id = existing?.id ?? newId()
      const nowMs = Date.now()

      // ① HEARD — captured, immediately, with the verbatim text (§6①).
      setThread({
        id,
        sessionId,
        source,
        instructionText: text,
        createdAtMs: nowMs,
        machine: transition(initialMachineState, { type: "SUBMITTED" }),
        nodes: [],
        clarification: null,
        submitError: null,
        approvalWatch: null,
        runWatch: null,
        terminalAtMs: null,
        everExecuted: existing?.everExecuted ?? false,
      })

      let result: Awaited<ReturnType<typeof submitInstruction>>
      try {
        result = await submitInstruction(text, { source, sessionId })
      } catch (err) {
        setThread((prev) =>
          prev && prev.id === id
            ? { ...prev, machine: transition(prev.machine, { type: "SUBMIT_FAILED" }), submitError: err instanceof Error ? err.message : "I couldn't send that." }
            : prev,
        )
        return
      }

      // ② UNDERSTOOD — ACK, then the plan response IS the (unstreamed) context this
      // phase honestly has (§8 Phase 2's own carve-out: real event chips are P3).
      // The real grounded-payload chips populate NOW, not at the planning step —
      // otherwise "understanding" and "planning" would both update in the same
      // tick (one POST response resolves everything at once, with nothing to
      // await between them) and block ② would never actually paint with content,
      // defeating its own purpose. A short, deliberate pause below gives it a
      // real, legible moment on screen before the plan appears — no spinner, no
      // fabricated latency claim, just enough time to read what was found.
      const planned = result.planned
      const clarificationRow = planned.find((p) => p.actionType === "clarification_request")
      const nodesForUnderstanding = planned.map(nodeFromPlanned)
      setThread((prev) =>
        prev && prev.id === id ? { ...prev, machine: transition(prev.machine, { type: "ACK" }), nodes: nodesForUnderstanding } : prev,
      )
      await new Promise((resolve) => setTimeout(resolve, 550))

      setThread((prev) => {
        if (!prev || prev.id !== id) return prev
        let m = transition(prev.machine, { type: "TRACE_planning" })
        if (planned.length === 0) {
          m = transition(m, { type: "PLAN_EMPTY" })
          return { ...prev, machine: m, nodes: [], clarification: null, terminalAtMs: Date.now() }
        }
        if (clarificationRow) {
          const payload = clarificationRow.payload as { question?: string; missingFields?: string[]; context?: string }
          m = transition(m, { type: "TRACE_clarification" })
          return {
            ...prev,
            machine: m,
            nodes: nodesForUnderstanding,
            clarification: {
              question: typeof payload.question === "string" ? payload.question : "I need one more thing to continue.",
              missingFields: Array.isArray(payload.missingFields) ? payload.missingFields.filter((f): f is string => typeof f === "string") : [],
              context: typeof payload.context === "string" ? payload.context : undefined,
            },
          }
        }
        // No clarification: every real business action in this plan requires
        // approval by default (§6⑤: "Every one of these needs your approval") —
        // `defaultPolicy()`'s own requiresConfirmation is `true`, verified at
        // orchestration/src/index.ts:60. The exact per-action gated/ungated split
        // is not yet in this response (`planned[].status` is the planner's
        // pre-execution "draft" value, not the post-gate outcome — verified at
        // orchestration/src/planner.ts:422/`.returning()`); the approval-watch
        // effect above reconciles against the REAL `pendingActions` list the
        // instant the next poll lands, the same bridge `CommandBar.tsx`'s existing
        // `injectOptimisticPending` already relies on. A plan that turns out to be
        // fully ungated self-corrects there rather than getting stuck.
        m = transition(m, { type: "ACTION_pending", count: planned.length })
        const nodes = nodesForUnderstanding
        return {
          ...prev,
          machine: m,
          nodes,
          clarification: null,
          approvalWatch:
            m.instructionState === "awaiting_approval"
              ? {
                  pendingNodeIds: new Set(nodes.map((n) => n.id)),
                  approvalsAtStart: data.approvalsThisSession,
                  rejectionsAtStart: data.rejectionsThisSession,
                  enteredAtMs: Date.now(),
                  everPendingIds: new Set(),
                }
              : null,
        }
      })

      data.injectOptimisticPending(
        planned
          .filter((p) => p.actionType !== "clarification_request")
          .map((p) => ({
            id: p.id,
            actionType: p.actionType,
            summary: null,
            payload: p.payload,
            status: "pending",
            createdAt: p.createdAt,
            groundedPayload: p.groundedPayload ?? undefined,
          })),
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.approvalsThisSession, data.rejectionsThisSession],
  )

  const submit = useCallback((text: string, source: InstructionSource) => runSubmission(text, source, null), [runSubmission])

  const answerClarification = useCallback(
    async (text: string) => {
      // §4.4: "clarifying + ANSWERED -> captured (same thread, new turn)". The
      // SAME thread object continues — no `parentInstructionId` field exists on
      // `SubmitInstructionSchema` (verified: policy-schema/src/index.ts:51-61), so
      // "the thread continues in place" is real because the frontend never spawns
      // a second thread, not because of a backend link; continuity of BUSINESS
      // context comes from resubmitting on the SAME sessionId, which is real
      // (30-min-TTL short-term memory, orchestration/src/index.ts:163-168).
      setThread((prev) => (prev ? { ...prev, machine: transition(prev.machine, { type: "ANSWERED" }) } : prev))
      const current = thread
      if (!current) return
      await runSubmission(text, current.source, current)
    },
    [thread, runSubmission],
  )

  const cancelThread = useCallback(() => {
    setThread((prev) => (prev ? { ...prev, machine: transition(prev.machine, { type: "USER_CANCELLED" }), terminalAtMs: Date.now() } : prev))
  }, [])

  const value = useMemo<KernelState>(
    () => ({
      thread,
      presence,
      transport,
      selectorInput,
      lane,
      overdueInvoices: selectOverdueInvoices(selectorInput),
      collectedUsd: selectCollectedUsd(selectorInput),
      pendingApprovals: selectPendingApprovals(selectorInput),
      runsInFlight: selectRunsInFlight(selectorInput),
      micOpen,
      voiceSpeaking,
      setVoiceIndicators,
      submit,
      answerClarification,
      cancelThread,
    }),
    [thread, presence, transport, selectorInput, lane, micOpen, voiceSpeaking, setVoiceIndicators, submit, answerClarification, cancelThread],
  )

  return <KernelContext.Provider value={value}>{children}</KernelContext.Provider>
}

/** Mounts the full provider stack: auth -> data -> kernel. `/jarvis/next` mounts
 *  exactly one of these; `/jarvis` (legacy) and `/jarvis/bridge` keep their own
 *  existing `JarvisAuthProvider`/`JarvisDataProvider` mounts untouched (§8 hard
 *  rule 9 — both must keep working). */
export function KernelProvider({ children }: { children: React.ReactNode }) {
  return (
    <JarvisAuthProvider>
      <JarvisDataProvider>
        <KernelInner>{children}</KernelInner>
      </JarvisDataProvider>
    </JarvisAuthProvider>
  )
}
