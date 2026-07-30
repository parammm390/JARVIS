import { describe, expect, it } from "vitest"
import { isLegalReceiptRecovery, receiptRecoveryVerb } from "./receipt-recovery"

describe("P7.T5 receipt-bound run recovery", () => {
  it("maps only Retry and Escalate receipt failures to their run controls", () => {
    expect(receiptRecoveryVerb({ workflowRunId: "run-1", failure: { errorKind: "provider_error" } })).toBe("retry")
    expect(receiptRecoveryVerb({ workflowRunId: "run-1", failure: { errorKind: "policy_denied" } })).toBe("escalate")
    expect(receiptRecoveryVerb({ workflowRunId: "run-1", failure: { errorKind: "validation" } })).toBeNull()
    expect(receiptRecoveryVerb({ workflowRunId: null, failure: { errorKind: "provider_error" } })).toBeNull()
  })

  it("offers only server-legal transitions", () => {
    expect(isLegalReceiptRecovery("retry", "failed")).toBe(true)
    expect(isLegalReceiptRecovery("retry", "running")).toBe(false)
    expect(isLegalReceiptRecovery("escalate", "running")).toBe(true)
    expect(isLegalReceiptRecovery("escalate", "failed")).toBe(true)
    expect(isLegalReceiptRecovery("escalate", "completed")).toBe(false)
  })
})
