// jarvis-v3 P5.T3 — pure-function coverage for risk-tier.ts (BLOCKER B-1: no
// component rendering tests in this environment, same posture as every prior
// phase's pure-function-only unit tests).

import { describe, it, expect } from "vitest"
import { deriveRiskTier, blastRadiusRecipientCount } from "./risk-tier"

describe("blastRadiusRecipientCount", () => {
  it("returns the real target count when the payload carries a targets array", () => {
    expect(blastRadiusRecipientCount({ targets: [{ householdId: "a" }, { householdId: "b" }] })).toBe(2)
  })

  it("returns 0 for a genuinely empty (but present) targets array — a known count, not unknown", () => {
    expect(blastRadiusRecipientCount({ targets: [] })).toBe(0)
  })

  it("returns null when targets is missing entirely", () => {
    expect(blastRadiusRecipientCount({ channel: "sms" })).toBeNull()
  })

  it("returns null when targets is present but not an array", () => {
    expect(blastRadiusRecipientCount({ targets: "not-an-array" })).toBeNull()
  })

  it("returns null for a non-object payload", () => {
    expect(blastRadiusRecipientCount(null)).toBeNull()
    expect(blastRadiusRecipientCount(undefined)).toBeNull()
    expect(blastRadiusRecipientCount("string")).toBeNull()
  })
})

describe("deriveRiskTier", () => {
  it("a real receipt's own riskTier always wins, for any action type", () => {
    expect(deriveRiskTier({ actionType: "start_invoice_to_cash_workflow", payload: {}, receipt: { riskTier: "medium" } })).toBe("medium")
  })

  it("bulk_notify_existing_customers with an unknown (missing) recipient count is forced high risk", () => {
    expect(deriveRiskTier({ actionType: "bulk_notify_existing_customers", payload: { channel: "sms" }, receipt: null })).toBe("high")
  })

  it("bulk_notify_existing_customers with a real, known count (including 0) is NOT forced high risk", () => {
    expect(deriveRiskTier({ actionType: "bulk_notify_existing_customers", payload: { targets: [] }, receipt: null })).toBe("low")
    expect(deriveRiskTier({ actionType: "bulk_notify_existing_customers", payload: { targets: [{ householdId: "a" }] }, receipt: null })).toBe("low")
  })

  it("every other action type is unaffected — still defaults to low with no receipt, exactly like before this phase", () => {
    expect(deriveRiskTier({ actionType: "assign_technician_to_visit", payload: { visitId: "v1" }, receipt: null })).toBe("low")
    expect(deriveRiskTier({ actionType: "start_water_test_workflow", payload: {}, receipt: undefined })).toBe("low")
  })
})
