import { describe, expect, it } from "vitest"
import { operationalConsole } from "./OperationalConsole"

describe("OperationalConsole Ready projection copy", () => {
  it("preserves a source sentence while humanizing an underscored fallback", () => {
    expect(operationalConsole.reviewTitle("Henderson household needs one identifier", "clarification_request"))
      .toBe("Henderson household needs one identifier")
    expect(operationalConsole.reviewTitle(null, "service_reminder"))
      .toBe("Service Reminder")
    expect(operationalConsole.reviewTitle("payment_follow_up", "payment_follow_up"))
      .toBe("Payment Follow Up")
  })

  it("uses source status to describe the human next step without raw queue copy", () => {
    expect(operationalConsole.reviewStatusCopy("clarification_request", "pending")).toBe("Needs one detail")
    expect(operationalConsole.reviewStatusCopy("service_reminder", "pending")).toBe("Needs your decision")
    expect(operationalConsole.reviewStatusCopy("service_reminder", "blocked_integration_unavailable")).toBe("Needs attention")
  })
})
