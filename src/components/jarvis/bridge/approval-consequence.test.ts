import { describe, expect, it } from "vitest"
import { approvalConsequenceLines, approvalConsequenceSummary, describeApprovalConsequence } from "./approval-consequence"

describe("approval consequences", () => {
  it("renders a real bulk-notify recipient count and channel", () => {
    expect(
      describeApprovalConsequence({
        actionType: "bulk_notify_existing_customers",
        payload: { channel: "sms", targets: [{ householdId: "1" }, { householdId: "2" }] },
      }),
    ).toBe("2 customers will be texted via SMS.")
  })

  it("keeps an unknown bulk recipient count honest", () => {
    expect(describeApprovalConsequence({ actionType: "bulk_notify_existing_customers", payload: { channel: "sms" } })).toBe(
      "An unknown number of customers will be texted.",
    )
  })

  it("describes water-test and technician actions without borrowing texting or dollar copy", () => {
    const lines = approvalConsequenceLines([
      { actionType: "start_water_test_workflow", payload: { scheduledAt: "2026-08-05T15:00:00.000Z", phoneNumber: "+13195550142" } },
      { actionType: "assign_technician_to_visit", payload: { technicianName: "Priya Nair" } },
    ])
    expect(lines).toEqual([
      "Hold a water test appointment on 2026-08-05 and send a confirmation to +13195550142.",
      "Assign Priya Nair to the visit.",
    ])
    expect(lines.join(" ")).not.toMatch(/customers? will be texted|\$/i)
  })

  it("groups repeated actions without inventing a cross-action total", () => {
    expect(
      approvalConsequenceLines([
        { actionType: "start_invoice_to_cash_workflow", payload: {} },
        { actionType: "start_invoice_to_cash_workflow", payload: {} },
      ]),
    ).toEqual([
      "2× create a payment link, send it to the customer, and sync the invoice.",
    ])
  })

  it("only aggregates recipient, money, and policy facts that are complete", () => {
    expect(
      approvalConsequenceSummary([
        { actionType: "bulk_notify_existing_customers", payload: { targets: [{ id: "1" }, { id: "2" }] }, policyVersion: 4, amountUsd: null },
        { actionType: "bulk_notify_existing_customers", payload: { targets: [{ id: "3" }] }, policyVersion: 4, amountUsd: null },
      ]),
    ).toEqual({ actionCount: 2, recipientCount: 3, totalAmountUsd: null, policyVersions: [4] })

    expect(
      approvalConsequenceSummary([
        { actionType: "record_payment", payload: {}, amountUsd: 120, policyVersion: 2 },
        { actionType: "record_payment", payload: {}, amountUsd: 80, policyVersion: 3 },
      ]),
    ).toEqual({ actionCount: 2, recipientCount: null, totalAmountUsd: 200, policyVersions: [2, 3] })

    expect(
      approvalConsequenceSummary([
        { actionType: "record_payment", payload: {}, amountUsd: 120, policyVersion: null },
        { actionType: "record_payment", payload: {}, amountUsd: null, policyVersion: null },
      ]),
    ).toEqual({ actionCount: 2, recipientCount: null, totalAmountUsd: null, policyVersions: [] })
  })
})
