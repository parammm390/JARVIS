import { describe, expect, it } from "vitest"
import { reviewStatusCopy, reviewTitle } from "./operational-console-copy"

describe("OperationalConsole Ready projection copy", () => {
  it("preserves a source sentence while humanizing an underscored fallback", () => {
    expect(reviewTitle("Henderson household needs one identifier", "clarification_request"))
      .toBe("Henderson household needs one identifier")
    expect(reviewTitle(null, "service_reminder"))
      .toBe("Service Reminder")
    expect(reviewTitle("payment_follow_up", "payment_follow_up"))
      .toBe("Payment Follow Up")
  })

  it("uses source status to describe the human next step without raw queue copy", () => {
    expect(reviewStatusCopy("clarification_request", "pending")).toBe("Needs one detail")
    expect(reviewStatusCopy("service_reminder", "pending")).toBe("Needs your decision")
    expect(reviewStatusCopy("service_reminder", "blocked_integration_unavailable")).toBe("Needs attention")
  })
})
