import { describe, expect, it } from "vitest"
import { nextVoiceFinalIntent } from "./voice-final-intent"

describe("nextVoiceFinalIntent", () => {
  it("submits the first final added after a new session starts", () => {
    const history = [{ role: "you" as const, text: "old request" }]
    const transcript = [...history, { role: "you" as const, text: "schedule the visit" }]

    expect(nextVoiceFinalIntent(transcript, history.length, null)).toEqual({
      key: "1:schedule the visit",
      text: "schedule the visit",
    })
  })

  it("does not replay transcript history or a processed final", () => {
    const transcript = [{ role: "you" as const, text: "show overdue invoices" }]

    expect(nextVoiceFinalIntent(transcript, transcript.length, null)).toBeNull()
    expect(nextVoiceFinalIntent(transcript, 0, "0:show overdue invoices")).toBeNull()
  })

  it("ignores assistant output and blank user finals", () => {
    expect(nextVoiceFinalIntent([
      { role: "you", text: "  " },
      { role: "jarvis", text: "I found three" },
    ], 0, null)).toBeNull()
  })
})
