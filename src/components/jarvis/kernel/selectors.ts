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
  PendingAction,
  StatsResponse,
  WorkflowRun,
} from "../lib/data-core"
import type { Truth, TruthSource } from "./types"

/** Verified against `finnor-os/apps/api/app/api/actions/pending/route.ts:49` —
 *  `.limit(100)`. This is defect C-03: `/api/stats` counts every pending action,
 *  the list endpoint returns at most 100 of them, and the two were rendered as if
 *  they agreed. */
export const PENDING_LIST_CAP = 100

/** Everything a selector may read. Assembled by the caller from `useJarvis()` and
 *  `useJarvisAuth()`; the selectors themselves never touch either hook. */
export interface SelectorInput {
  /** From `useJarvisAuth()`. */
  signedIn: boolean
  authLoading: boolean
  /** From `useJarvis()`. */
  now: number
  stats: StatsResponse | null
  statsDegraded: boolean
  pendingActions: PendingAction[]
  pendingDegraded: boolean
  runs: WorkflowRun[]
  runsDegraded: boolean
  cashCollections: CashCollections | null
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
  // 3. We asked and the lane is failing.
  if (degraded) return { status: "unavailable", reason: "network", sinceMs: input.degradedSinceMs }
  // 4. Signed in, lane healthy, but nothing has landed yet.
  if (data === null || data === undefined) return { status: "unknown", reason: "loading" }
  return null
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
  return fresh(input.cashCollections!.totalCollected, "api:read-model", input, input.slowLastSuccessMs)
}

/**
 * Pending approvals — and the resolution of defect C-03.
 *
 * Two endpoints answer this question and they can legitimately disagree:
 * `/api/stats` counts every pending row; `/api/actions/pending` returns at most
 * `PENDING_LIST_CAP`. Per §4.7:
 *   - list at the cap        -> `partial`, `capped` = what we hold, `value` = the
 *                               real total, rendered "100 of 137 shown"
 *   - counts agree           -> `known`
 *   - disagree below the cap -> `known` from `/api/stats` (the authority), plus a
 *                               dev warning naming both numbers
 */
export function selectPendingApprovals(input: SelectorInput): Truth<number> {
  const degraded = input.statsDegraded || input.pendingDegraded
  const blocked = gate(input, degraded, input.stats)
  if (blocked) return blocked

  const authoritative = input.stats!.pending
  const held = input.pendingActions.length

  if (held >= PENDING_LIST_CAP) {
    return {
      status: "partial",
      value: authoritative,
      source: "api:stats",
      atMs: input.now,
      capped: held,
    }
  }

  if (held !== authoritative && process.env.NODE_ENV !== "production") {
    console.warn(
      `[jarvis/selectors] selectPendingApprovals disagreement below the cap: ` +
        `/api/stats reports pending=${authoritative}, /api/actions/pending returned ${held} rows. ` +
        `Rendering ${authoritative} (/api/stats is the authority per plan v3 §4.7).`,
    )
  }

  return fresh(authoritative, "api:stats", input, input.now)
}

/** Workflow runs currently in flight. */
export function selectRunsInFlight(input: SelectorInput): Truth<number> {
  const blocked = gate(input, input.runsDegraded, input.runs)
  if (blocked) return blocked
  return fresh(input.runs.length, "api:workflow-runs", input, input.now)
}
