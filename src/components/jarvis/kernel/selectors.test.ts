// Plan v3 P1.T6 evidence: "selector unit tests incl. the `partial` cap and
// disagreement cases".
//
// These tests are the regression net under defect C-01 (a 401 rendering as a
// confident $0) and C-03 (an unbounded /api/stats count rendered as if it agreed
// with a .limit(100) list). They assert on statuses, not just numbers — the status
// IS the product requirement.

import { describe, expect, it, vi } from "vitest"
import {
  mapTruth,
  PENDING_LIST_CAP,
  selectCollectedUsd,
  selectEventsToday,
  selectFirstName,
  selectOpenLeads,
  selectOpenReconciliation,
  selectOverdueInvoices,
  selectPaymentLinksOpen,
  selectPendingApprovals,
  selectQuotesSent,
  selectRunsInFlight,
  selectStuckRuns,
  type SelectorInput,
} from "./selectors"

const NOW = 1_700_000_000_000

function input(over: Partial<SelectorInput> = {}): SelectorInput {
  return {
    signedIn: true,
    authLoading: false,
    accessDenied: null,
    now: NOW,
    stats: { pending: 3, blocked: 0, recentActions: [] },
    statsDegraded: false,
    pendingActions: [],
    pendingDegraded: false,
    runs: [],
    runsDegraded: false,
    events: [],
    eventsDegraded: false,
    cashCollections: {
      invoicesByStatus: [{ status: "overdue", count: 6, totalUsd: 4200 }],
      totalCollected: 12_500,
      paymentLinksAwaitingPayment: 2,
    },
    pipelineHealth: {
      leadsByStatus: [
        { status: "new", count: 4 },
        { status: "contacted", count: 3 },
      ],
      quotesByStatus: [{ status: "sent", count: 2 }],
      proposalsByStatus: [],
    },
    slaBreaches: { stuckWorkflowRuns: 1, openReconciliationCases: 0 },
    readModelsDegraded: false,
    slowLastSuccessMs: NOW,
    slowLaneStaleAfterMs: 90_000,
    degradedSinceMs: NOW,
    ...over,
  }
}

/** The 3 pending rows the default input's `stats.pending` claims exist. */
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    actionType: "send_message",
    summary: null,
    payload: {},
    status: "pending",
    createdAt: "2026-07-29T00:00:00Z",
  }))
}

// ---------------------------------------------------------------------------
// C-01 — the gate. No private number renders without a signed-in, healthy read.
// ---------------------------------------------------------------------------
describe("the truth gate (defect C-01)", () => {
  // Every selector, not just the four golden ones — the gate is the whole point and
  // a supporting selector that skips it reintroduces C-01 in a smaller card.
  const all = {
    selectOverdueInvoices,
    selectCollectedUsd,
    selectPendingApprovals,
    selectRunsInFlight,
    selectPaymentLinksOpen,
    selectOpenLeads,
    selectQuotesSent,
    selectStuckRuns,
    selectOpenReconciliation,
  }

  for (const [name, select] of Object.entries(all)) {
    it(`${name}: signed out is denied, never a zero`, () => {
      const t = select(input({ signedIn: false }))
      expect(t.status).toBe("denied")
      expect(t).toEqual({ status: "denied", reason: "signed-out" })
      expect(t).not.toHaveProperty("value")
    })

    it(`${name}: auth still loading is unknown, never a zero`, () => {
      const t = select(input({ authLoading: true, signedIn: false }))
      expect(t).toEqual({ status: "unknown", reason: "loading" })
    })

    it(`${name}: signed-out wins over a degraded lane (401 is not a network fault)`, () => {
      const t = select(
        input({
          signedIn: false,
          statsDegraded: true,
          pendingDegraded: true,
          runsDegraded: true,
          readModelsDegraded: true,
        }),
      )
      expect(t.status).toBe("denied")
    })
  }

  it("a degraded read-model is unavailable, not zero", () => {
    const t = selectCollectedUsd(input({ readModelsDegraded: true, degradedSinceMs: NOW - 5_000 }))
    expect(t).toEqual({ status: "unavailable", reason: "network", sinceMs: NOW - 5_000 })
  })

  it("a 401 on a private lane is denied:signed-out even with a session object", () => {
    const t = selectCollectedUsd(input({ signedIn: true, accessDenied: "signed-out" }))
    expect(t).toEqual({ status: "denied", reason: "signed-out" })
  })

  it("a 403 on a private lane is denied:role", () => {
    const t = selectCollectedUsd(input({ signedIn: true, accessDenied: "role" }))
    expect(t).toEqual({ status: "denied", reason: "role" })
  })

  it("a refusal outranks a degraded lane — being told no is not a network fault", () => {
    const t = selectCollectedUsd(input({ accessDenied: "role", readModelsDegraded: true }))
    expect(t).toEqual({ status: "denied", reason: "role" })
  })

  it("signed in but nothing has landed yet is unknown:loading", () => {
    const t = selectCollectedUsd(input({ cashCollections: null }))
    expect(t).toEqual({ status: "unknown", reason: "loading" })
  })
})

// ---------------------------------------------------------------------------
// selectOverdueInvoices — the golden workflow's subject
// ---------------------------------------------------------------------------
describe("selectOverdueInvoices", () => {
  it("reads the real overdue row: 6 invoices, $4,200", () => {
    const t = selectOverdueInvoices(input())
    expect(t.status).toBe("known")
    expect(t).toMatchObject({ value: { count: 6, totalUsd: 4200 }, source: "api:read-model" })
  })

  it("no overdue row is a real knowable zero, not an absence", () => {
    const t = selectOverdueInvoices(
      input({
        cashCollections: { invoicesByStatus: [], totalCollected: 0, paymentLinksAwaitingPayment: 0 },
      }),
    )
    expect(t.status).toBe("known")
    expect(t).toMatchObject({ value: { count: 0, totalUsd: 0 } })
  })

  it("goes stale past the lane SLA rather than claiming to be current", () => {
    const t = selectOverdueInvoices(input({ slowLastSuccessMs: NOW - 120_000, slowLaneStaleAfterMs: 90_000 }))
    expect(t.status).toBe("stale")
    expect(t).toMatchObject({ ageMs: 120_000, atMs: NOW - 120_000 })
  })

  it("is still known at exactly the SLA boundary", () => {
    const t = selectOverdueInvoices(input({ slowLastSuccessMs: NOW - 90_000, slowLaneStaleAfterMs: 90_000 }))
    expect(t.status).toBe("known")
  })
})

// ---------------------------------------------------------------------------
// C-03 — the partial cap and the disagreement cases
// ---------------------------------------------------------------------------
describe("selectPendingApprovals (defect C-03)", () => {
  it("counts agree -> known", () => {
    const t = selectPendingApprovals(input({ stats: { pending: 3, blocked: 0, recentActions: [] }, pendingActions: rows(3) }))
    expect(t.status).toBe("known")
    expect(t).toMatchObject({ value: 3, source: "api:stats" })
  })

  it("list at the cap -> partial, rendered as '100 of 137'", () => {
    const t = selectPendingApprovals(
      input({ stats: { pending: 137, blocked: 0, recentActions: [] }, pendingActions: rows(PENDING_LIST_CAP) }),
    )
    expect(t).toEqual({
      status: "partial",
      value: 137,
      source: "api:stats",
      atMs: NOW,
      capped: 100,
    })
  })

  it("the cap is 100, matching actions/pending/route.ts:49", () => {
    expect(PENDING_LIST_CAP).toBe(100)
  })

  it("disagreement BELOW the cap -> known from /api/stats, with a dev warning naming both", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const t = selectPendingApprovals(
      input({ stats: { pending: 137, blocked: 0, recentActions: [] }, pendingActions: rows(12) }),
    )
    expect(t.status).toBe("known")
    expect(t).toMatchObject({ value: 137, source: "api:stats" })

    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0])
    expect(msg).toContain("137") // the authority
    expect(msg).toContain("12") // what we actually hold
    warn.mockRestore()
  })

  it("agreement does NOT warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    selectPendingApprovals(input({ stats: { pending: 3, blocked: 0, recentActions: [] }, pendingActions: rows(3) }))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("a degraded pending lane alone is enough to withhold the number", () => {
    const t = selectPendingApprovals(input({ pendingDegraded: true }))
    expect(t.status).toBe("unavailable")
  })

  it("a degraded stats lane alone is enough to withhold the number", () => {
    const t = selectPendingApprovals(input({ statsDegraded: true }))
    expect(t.status).toBe("unavailable")
  })
})

describe("selectCollectedUsd / selectRunsInFlight", () => {
  it("collected reads the real read-model total", () => {
    expect(selectCollectedUsd(input())).toMatchObject({ status: "known", value: 12_500, source: "api:read-model" })
  })

  it("runs in flight counts the real runs array", () => {
    const runs = [
      { id: "r1", workflowType: "invoice_to_cash", status: "running", version: 1, createdAt: "", updatedAt: "", steps: [] },
      { id: "r2", workflowType: "invoice_to_cash", status: "running", version: 1, createdAt: "", updatedAt: "", steps: [] },
    ]
    expect(selectRunsInFlight(input({ runs }))).toMatchObject({ status: "known", value: 2, source: "api:workflow-runs" })
  })

  it("zero runs is a known zero, because the read succeeded", () => {
    expect(selectRunsInFlight(input({ runs: [] }))).toMatchObject({ status: "known", value: 0 })
  })
})

describe("selectEventsToday", () => {
  const ev = (iso: string) => ({
    id: iso, entityType: "invoice", entityId: "i1", eventType: "invoice_paid",
    payload: {}, occurredAt: iso, source: "test",
  })

  it("counts only events on the same calendar day as `now`", () => {
    const today = new Date(NOW)
    const yesterday = new Date(NOW - 24 * 60 * 60 * 1000)
    const t = selectEventsToday(input({ events: [ev(today.toISOString()), ev(today.toISOString()), ev(yesterday.toISOString())] }))
    expect(t).toMatchObject({ status: "known", value: 2, source: "api:activity" })
  })

  it("no events today is a known zero, because the read succeeded", () => {
    expect(selectEventsToday(input({ events: [] }))).toMatchObject({ status: "known", value: 0 })
  })

  it("a degraded events lane is unavailable, not zero", () => {
    expect(selectEventsToday(input({ eventsDegraded: true })).status).toBe("unavailable")
  })

  it("signed out is denied — the header sentence must not claim the day was quiet", () => {
    expect(selectEventsToday(input({ signedIn: false }))).toEqual({ status: "denied", reason: "signed-out" })
  })
})

// ---------------------------------------------------------------------------
// C-02 — the greeting must never borrow a name
// ---------------------------------------------------------------------------
describe("selectFirstName (defect C-02)", () => {
  it("signed out has no name — this is the C-02 regression", () => {
    expect(selectFirstName(null)).toBeNull()
    expect(selectFirstName(undefined)).toBeNull()
  })

  it("never returns the hardcoded literal that shipped to production", () => {
    const candidates = [
      null,
      undefined,
      {},
      { email: null, user_metadata: null },
      { email: "", user_metadata: {} },
      { user_metadata: { full_name: "   " } },
    ]
    for (const c of candidates) {
      expect(selectFirstName(c)).not.toBe("Param")
    }
  })

  it("takes the first token of a real profile name", () => {
    expect(selectFirstName({ user_metadata: { full_name: "Ada Lovelace" } })).toBe("Ada")
    expect(selectFirstName({ user_metadata: { full_name: "  Grace   Hopper " } })).toBe("Grace")
    expect(selectFirstName({ user_metadata: { name: "Katherine Johnson" } })).toBe("Katherine")
  })

  it("prefers full_name over name", () => {
    expect(selectFirstName({ user_metadata: { full_name: "Ada Lovelace", name: "Someone Else" } })).toBe("Ada")
  })

  it("falls back to the email local part, never to a placeholder", () => {
    expect(selectFirstName({ email: "ada@example.com" })).toBe("ada")
    expect(selectFirstName({ email: "ada@example.com", user_metadata: { full_name: "" } })).toBe("ada")
  })

  it("returns null when there is genuinely nothing to go on", () => {
    expect(selectFirstName({})).toBeNull()
    expect(selectFirstName({ email: "", user_metadata: {} })).toBeNull()
    expect(selectFirstName({ email: "@example.com" })).toBeNull()
    expect(selectFirstName({ user_metadata: { full_name: "   " } })).toBeNull()
  })

  it("ignores non-string metadata rather than coercing it", () => {
    expect(selectFirstName({ user_metadata: { full_name: 42 } })).toBeNull()
    expect(selectFirstName({ user_metadata: { full_name: { first: "Ada" } }, email: "ada@example.com" })).toBe("ada")
  })
})

// ---------------------------------------------------------------------------
// The supporting read-model selectors the KPI strip needs (P1.T7)
// ---------------------------------------------------------------------------
describe("supporting read-model selectors", () => {
  it("payment links open", () => {
    expect(selectPaymentLinksOpen(input())).toMatchObject({ status: "known", value: 2 })
  })

  it("open leads sums every lead status", () => {
    expect(selectOpenLeads(input())).toMatchObject({ status: "known", value: 7 })
  })

  it("quotes sent reads the 'sent' bucket", () => {
    expect(selectQuotesSent(input())).toMatchObject({ status: "known", value: 2 })
  })

  it("no 'sent' bucket is a known zero, because the read succeeded", () => {
    const t = selectQuotesSent(
      input({ pipelineHealth: { leadsByStatus: [], quotesByStatus: [], proposalsByStatus: [] } }),
    )
    expect(t).toMatchObject({ status: "known", value: 0 })
  })

  it("stuck runs and open reconciliation read the SLA breach model", () => {
    expect(selectStuckRuns(input())).toMatchObject({ status: "known", value: 1 })
    expect(selectOpenReconciliation(input())).toMatchObject({ status: "known", value: 0 })
  })

  it("a null pipeline read-model is unknown, not zero", () => {
    expect(selectOpenLeads(input({ pipelineHealth: null }))).toEqual({ status: "unknown", reason: "loading" })
    expect(selectQuotesSent(input({ pipelineHealth: null }))).toEqual({ status: "unknown", reason: "loading" })
  })

  it("a null SLA read-model is unknown, not zero", () => {
    expect(selectStuckRuns(input({ slaBreaches: null }))).toEqual({ status: "unknown", reason: "loading" })
    expect(selectOpenReconciliation(input({ slaBreaches: null }))).toEqual({ status: "unknown", reason: "loading" })
  })
})

// ---------------------------------------------------------------------------
// mapTruth — projecting one fact must not change how it is known
// ---------------------------------------------------------------------------
describe("mapTruth", () => {
  it("projects a value while preserving status and provenance", () => {
    const t = selectOverdueInvoices(input())
    expect(mapTruth(t, (v) => v.totalUsd)).toEqual({
      status: "known",
      value: 4200,
      source: "api:read-model",
      atMs: NOW,
    })
  })

  it("never invents a value for a status that has none", () => {
    for (const t of [
      selectOverdueInvoices(input({ signedIn: false })),
      selectOverdueInvoices(input({ cashCollections: null })),
      selectOverdueInvoices(input({ readModelsDegraded: true })),
    ]) {
      const mapped = mapTruth(t, (v) => v.count)
      expect(mapped).not.toHaveProperty("value")
      expect(mapped.status).toBe(t.status)
    }
  })

  it("preserves the partial cap through a projection", () => {
    const t = selectPendingApprovals(
      input({ stats: { pending: 137, blocked: 0, recentActions: [] }, pendingActions: rows(PENDING_LIST_CAP) }),
    )
    expect(mapTruth(t, (n) => n * 2)).toEqual({
      status: "partial",
      value: 274,
      source: "api:stats",
      atMs: NOW,
      capped: 100,
    })
  })
})
