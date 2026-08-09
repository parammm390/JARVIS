import { describe, expect, it } from "vitest"
import { buildAgingSummary, deriveAgingBand, filterCollectionWork } from "./CashPressureSurface"
import type { InvoiceResource, WorkCaseProjection } from "@/lib/jarvis-client"

const now = new Date("2026-08-08T00:00:00.000Z")

function invoice(overrides: Partial<InvoiceResource> = {}): InvoiceResource {
  return {
    id: "invoice-1",
    tenantId: "tenant-1",
    householdId: "household-1",
    amountUsd: 100,
    status: "sent",
    memo: "Service invoice",
    dueDate: "2026-08-08T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function workCase(actionTypes: string[]): WorkCaseProjection {
  return {
    id: `case-${actionTypes.join("-")}`,
    root: { kind: "instruction", id: "instruction-1" },
    title: "Invoice follow-up",
    status: "Waiting",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    source: { kind: "typed", id: "instruction-1", channel: "typed" },
    instruction: null,
    actions: actionTypes.map((actionType, index) => ({
      id: `action-${index}`,
      actionType,
      status: "pending",
      summary: actionType,
      instructionId: "instruction-1",
      planId: null,
      dependsOn: [],
      payload: {},
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    })),
    approvals: [],
    workflows: [],
    receipts: [],
    linkedEntities: [],
    businessEvents: [],
    calls: [],
    relatedActionIds: [],
    provenance: [],
  }
}

describe("P2.T5 Cash Pressure Field contract", () => {
  it("keeps exact due-date aging boundaries", () => {
    expect(deriveAgingBand("2026-08-09T00:00:00.000Z", now)).toBe("current")
    expect(deriveAgingBand("2026-08-07T00:00:00.000Z", now)).toBe("1-30")
    expect(deriveAgingBand("2026-07-08T00:00:00.000Z", now)).toBe("31-60")
    expect(deriveAgingBand("2026-06-08T00:00:00.000Z", now)).toBe("61-90")
    expect(deriveAgingBand("2026-05-09T00:00:00.000Z", now)).toBe("90+")
  })

  it("renders aging only when every open invoice has due date and amount truth", () => {
    const summary = buildAgingSummary([
      invoice({ id: "current", amountUsd: 100, dueDate: "2026-08-09T00:00:00.000Z" }),
      invoice({ id: "overdue", amountUsd: "250", status: "overdue", dueDate: "2026-07-08T00:00:00.000Z" }),
      invoice({ id: "paid", amountUsd: 900, status: "paid", dueDate: null }),
    ], now)
    expect(summary.eligible).toBe(true)
    expect(summary.bands.find((band) => band.key === "current")?.totalUsd).toBe(100)
    expect(summary.bands.find((band) => band.key === "31-60")?.invoiceIds).toEqual(["overdue"])

    const fallback = buildAgingSummary([invoice({ dueDate: null })], now)
    expect(fallback.eligible).toBe(false)
    expect(fallback.reason).toContain("no usable due date or amount")
  })

  it("filters Collections Work by the exact invoice-to-cash action family", () => {
    const collection = workCase(["send_payment_reminder"])
    const unrelated = workCase(["schedule_service_visit"])
    expect(filterCollectionWork([collection, unrelated]).map((item) => item.id)).toEqual([collection.id])
  })
})
