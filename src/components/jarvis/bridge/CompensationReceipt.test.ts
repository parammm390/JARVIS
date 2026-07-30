import { describe, expect, it } from "vitest"
import { compensationReceiptFromActual } from "./CompensationReceipt"

describe("P7.T3 compensation receipt", () => {
  it("recognizes only an explicit backend compensation result", () => {
    expect(compensationReceiptFromActual({ compensation: { status: "compensated", caseId: "case-1", reason: "customer canceled" } })).toEqual({ status: "compensated", caseId: "case-1", reason: "customer canceled" })
    expect(compensationReceiptFromActual({ status: "compensated" })).toBeNull()
  })
})
