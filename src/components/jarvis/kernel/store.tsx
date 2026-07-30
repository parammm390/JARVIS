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
import { JarvisDataProvider, useJarvis, type EventRow } from "../lib/data-core"
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
import { deriveTransportHealth, startInstructionTransport, type InstructionTransportHandle, type SseHealth, type TransportHealth } from "./transport"
import { jarvisGet } from "../lib/api"
import {
  getOrCreateSessionId,
  mintInstructionId,
  submitInstruction,
  type InstructionSource,
  type PlannedActionResponse,
  type TraceEvent,
} from "./instruction"
import type { InstructionState, Presence, Truth } from "./types"
import { looksLikeFollowUpReference, UNRESOLVED_REFERENCE_MESSAGE, UNRESOLVED_REFERENCE_CONTEXT } from "./followup-reference"

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

/** jarvis-v3 P3.T7: one real chip from a `context_retrieved` trace event's own
 *  `{label, count, source}` — never memory contents (this session's own binding
 *  rule; `label`/`source` are the ONLY strings this ever carries). */
export interface ContextChip {
  label: string
  source: string
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
  /** jarvis-v3 P3.T6: this submission's own client-minted trace id — the SAME id
   *  sent in POST /api/actions's body and polled via GET /api/instructions/:id/events.
   *  Null only for a thread this file's own unit tests construct without it. */
  instructionId: string | null
  source: InstructionSource
  instructionText: string
  createdAtMs: number
  machine: MachineState
  nodes: ThreadNode[]
  /** jarvis-v3 P3.T7: real chips from `context_retrieved` trace events, streamed in
   *  as they arrive (M4 ContextGather) — additive to (never replacing) the
   *  groundedPayload-derived chips `ThreadUnderstood` already rendered in P2. */
  contextChips: ContextChip[]
  /** jarvis-v3 P3.T7/T8: real per-action gating bookkeeping derived ENTIRELY from
   *  `instruction_events` (`plan_ready`'s count, `action_gated`/`executing`/
   *  `completed`/`failed`'s own actionId) — not rendered by any block directly.
   *  Exists so the aggregate awaiting_approval/executing transition can be derived
   *  from the trace ALONE, which is what makes T8's restore-after-refresh able to
   *  reach `awaiting_approval` with no POST response to fall back on (a fresh page
   *  load never has one). The live path's own POST-completion handler
   *  (`runSubmission`) remains the primary, redundant driver of this same
   *  transition — `transition()`'s own idempotency makes firing it from both
   *  places safe. */
  traceGating: { expectedCount: number | null; resolvedActionIds: string[]; gatedActionIds: string[] }
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
  /** jarvis-v3 P4.T5: bumped whenever the payment-watch effect below sees a
   *  real `payment_recorded` business event for one of this thread's own
   *  invoices — `ThreadReceipt` passes it straight through as
   *  `ReceiptContent`'s `refreshKey`, so the SAME already-shown receipt
   *  re-fetches and "gets truer over time" (§6⑦) without a fresh page load. */
  receiptRefreshTick: number
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

/** jarvis-v3 P3.T7: a THIN node from a real `action_created` trace event — only
 *  `id`/`actionType` are known this early (amountUsd/targetLabel/policy/
 *  groundedPayload arrive later, from the POST response's own richer
 *  PlannedActionResponse). `ThreadPlan` already renders amountUsd/targetLabel
 *  conditionally (§6③), so a thin node just shows its action type until
 *  `enrichNodesFromPlanned` (below) fills the rest in — a real, honest interim
 *  state, never a fabricated placeholder value. */
function thinNodeFromTraceEvent(payload: Record<string, unknown>): ThreadNode | null {
  const id = typeof payload.actionId === "string" ? payload.actionId : null
  const actionType = typeof payload.actionType === "string" ? payload.actionType : null
  if (!id || !actionType) return null
  return {
    id,
    actionType,
    amountUsd: null,
    targetLabel: null,
    policyId: null,
    policyVersion: null,
    groundedPayload: [],
    payload: {},
  }
}

/** Upgrades any thin (trace-created) nodes in place with the POST response's fuller
 *  data, matched by id; appends any node the POST response has that the trace never
 *  delivered (the trace poll's own safety net — see kernel/instruction.ts's header
 *  on why a GATED plan's trace can legitimately stop early). Never drops a node,
 *  never reorders one the user has already seen. */
function enrichNodesFromPlanned(existing: ThreadNode[], planned: PlannedActionResponse[]): ThreadNode[] {
  const byId = new Map(planned.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const upgraded = existing.map((node) => {
    seen.add(node.id)
    const full = byId.get(node.id)
    return full ? nodeFromPlanned(full) : node
  })
  const appended = planned.filter((p) => !seen.has(p.id)).map(nodeFromPlanned)
  return [...upgraded, ...appended]
}

function isTerminal(state: InstructionState): boolean {
  return state === "completed" || state === "partial" || state === "failed" || state === "cancelled"
}

/** jarvis-v3 P4.T5 — the pure part of the payment-watch effect below, so the
 *  "which invoiceIds does this thread care about, which real events actually
 *  match one of them" logic is unit-testable without a DOM (BLOCKER B-1). */
export function invoiceIdsForThread(nodes: ThreadNode[]): Set<string> {
  return new Set(nodes.map((n) => (typeof n.payload.invoiceId === "string" ? n.payload.invoiceId : null)).filter((v): v is string => v !== null))
}

export function findRelevantPaymentEvents(events: EventRow[], invoiceIds: Set<string>, seenEventIds: Set<string>): EventRow[] {
  if (invoiceIds.size === 0) return []
  return events.filter((e) => {
    if (e.entityType !== "payment" || seenEventIds.has(e.id)) return false
    const payload = e.payload && typeof e.payload === "object" ? (e.payload as { invoiceId?: unknown }) : {}
    return typeof payload.invoiceId === "string" && invoiceIds.has(payload.invoiceId)
  })
}

// ---------------------------------------------------------------------------
// P3.T8 — restore-after-refresh (§7.1/§8 PHASE 3: "non-terminal instructionId in
// sessionStorage -> refetch -> resume the thread mid-flight").
// ---------------------------------------------------------------------------

const ACTIVE_THREAD_STORAGE_KEY = "jarvis.thread.active"

export interface ActiveThreadPointer {
  id: string
  sessionId: string
  instructionId: string
  source: InstructionSource
  instructionText: string
  createdAtMs: number
}

/** Persisted the instant a thread is born (① HEARD) — sessionStorage, not
 *  localStorage, matching kernel/instruction.ts's own session-id convention (a
 *  genuinely new browser tab starts fresh, a refresh of THIS tab does not). */
export function persistActiveThreadPointer(p: ActiveThreadPointer): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Private-mode storage denial: the thread still works this tab session, it
    // just will not survive a refresh — never a crash.
  }
}

export function readActiveThreadPointer(): ActiveThreadPointer | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_THREAD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActiveThreadPointer>
    if (
      typeof parsed.id === "string" &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.instructionId === "string" &&
      (parsed.source === "voice" || parsed.source === "typed") &&
      typeof parsed.instructionText === "string" &&
      typeof parsed.createdAtMs === "number"
    ) {
      return parsed as ActiveThreadPointer
    }
    return null
  } catch {
    return null
  }
}

export function clearActiveThreadPointer(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY)
  } catch {
    // see persistActiveThreadPointer
  }
}

/** jarvis-v3 P3.T7/T8: the two live counters `ApprovalWatch` needs to tell "this
 *  many decisions happened since we started watching" apart from history — supplied
 *  by the caller (real `data.approvalsThisSession`/`rejectionsThisSession`) rather
 *  than closed over, so this whole file stays a pure function over an explicit
 *  input (BLOCKER B-1's own established pattern). */
export interface TraceApprovalContext {
  approvalsThisSession: number
  rejectionsThisSession: number
}

/** jarvis-v3 P3.T7/T8: folds a batch of real `instruction_events` rows into a
 *  Thread — what makes ② UNDERSTOOD's chips and ③ PLAN's nodes stream in as
 *  `handleInstruction` actually does the work (M4/M5), instead of waiting for the
 *  whole POST to resolve. ALSO derives the aggregate awaiting_approval/executing
 *  transition (and its approvalWatch/runWatch side-registration) from the trace
 *  alone, once `plan_ready`'s count and every action's own `action_gated` or
 *  terminal (`completed`/`failed`) outcome have arrived — the live path's POST
 *  response remains a redundant second driver of the SAME transition
 *  (`runSubmission`'s completion handler); `transition()`'s own idempotency makes
 *  firing it from both places safe. This second driver is NOT redundant for T8's
 *  restore-after-refresh, which has no POST response to fall back on at all. */
/** jarvis-v3 P5.T5 (V8) — a genuinely empty plan (0 actions, no clarification)
 *  for an instruction that reads like a follow-up reference gets an honest,
 *  narrower message than the generic empty-plan copy — never a fabricated
 *  resolution, and never the misleading "I couldn't turn that into anything I
 *  can do" for what was specifically an unresolved reference (real live
 *  finding this session: e2e/jarvis-p5-followup-real.spec.ts). Shared by both
 *  the trace-poll path (applyTraceEvents) and runSubmission's own POST-
 *  response safety net below, so the two never disagree. */
function emptyPlanOutcome(machine: MachineState, instructionText: string): { machine: MachineState; clarification: ClarificationData | null } {
  if (looksLikeFollowUpReference(instructionText)) {
    return {
      machine: transition(machine, { type: "TRACE_clarification" }),
      clarification: { question: UNRESOLVED_REFERENCE_MESSAGE, missingFields: ["instruction"], context: UNRESOLVED_REFERENCE_CONTEXT },
    }
  }
  return { machine: transition(machine, { type: "PLAN_EMPTY" }), clarification: null }
}

export function applyTraceEvents(thread: Thread, events: TraceEvent[], approval: TraceApprovalContext): Thread {
  let next = thread

  function resolveAction(t: Thread, actionId: string | undefined, gated: boolean): Thread {
    if (!actionId || t.traceGating.resolvedActionIds.includes(actionId)) return t
    const resolvedActionIds = [...t.traceGating.resolvedActionIds, actionId]
    const gatedActionIds = gated ? [...t.traceGating.gatedActionIds, actionId] : t.traceGating.gatedActionIds
    let updated: Thread = { ...t, traceGating: { ...t.traceGating, resolvedActionIds, gatedActionIds } }
    const { expectedCount } = updated.traceGating
    if (
      !updated.clarification &&
      expectedCount !== null &&
      expectedCount > 0 &&
      resolvedActionIds.length >= expectedCount &&
      updated.machine.instructionState === "planning"
    ) {
      const gatedCount = gatedActionIds.length
      const m =
        gatedCount > 0
          ? transition(updated.machine, { type: "ACTION_pending", count: gatedCount })
          : transition(updated.machine, { type: "ACTION_executing", gatedCount: 0 })
      updated = {
        ...updated,
        machine: m,
        approvalWatch:
          m.instructionState === "awaiting_approval"
            ? {
                pendingNodeIds: new Set(gatedActionIds),
                approvalsAtStart: approval.approvalsThisSession,
                rejectionsAtStart: approval.rejectionsThisSession,
                enteredAtMs: Date.now(),
                everPendingIds: new Set(),
              }
            : updated.approvalWatch,
        runWatch: m.instructionState === "executing" ? { priorRunIds: new Set(), correlatedRunIds: new Set() } : updated.runWatch,
        // A fully-ungated plan moves straight to "executing" from here (never
        // visits awaiting_approval at all) — `everExecuted` gates whether
        // Thread.tsx's Execution block exists (§6⑦'s own truth rule: never claim
        // "Executed" for a thread that never did), so it must flip here too, not
        // only in the approval-watch effect's own APPROVAL_DECIDED path below.
        everExecuted: updated.everExecuted || m.instructionState === "executing",
      }
    }
    return updated
  }

  for (const event of events) {
    switch (event.phase) {
      case "received": {
        if (next.machine.instructionState !== "captured") break
        next = { ...next, machine: transition(next.machine, { type: "ACK" }) }
        break
      }
      case "context_retrieved": {
        const raw = Array.isArray(event.payload.chips) ? (event.payload.chips as unknown[]) : []
        const real = raw
          .map((c) => (c && typeof c === "object" ? (c as { label?: unknown; source?: unknown }) : {}))
          .filter((c): c is { label: string; source: string } => typeof c.label === "string" && typeof c.source === "string")
        const existingKeys = new Set(next.contextChips.map((c) => `${c.label}·${c.source}`))
        const fresh = real.filter((c) => !existingKeys.has(`${c.label}·${c.source}`))
        if (fresh.length > 0) next = { ...next, contextChips: [...next.contextChips, ...fresh] }
        break
      }
      case "planning": {
        if (next.machine.instructionState !== "understanding") break
        next = { ...next, machine: transition(next.machine, { type: "TRACE_planning" }) }
        break
      }
      case "plan_ready": {
        const count = typeof event.payload.count === "number" ? event.payload.count : null
        next = { ...next, traceGating: { ...next.traceGating, expectedCount: count } }
        if (count === 0 && next.machine.instructionState === "planning") {
          const outcome = emptyPlanOutcome(next.machine, next.instructionText)
          next = outcome.clarification
            ? { ...next, machine: outcome.machine, clarification: outcome.clarification }
            : { ...next, machine: outcome.machine, terminalAtMs: Date.now() }
        }
        break
      }
      case "clarification_required": {
        if (next.clarification || next.machine.instructionState !== "planning") break
        const payload = event.payload as { question?: unknown; missingFields?: unknown; context?: unknown }
        next = {
          ...next,
          machine: transition(next.machine, { type: "TRACE_clarification" }),
          clarification: {
            question: typeof payload.question === "string" ? payload.question : "I need one more thing to continue.",
            missingFields: Array.isArray(payload.missingFields) ? payload.missingFields.filter((f): f is string => typeof f === "string") : [],
            context: typeof payload.context === "string" ? payload.context : undefined,
          },
        }
        break
      }
      case "action_created": {
        const thin = thinNodeFromTraceEvent(event.payload)
        if (thin && !next.nodes.some((n) => n.id === thin.id)) {
          next = { ...next, nodes: [...next.nodes, thin] }
        }
        break
      }
      case "action_gated": {
        const actionId = typeof event.payload.actionId === "string" ? event.payload.actionId : undefined
        next = resolveAction(next, actionId, true)
        break
      }
      case "completed":
      case "failed": {
        const actionId = typeof event.payload.actionId === "string" ? event.payload.actionId : undefined
        if (actionId) {
          // A per-action terminal outcome (this action ran synchronously and
          // ungated, inside the same handleInstruction call) — resolves gating,
          // does not by itself end the WHOLE instruction.
          next = resolveAction(next, actionId, false)
        } else if (event.phase === "failed") {
          // No actionId: the whole instruction failed before any action existed
          // (a real planner exception — orchestration/src/index.ts's own P3.T3
          // try/catch around this.planner.plan()).
          next = { ...next, machine: transition(next.machine, { type: "TRACE_failed" }), terminalAtMs: Date.now() }
        }
        break
      }
      // dispatched/executing/step_progress/verifying/verified/cancelled are real,
      // traced, and visible via GET /api/instructions/:id/events — not yet
      // individually consumed here (per-action `executing` doesn't change gating
      // resolution; the run-level lanes already come from WorkflowTheater's own
      // real polling once the machine reaches "executing").
      default:
        break
    }
  }
  return next
}

// ---------------------------------------------------------------------------
// Kernel context
// ---------------------------------------------------------------------------

export interface KernelState {
  thread: Thread | null
  /** jarvis-v3 P5.T8 — §2.2 "Threads stack newest-first; older threads
   *  collapse to a single row." Newest-superseded-first. Each entry is a
   *  real snapshot of a thread that WAS the active one, captured the instant
   *  a new top-level instruction superseded it (never a live reference —
   *  mutating the old thread further would be dishonest once it's "history"). */
  threadHistory: Thread[]
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

/** jarvis-v3 P5.T8 — a defensive, uncontroversial cap on how many superseded
 *  threads accumulate in one browser session (not specified by the plan;
 *  this session's own reasoned choice, recorded as a deviation). Oldest
 *  history entries drop first — the ACTIVE thread is never capped. */
const THREAD_HISTORY_CAP = 50

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
  const [threadHistory, setThreadHistory] = useState<Thread[]>([])
  // jarvis-v3 P5.T8 — `runSubmission`'s own `useCallback` deps are
  // deliberately minimal (`[data.approvalsThisSession, data.rejectionsThisSession]`,
  // NOT `thread` — see its own eslint-disable comment), so reading `thread`
  // directly inside it would be stale. A plain ref kept in sync via a normal
  // effect (never inside a setState updater — this codebase has already been
  // bitten once by a StrictMode double-invoke bug from exactly that shape,
  // see P3's own real finding) is the safe way to read "the thread as of
  // right now" from that stable callback.
  const threadRef = useRef<Thread | null>(null)
  useEffect(() => {
    threadRef.current = thread
  }, [thread])
  const [micOpen, setMicOpen] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [terminalDecayActive, setTerminalDecayActive] = useState(false)
  const decayTimerRef = useRef<number | null>(null)
  // jarvis-v3 P3.T6: the CURRENT submission's own trace-transport handle. A ref,
  // not state — starting/stopping it is not itself a displayed fact (§4.7 only
  // governs facts a selector produces).
  const traceHandleRef = useRef<InstructionTransportHandle | null>(null)
  useEffect(() => () => traceHandleRef.current?.stop(), [])
  // jarvis-v3 P3.T11: the active thread's own SSE health (null when no thread is
  // tracing, or SSE is disabled) — a real selector-visible fact (feeds `transport`
  // below, which the rail's connection dot reads), so it IS state, unlike the
  // handle above.
  const [sseHealth, setSseHealth] = useState<SseHealth>(null)

  // jarvis-v3 P3.T8: restore a non-terminal thread after a refresh. Runs its
  // real attempt exactly once, the first time auth actually resolves to a real
  // session (never for a signed-out visitor — nothing of theirs to restore, and
  // the fetch would just 401). Best-effort: any failure (network, a 404 because
  // the row somehow never made it to the DB, auth not ready) leaves the pointer
  // in place and the rest state shows instead — never a crash, never a
  // fabricated thread.
  const restoreAttemptedRef = useRef(false)
  // Real bug found via live testing (P3.T8): this effect's own deps include
  // `auth.session`, and Supabase's client can hand out a NEW session object
  // reference shortly after sign-in (e.g. a follow-up auth-state event) even
  // when nothing meaningful changed — which re-runs this effect and, with a
  // PER-INVOCATION `cancelled` flag, ran this exact cleanup and cancelled the
  // already-in-flight restore fetch a moment before it could call setThread.
  // Both real GET calls completed, but the thread never appeared. A MOUNT-
  // scoped ref (only ever flipped by true unmount, below) fixes it — cancelling
  // an in-flight fetch on a same-mount effect re-run was never the intent;
  // `restoreAttemptedRef` already prevents starting a second attempt.
  const mountedRef = useRef(true)
  useEffect(() => {
    // Real second bug found via the SAME live test: React's dev-mode
    // StrictMode double-invokes an effect (mount -> cleanup -> mount again)
    // against the SAME ref. Setting `mountedRef.current = true` only via
    // `useRef`'s initial value meant the interim cleanup call flipped it to
    // false and nothing ever set it back — so the restore's own async
    // continuation always read "unmounted" and bailed right before
    // `setThread`, even though the component was genuinely still mounted.
    // Resetting it here, on every real (re)mount, is the standard fix.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    if (restoreAttemptedRef.current || auth.loading || !auth.session || thread) return
    const pointer = readActiveThreadPointer()
    if (!pointer) return
    restoreAttemptedRef.current = true
    void (async () => {
      try {
        const sessionRes = await jarvisGet<{ instruction?: { id: string } }>(`instructions/${pointer.instructionId}`)
        if (!sessionRes.instruction) {
          clearActiveThreadPointer()
          return
        }
        const eventsRes = await jarvisGet<{ events?: TraceEvent[] }>(`instructions/${pointer.instructionId}/events`, { after: "0" })
        const events = eventsRes.events ?? []
        if (!mountedRef.current) return
        const base: Thread = {
          id: pointer.id,
          sessionId: pointer.sessionId,
          instructionId: pointer.instructionId,
          source: pointer.source,
          instructionText: pointer.instructionText,
          createdAtMs: pointer.createdAtMs,
          machine: transition(initialMachineState, { type: "SUBMITTED" }),
          nodes: [],
          contextChips: [],
          traceGating: { expectedCount: null, resolvedActionIds: [], gatedActionIds: [] },
          clarification: null,
          submitError: null,
          approvalWatch: null,
          runWatch: null,
          terminalAtMs: null,
          everExecuted: false,
          receiptRefreshTick: 0,
        }
        const restored = applyTraceEvents(base, events, {
          approvalsThisSession: data.approvalsThisSession,
          rejectionsThisSession: data.rejectionsThisSession,
        })
        setThread(restored)
        if (isTerminal(restored.machine.instructionState)) {
          clearActiveThreadPointer()
        } else {
          const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0
          traceHandleRef.current = startInstructionTransport({
            instructionId: pointer.instructionId,
            onEvents: (newEvents) => {
              setThread((prev) =>
                prev && prev.id === pointer.id
                  ? applyTraceEvents(prev, newEvents, { approvalsThisSession: data.approvalsThisSession, rejectionsThisSession: data.rejectionsThisSession })
                  : prev,
              )
            },
            onHealthChange: setSseHealth,
            sinceSeq: lastSeq,
          })
        }
      } catch {
        // Best-effort — see this effect's own header.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.session, thread])

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
  const transport = deriveTransportHealth({ signedIn: !!auth.session, statsDegraded: data.statsDegraded, degradedForMs, sseHealth })

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

  // jarvis-v3 P3.T8: nothing left to resume once a thread reaches a terminal
  // state — clear the restore pointer so a later refresh shows the real rest
  // state, not a stale finished thread.
  useEffect(() => {
    if (thread && isTerminal(thread.machine.instructionState)) clearActiveThreadPointer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.machine.instructionState])

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

  // ---- payment-watch: the payment-webhook consequence (P4.T5, §6⑦'s "the
  // payment webhook lands minutes or hours later... the receipt updates in
  // place"). Reconciles against `data.events` exactly like approval-watch/
  // run-watch reconcile against `data.pendingActions`/`data.runs` above — one
  // reconciliation shape, not a second mechanism alongside P3's own
  // applyTraceEvents. A real `payment_recorded` business event
  // (packages/data-platform/src/payments.ts's recordBusinessEvent, fired by
  // the payment webhook) whose payload.invoiceId matches one of THIS thread's
  // own node payloads triggers an immediate slow-lane refetch (cashCollections
  // otherwise waits up to its own 30s cadence) and bumps receiptRefreshTick so
  // the already-shown receipt re-fetches in place. seenPaymentEventIdsRef
  // persists for the component's life (not per-thread) — a real event is only
  // ever actioned once, harmlessly, even across thread boundaries.
  const seenPaymentEventIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!thread) return
    const relevant = findRelevantPaymentEvents(data.events, invoiceIdsForThread(thread.nodes), seenPaymentEventIdsRef.current)
    if (relevant.length === 0) return
    for (const e of relevant) seenPaymentEventIdsRef.current.add(e.id)
    data.refetchSlowLaneNow()
    setThread((prev) => (prev && prev.id === thread.id ? { ...prev, receiptRefreshTick: prev.receiptRefreshTick + 1 } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.nodes, data.events])

  const runSubmission = useCallback(
    async (text: string, source: InstructionSource, existing: Thread | null) => {
      const sessionId = existing?.sessionId ?? getOrCreateSessionId(source)
      const id = existing?.id ?? newId()
      // jarvis-v3 P3.T6: always freshly minted, never reused across turns — this
      // exact submission's own instruction_events trace, distinct from sessionId
      // (which persists for follow-up-reference continuity, kernel/instruction.ts).
      const instructionId = mintInstructionId()
      const nowMs = Date.now()

      traceHandleRef.current?.stop()
      traceHandleRef.current = null
      setSseHealth(null)

      // jarvis-v3 P5.T8 — §2.2 "Threads stack newest-first." A genuinely NEW
      // top-level instruction (`existing === null` — never a clarification
      // answer, which continues the SAME thread in place, §4.4) supersedes
      // whatever was active: snapshot it into history before it's replaced.
      if (!existing && threadRef.current) {
        const superseded = threadRef.current
        setThreadHistory((prev) => [superseded, ...prev].slice(0, THREAD_HISTORY_CAP))
      }

      // ① HEARD — captured, immediately, with the verbatim text (§6①).
      setThread({
        id,
        sessionId,
        instructionId,
        source,
        instructionText: text,
        createdAtMs: nowMs,
        machine: transition(initialMachineState, { type: "SUBMITTED" }),
        nodes: [],
        contextChips: [],
        traceGating: { expectedCount: null, resolvedActionIds: [], gatedActionIds: [] },
        clarification: null,
        submitError: null,
        approvalWatch: null,
        runWatch: null,
        terminalAtMs: null,
        everExecuted: existing?.everExecuted ?? false,
        receiptRefreshTick: existing ? existing.receiptRefreshTick : 0,
      })
      // jarvis-v3 P3.T8: survive a refresh mid-flight — cleared the instant this
      // thread reaches a terminal state (effect below) or is cancelled.
      persistActiveThreadPointer({ id, sessionId, instructionId, source, instructionText: text, createdAtMs: nowMs })

      // jarvis-v3 P3.T6/T7: the trace poll starts THE SAME INSTANT as the POST
      // below — both race the real backend from the same starting line
      // (kernel/instruction.ts's own header) — so HEARD->UNDERSTOOD->PLAN can
      // render as `handleInstruction` actually does the work (context chips, plan
      // nodes appearing one at a time), not after its whole response resolves.
      // Guarded on `prev.id === id`, same convention every setThread callback in
      // this file already uses.
      traceHandleRef.current = startInstructionTransport({
        instructionId,
        onEvents: (events) => {
          setThread((prev) =>
            prev && prev.id === id
              ? applyTraceEvents(prev, events, { approvalsThisSession: data.approvalsThisSession, rejectionsThisSession: data.rejectionsThisSession })
              : prev,
          )
        },
        onHealthChange: setSseHealth,
      })

      let result: Awaited<ReturnType<typeof submitInstruction>>
      try {
        result = await submitInstruction(text, { source, sessionId, instructionId })
      } catch (err) {
        traceHandleRef.current?.stop()
        setSseHealth(null)
        setThread((prev) =>
          prev && prev.id === id
            ? { ...prev, machine: transition(prev.machine, { type: "SUBMIT_FAILED" }), submitError: err instanceof Error ? err.message : "I couldn't send that." }
            : prev,
        )
        return
      }

      // ② UNDERSTOOD / ③ PLAN — the trace poll above may already have driven ACK,
      // TRACE_planning, TRACE_clarification and every action_created node by the
      // time this resolves (P3's own real improvement: event->pixel is now
      // typically far under the ~4s the whole POST round trip used to take). What
      // follows is now a SAFETY NET, not the primary driver: it (a) enriches any
      // thin trace-created nodes with this response's fuller amount/target/
      // policy/groundedPayload data, (b) fills in anything the trace poll missed
      // (a slow first tick, a dropped event), and (c) is still the sole driver of
      // the AGGREGATE awaiting_approval/executing transition and its
      // approvalWatch/runWatch side-registration — this phase's own deliberate
      // scope decision (see `applyTraceEvents`'s own header) to keep that
      // coordination in one place rather than duplicating it.
      const planned = result.planned
      const clarificationRow = planned.find((p) => p.actionType === "clarification_request")

      setThread((prev) => {
        if (!prev || prev.id !== id) return prev
        const enrichedNodes = enrichNodesFromPlanned(prev.nodes, planned)
        const m = prev.machine.instructionState === "captured" ? transition(prev.machine, { type: "ACK" }) : prev.machine
        return { ...prev, machine: m, nodes: enrichedNodes }
      })
      // A short, deliberate pause — legibility buffer only now (the trace poll is
      // the primary pacing mechanism), covering the cold case where no trace event
      // arrived in time (e.g. a slow first poll tick). No spinner, no fabricated
      // latency claim.
      await new Promise((resolve) => setTimeout(resolve, 200))

      setThread((prev) => {
        if (!prev || prev.id !== id) return prev
        let m = prev.machine.instructionState === "understanding" ? transition(prev.machine, { type: "TRACE_planning" }) : prev.machine
        if (planned.length === 0) {
          const outcome = emptyPlanOutcome(m, prev.instructionText)
          return outcome.clarification
            ? { ...prev, machine: outcome.machine, nodes: [], clarification: outcome.clarification }
            : { ...prev, machine: outcome.machine, nodes: [], clarification: null, terminalAtMs: Date.now() }
        }
        if (clarificationRow) {
          if (prev.clarification) return { ...prev, machine: m } // the trace already delivered it
          const payload = clarificationRow.payload as { question?: string; missingFields?: string[]; context?: string }
          m = m.instructionState === "planning" ? transition(m, { type: "TRACE_clarification" }) : m
          return {
            ...prev,
            machine: m,
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
        if (m.instructionState !== "planning") return { ...prev, machine: m } // already moved past this
        m = transition(m, { type: "ACTION_pending", count: planned.length })
        return {
          ...prev,
          machine: m,
          clarification: null,
          approvalWatch:
            m.instructionState === "awaiting_approval"
              ? {
                  pendingNodeIds: new Set(prev.nodes.map((n) => n.id)),
                  approvalsAtStart: data.approvalsThisSession,
                  rejectionsAtStart: data.rejectionsThisSession,
                  enteredAtMs: Date.now(),
                  everPendingIds: new Set(),
                }
              : null,
        }
      })
      // Nothing more will ever change this turn's own trace (a gated plan's real
      // backend trace stops at action_gated; the aggregate decision above is now
      // made) — stop the transport rather than waiting out the full 120s ceiling.
      traceHandleRef.current?.stop()
      setSseHealth(null)

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
    traceHandleRef.current?.stop()
    setSseHealth(null)
    clearActiveThreadPointer()
    setThread((prev) => (prev ? { ...prev, machine: transition(prev.machine, { type: "USER_CANCELLED" }), terminalAtMs: Date.now() } : prev))
  }, [])

  const value = useMemo<KernelState>(
    () => ({
      thread,
      threadHistory,
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
    [thread, threadHistory, presence, transport, selectorInput, lane, micOpen, voiceSpeaking, setVoiceIndicators, submit, answerClarification, cancelThread],
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
