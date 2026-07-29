// jarvis-v3 P4.T5 — pure-function coverage for the payment-watch effect's own
// logic (kernel/store.tsx's useEffect just wires these two functions to
// data.events/setThread — no DOM needed to test the actual decision, same
// B-1 pattern as every other kernel reconciliation effect).

import { describe, it, expect } from "vitest"
import { invoiceIdsForThread, findRelevantPaymentEvents } from "./store"
import type { ThreadNode } from "./store"
import type { EventRow } from "../lib/data-core"

function node(payload: Record<string, unknown>): ThreadNode {
  return { id: "n1", actionType: "start_invoice_to_cash_workflow", amountUsd: null, targetLabel: null, policyId: null, policyVersion: null, groundedPayload: [], payload }
}
function paymentEvent(id: string, invoiceId: unknown): EventRow {
  return { id, entityType: "payment", entityId: id, eventType: "payment_recorded", payload: { invoiceId }, occurredAt: "2026-07-30T00:00:00Z", source: "test" }
}

describe("invoiceIdsForThread", () => {
  it("collects invoiceId out of every node's payload", () => {
    const ids = invoiceIdsForThread([node({ invoiceId: "inv-1" }), node({ invoiceId: "inv-2" })])
    expect(ids).toEqual(new Set(["inv-1", "inv-2"]))
  })
  it("skips nodes with no invoiceId (a different action type, e.g. bulk_notify)", () => {
    expect(invoiceIdsForThread([node({ contactId: "abc" })])).toEqual(new Set())
  })
  it("empty for a node-less thread", () => {
    expect(invoiceIdsForThread([])).toEqual(new Set())
  })
})

describe("findRelevantPaymentEvents", () => {
  it("matches a real payment_recorded event against one of the thread's own invoiceIds", () => {
    const events = [paymentEvent("e1", "inv-1"), paymentEvent("e2", "inv-9")]
    const relevant = findRelevantPaymentEvents(events, new Set(["inv-1"]), new Set())
    expect(relevant.map((e) => e.id)).toEqual(["e1"])
  })

  it("ignores a non-payment event even if its payload happens to carry an invoiceId", () => {
    const events: EventRow[] = [{ id: "e1", entityType: "invoice", entityId: "e1", eventType: "invoice_sent", payload: { invoiceId: "inv-1" }, occurredAt: "t", source: "test" }]
    expect(findRelevantPaymentEvents(events, new Set(["inv-1"]), new Set())).toEqual([])
  })

  it("never re-surfaces an already-seen event id", () => {
    const events = [paymentEvent("e1", "inv-1")]
    expect(findRelevantPaymentEvents(events, new Set(["inv-1"]), new Set(["e1"]))).toEqual([])
  })

  it("returns nothing when the thread has no invoices to watch — never a false match", () => {
    expect(findRelevantPaymentEvents([paymentEvent("e1", "inv-1")], new Set(), new Set())).toEqual([])
  })

  it("a malformed payload (no invoiceId, or invoiceId not a string) never matches", () => {
    const events: EventRow[] = [
      { id: "e1", entityType: "payment", entityId: "e1", eventType: "payment_recorded", payload: {}, occurredAt: "t", source: "test" },
      { id: "e2", entityType: "payment", entityId: "e2", eventType: "payment_recorded", payload: { invoiceId: 42 }, occurredAt: "t", source: "test" },
      { id: "e3", entityType: "payment", entityId: "e3", eventType: "payment_recorded", payload: null, occurredAt: "t", source: "test" },
    ]
    expect(findRelevantPaymentEvents(events, new Set(["inv-1"]), new Set())).toEqual([])
  })
})
