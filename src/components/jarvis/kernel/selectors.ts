// JARVIS kernel — selectors (plan v3 §4.7: one fact, one selector).
//
// This is the ONLY module that produces a displayed fact. Every selector returns
// `Truth<T>`, never a bare number, so a value cannot reach the screen without
// carrying how it is known. Components import from here; ESLint (P1.T4) stops them
// reaching past it into `useJarvis()`.
//
// Every function here is PURE — it takes a plain `SelectorInput` and returns a
// value. No hooks, no context, no `Date.now()`. That is what makes the truth rules
// directly unit-testable, which matters more than usual right now: the DOM test
// environment is blocked (see ## BLOCKERS in the state file), so pure logic is the
// only thing this phase can actually assert on.

import type {
  CashCollections,
  EventRow,
  PendingAction,
  PipelineHealth,
  SlaBreaches,
  StatsResponse,
  WorkflowRun,
} from "../lib/data-core"
import type { DeniedReason } from "../lib/data-core"
import type { Truth, TruthSource } from "./types"

/** Everything a selector may read. Assembled by the caller from `useJarvis()` and
 *  `useJarvisAuth()`; the selectors themselves never touch either hook. */
export interface SelectorInput {
  /** From `useJarvisAuth()`. */
  signedIn: boolean
  authLoading: boolean
  /** P1.T9 / C-15: the server refused our credentials on a private lane. Set even
   *  when a session object exists — an expired or under-privileged token still
   *  means no number may render. */
  accessDenied: DeniedReason | null
  /** From `useJarvis()`. */
  now: number
  stats: StatsResponse | null
  statsDegraded: boolean
  pendingActions: PendingAction[]
  /** Real action rows the server classified as blocked before a workflow run. */
  blockedActions?: PendingAction[]
  pendingDegraded: boolean
  runs: WorkflowRun[]
  /** Recent recorded runs are kept separate from the fast-lane running list so
   * instruction surfaces can still bind to paused and terminal actions. */
  terminalRuns?: WorkflowRun[]
  runsDegraded: boolean
  events: EventRow[]
  eventsDegraded: boolean
  cashCollections: CashCollections | null
  pipelineHealth: PipelineHealth | null
  slaBreaches: SlaBreaches | null
  readModelsDegraded: boolean
  /** Wall-clock ms of the slow lane's last successful fetch; null = never landed. */
  slowLastSuccessMs: number | null
  /** Age beyond which slow-lane data is `stale` rather than `known`. */
  slowLaneStaleAfterMs: number
  /** When the degraded lane first started failing — feeds `unavailable.sinceMs`. */
  degradedSinceMs: number
}

/**
 * The gate every selector passes through before it is allowed to look at data.
 * Order is deliberate and is the reason C-01 cannot recur: signed-out is checked
 * before data, so a 401 can never be mistaken for a real zero.
 *
 * Returns a non-null `Truth` when the answer is "no number may render", or null to
 * mean "carry on, the data is legitimately readable".
 */
function gate(input: SelectorInput, degraded: boolean, data: unknown): Truth<never> | null {
  // 1. We do not yet know whether anyone is signed in.
  if (input.authLoading) return { status: "unknown", reason: "loading" }
  // 2. Nobody is. Private facts are denied, never zeroed.
  if (!input.signedIn) return { status: "denied", reason: "signed-out" }
  // 3. There is a session, but the server refused it. Still denied, never zeroed.
  if (input.accessDenied) return { status: "denied", reason: input.accessDenied }
  // 4. We asked and the lane is failing.
  if (degraded) return { status: "unavailable", reason: "network", sinceMs: input.degradedSinceMs }
  // 5. Signed in, lane healthy, but nothing has landed yet.
  if (data === null || data === undefined) return { status: "unknown", reason: "loading" }
  return null
}

function malformedReadModel(input: SelectorInput): Truth<never> {
  return { status: "unavailable", reason: "network", sinceMs: input.degradedSinceMs }
}

/** Wrap a readable value as `known`, downgrading to `stale` when the lane that
 *  produced it is past its SLA. */
function fresh<T>(value: T, source: TruthSource, input: SelectorInput, lastSuccessMs: number | null): Truth<T> {
  const atMs = lastSuccessMs ?? input.now
  const ageMs = input.now - atMs
  if (lastSuccessMs !== null && ageMs > input.slowLaneStaleAfterMs) {
    return { status: "stale", value, source, atMs, ageMs }
  }
  return { status: "known", value, source, atMs }
}

/**
 * Apply a pure function to a Truth's value without changing how it is known.
 * Used where one fact has several renderable projections (an overdue count and its
 * dollar total are the SAME fact from the SAME row) — deriving them as two separate
 * Truths is exactly the contradiction §4.7 exists to prevent.
 */
export function mapTruth<A, B>(t: Truth<A>, f: (a: A) => B): Truth<B> {
  switch (t.status) {
    case "known":
      return { status: "known", value: f(t.value), source: t.source, atMs: t.atMs }
    case "stale":
      return { status: "stale", value: f(t.value), source: t.source, atMs: t.atMs, ageMs: t.ageMs }
    case "partial":
      return { status: "partial", value: f(t.value), source: t.source, atMs: t.atMs, capped: t.capped }
    default:
      return t
  }
}

export interface OverdueInvoices {
  count: number
  totalUsd: number
}

/**
 * The overdue invoices — the golden workflow's subject ("6 invoices, $4,200").
 *
 * Returns both the count and the dollar total as ONE fact, because they come from
 * one row of one response. Project with `mapTruth` at the call site.
 */
export function selectOverdueInvoices(input: SelectorInput): Truth<OverdueInvoices> {
  const blocked = gate(input, input.readModelsDegraded, input.cashCollections)
  if (blocked) return blocked
  if (!Array.isArray(input.cashCollections!.invoicesByStatus)) return malformedReadModel(input)
  const row = input.cashCollections!.invoicesByStatus.find((s) => s.status === "overdue")
  // No overdue row is a real, knowable answer — the read-model succeeded and simply
  // reported no overdue bucket, which means nothing is overdue. Written as an explicit
  // branch rather than `?? 0` precisely because `?? 0` is the C-01 shape this file
  // exists to eliminate: here the zero is earned by a successful read, and the branch
  // says so.
  const value: OverdueInvoices = row ? { count: row.count, totalUsd: row.totalUsd } : { count: 0, totalUsd: 0 }
  return fresh(value, "api:read-model", input, input.slowLastSuccessMs)
}

/** Cash collected — `--j-green` territory, and the number the payment webhook
 *  later moves (P4.T4). */
export function selectCollectedUsd(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.cashCollections)
  if (blocked) return blocked
  if (typeof input.cashCollections!.totalCollected !== "number") return malformedReadModel(input)
  return fresh(input.cashCollections!.totalCollected, "api:read-model", input, input.slowLastSuccessMs)
}

/** P2.T8 (C-07): a `clarification_request` is a question, not a gated business
 *  action — it must never count toward approvals (§6④: "a clarification must
 *  never count toward `selectPendingApprovals`"). */
function isClarification(action: { actionType: string }): boolean {
  return action.actionType === "clarification_request"
}

/**
 * Pending approvals — and the resolution of defect C-03.
 *
 * `/api/stats` and the fully paginated `/api/actions/pending` projection answer
 * this question independently. Counts agree as `known`; any disagreement keeps
 * `/api/stats` authoritative and emits a development warning.
 *
 * `/api/stats`'s own `pending` count makes no clarification/business-action
 * distinction (it counts every `pending`-status row) — this selector subtracts
 * the clarifications actually visible in `pendingActions` from that total, so
 * the rendered number matches what §6④ requires.
 */
export function selectPendingApprovals(input: SelectorInput): Truth<number> {
  const degraded = input.statsDegraded || input.pendingDegraded
  const blocked = gate(input, degraded, input.stats)
  if (blocked) return blocked

  const authoritative = input.stats!.pending
  const rawHeld = input.pendingActions.length
  const clarificationsHeld = input.pendingActions.filter(isClarification).length
  const held = rawHeld - clarificationsHeld

  const adjustedAuthoritative = Math.max(0, authoritative - clarificationsHeld)

  if (held !== adjustedAuthoritative && process.env.NODE_ENV !== "production") {
    console.warn(
      `[jarvis/selectors] selectPendingApprovals disagreement: ` +
        `/api/stats reports pending=${authoritative} (adjusted ${adjustedAuthoritative} for ${clarificationsHeld} clarification(s)), ` +
        `/api/actions/pending returned ${held} non-clarification rows. ` +
        `Rendering ${adjustedAuthoritative} (/api/stats is the authority per plan v3 §4.7).`,
    )
  }

  return fresh(adjustedAuthoritative, "api:stats", input, input.now)
}

/** Workflow runs currently in flight. */
export function selectRunsInFlight(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.runsDegraded, input.runs)
  if (blocked) return blocked
  return fresh(input.runs.length, "api:workflow-runs", input, input.now)
}

/** Business events recorded today, by the device's own calendar day. */
export function selectEventsToday(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.eventsDegraded, input.events)
  if (blocked) return blocked
  const today = new Date(input.now).toDateString()
  const n = input.events.filter((e) => new Date(e.occurredAt).toDateString() === today).length
  return fresh(n, "api:activity", input, input.now)
}

// ---------------------------------------------------------------------------
// Identity (P1.T8, defect C-02)
// ---------------------------------------------------------------------------

/** The part of a Supabase user this derivation actually reads. Kept structural so
 *  the rule is testable without dragging in the Supabase client's types. */
export interface IdentityLike {
  email?: string | null
  user_metadata?: { full_name?: unknown; name?: unknown } | null
}

/**
 * The signed-in user's first name, or null when there is nobody to name.
 *
 * Defect C-02: `HeaderBand.tsx:61` greeted every visitor on production — including
 * signed-out ones — by one developer's own first name. Returning null rather
 * than a placeholder is the
 * whole point: no name is a truthful greeting, a borrowed one never is.
 *
 * Order: real profile name first; failing that the email's local part, which is
 * still the signed-in user's own identifier and not an invention. Never a default.
 */
export function selectFirstName(user: IdentityLike | null | undefined): string | null {
  if (!user) return null

  const meta = user.user_metadata
  for (const candidate of [meta?.full_name, meta?.name]) {
    if (typeof candidate !== "string") continue
    const first = candidate.trim().split(/\s+/)[0]
    if (first) return first
  }

  const local = typeof user.email === "string" ? user.email.split("@")[0]?.trim() : ""
  return local ? local : null
}

// ---------------------------------------------------------------------------
// Supporting read-model selectors.
//
// §4.7 names the four golden-journey selectors above. These are the remaining
// facts the KPI strip already displayed before P1.T7 — same facts, same labels,
// same copy, now routed through the same gate so none of them can render a
// confident zero off a 401 either. No new fact is displayed by adding these.
// ---------------------------------------------------------------------------

/** Payment links sent and still awaiting payment. */
export function selectPaymentLinksOpen(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.cashCollections)
  if (blocked) return blocked
  if (typeof input.cashCollections!.paymentLinksAwaitingPayment !== "number") return malformedReadModel(input)
  return fresh(input.cashCollections!.paymentLinksAwaitingPayment, "api:read-model", input, input.slowLastSuccessMs)
}

/** Open leads, summed across every lead status the pipeline read-model reports. */
export function selectOpenLeads(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.pipelineHealth)
  if (blocked) return blocked
  if (!Array.isArray(input.pipelineHealth!.leadsByStatus)) return malformedReadModel(input)
  const total = input.pipelineHealth!.leadsByStatus.reduce((sum, r) => sum + r.count, 0)
  return fresh(total, "api:read-model", input, input.slowLastSuccessMs)
}

/** Quotes sent and awaiting signature. */
export function selectQuotesSent(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.pipelineHealth)
  if (blocked) return blocked
  if (!Array.isArray(input.pipelineHealth!.quotesByStatus)) return malformedReadModel(input)
  const row = input.pipelineHealth!.quotesByStatus.find((q) => q.status === "sent")
  return fresh(row ? row.count : 0, "api:read-model", input, input.slowLastSuccessMs)
}

/** Workflow runs the SLA read-model considers stuck. */
export function selectStuckRuns(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.slaBreaches)
  if (blocked) return blocked
  if (typeof input.slaBreaches!.stuckWorkflowRuns !== "number") return malformedReadModel(input)
  return fresh(input.slaBreaches!.stuckWorkflowRuns, "api:read-model", input, input.slowLastSuccessMs)
}

/** Reconciliation cases still open. */
export function selectOpenReconciliation(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.readModelsDegraded, input.slaBreaches)
  if (blocked) return blocked
  if (typeof input.slaBreaches!.openReconciliationCases !== "number") return malformedReadModel(input)
  return fresh(input.slaBreaches!.openReconciliationCases, "api:read-model", input, input.slowLastSuccessMs)
}
