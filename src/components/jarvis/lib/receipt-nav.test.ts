import { describe, expect, it } from "vitest"
import { receiptCopyText, receiptHash, receiptIdFromHash } from "./receipt-nav"

describe("receipt deep links", () => {
  it("round-trips the canonical receipt hash", () => {
    const id = "fixture-receipt-sync-invoice"
    expect(receiptIdFromHash(receiptHash(id))).toBe(id)
  })

  it("accepts UUID-shaped ids and rejects malformed hash paths", () => {
    expect(receiptIdFromHash("#receipt-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
    expect(receiptIdFromHash("#receipt-")).toBeNull()
    expect(receiptIdFromHash("#receipt-id/other")).toBeNull()
    expect(receiptIdFromHash("#run-123")).toBeNull()
  })

  it("copies useful receipt facts and an addressable link", () => {
    const copied = receiptCopyText({
      receiptId: "receipt-1",
      objective: "Check stock",
      outcome: "Recorded",
      href: "https://finnorai.com/jarvis/next#receipt-receipt-1",
    })
    expect(copied).toContain("Check stock")
    expect(copied).toContain("Outcome: Recorded")
    expect(copied).toContain("https://finnorai.com/jarvis/next#receipt-receipt-1")
  })
})
