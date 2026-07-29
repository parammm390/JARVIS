// jarvis-v3 P4.T2/P4.T3 — pure-function coverage for flattenForDisplay/
// formatFieldValue, shared by the approval card's predicted-outcome expand
// (T2) and bridge/ThreadVerification.tsx's predicted<->actual diff (T3). Also
// the replacement for lib/ReceiptDrawer.tsx's old JsonBlock — a real, live
// raw-JSON violation this session's own binding required finding and fixing
// (hard rule 8: no raw JSON on any customer-facing surface). No rendering here
// (BLOCKER B-1) — these two functions are plain data transforms, testable
// exactly like every other kernel/lib pure function.

import { describe, it, expect } from "vitest"
import { flattenForDisplay, formatFieldValue } from "./field-format"

describe("flattenForDisplay", () => {
  it("flattens a nested object into dotted-path rows", () => {
    const rows = flattenForDisplay({ invoiceId: "inv-1", fieldChanges: { field: "workflow", to: "invoice_to_cash" } })
    expect(rows).toEqual(
      expect.arrayContaining([
        { path: "invoiceId", value: "inv-1" },
        { path: "fieldChanges.field", value: "workflow" },
        { path: "fieldChanges.to", value: "invoice_to_cash" },
      ]),
    )
  })

  it("treats an array as a single leaf value, never expands into indexed paths", () => {
    expect(flattenForDisplay({ steps: ["create_payment_link", "send_message"] })).toEqual([
      { path: "steps", value: ["create_payment_link", "send_message"] },
    ])
  })

  it("returns no rows for null/undefined/empty-object top-level input — never a fabricated row", () => {
    expect(flattenForDisplay(null)).toEqual([])
    expect(flattenForDisplay(undefined)).toEqual([])
    expect(flattenForDisplay({})).toEqual([])
  })

  it("a bare scalar at the top becomes a single 'value' row", () => {
    expect(flattenForDisplay(42)).toEqual([{ path: "value", value: 42 }])
  })

  it("never throws on a malformed/circular-free arbitrary shape", () => {
    expect(() => flattenForDisplay({ a: { b: { c: { d: 1 } } } })).not.toThrow()
  })
})

describe("formatFieldValue", () => {
  it("renders null/undefined as an em dash, never a fabricated zero or blank", () => {
    expect(formatFieldValue(null)).toBe("—")
    expect(formatFieldValue(undefined)).toBe("—")
  })
  it("renders booleans as yes/no", () => {
    expect(formatFieldValue(true)).toBe("yes")
    expect(formatFieldValue(false)).toBe("no")
  })
  it("renders numbers verbatim, NaN/Infinity as an em dash", () => {
    expect(formatFieldValue(890)).toBe("890")
    expect(formatFieldValue(Number.NaN)).toBe("—")
  })
  it("renders an empty array as 'none', a populated one joined", () => {
    expect(formatFieldValue([])).toBe("none")
    expect(formatFieldValue(["a", "b"])).toBe("a, b")
  })
  it("never dumps raw JSON for a nested object — the whole point of this replacing JsonBlock", () => {
    expect(formatFieldValue({ a: 1 })).not.toContain("{")
    expect(formatFieldValue({})).toBe("—")
  })
})
