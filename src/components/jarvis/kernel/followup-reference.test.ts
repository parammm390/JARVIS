// jarvis-v3 P5.T5 — pure-function coverage for followup-reference.ts
// (BLOCKER B-1: no component rendering tests in this environment).

import { describe, it, expect } from "vitest"
import { looksLikeFollowUpReference } from "./followup-reference"

describe("looksLikeFollowUpReference", () => {
  it("matches the real phrase this session's own live test used", () => {
    expect(looksLikeFollowUpReference("Actually, make that Thursday instead")).toBe(true)
  })

  it("matches other real-world reference phrasings", () => {
    expect(looksLikeFollowUpReference("Chase that one again")).toBe(true)
    expect(looksLikeFollowUpReference("Do the same thing for the Petersons")).toBe(true)
    expect(looksLikeFollowUpReference("The second one please")).toBe(true)
    expect(looksLikeFollowUpReference("the one I mentioned earlier")).toBe(true)
    expect(looksLikeFollowUpReference("Also send it to the other household")).toBe(true)
    expect(looksLikeFollowUpReference("Instead, book it for Friday")).toBe(true)
  })

  it("does NOT match ordinary, self-contained instructions (the golden/flagship phrases)", () => {
    expect(looksLikeFollowUpReference("Chase everyone more than thirty days overdue")).toBe(false)
    expect(looksLikeFollowUpReference("Book a water test for the Hendersons this week and give it to whoever's closest")).toBe(false)
    expect(looksLikeFollowUpReference("Tell every customer on a softener plan that we're doing free hardness checks next month")).toBe(false)
    expect(looksLikeFollowUpReference("Assign Priya Nair to visit the Hendersons")).toBe(false)
  })

  it("is case-insensitive and tolerates surrounding punctuation", () => {
    expect(looksLikeFollowUpReference("ACTUALLY, MAKE THAT THURSDAY INSTEAD.")).toBe(true)
  })

  it("does not match an empty or unrelated string", () => {
    expect(looksLikeFollowUpReference("")).toBe(false)
    expect(looksLikeFollowUpReference("Create a lead for John Smith")).toBe(false)
  })
})
