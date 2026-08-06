import { describe, expect, it } from "vitest"
import { authoritativeDecisionWave } from "./decision-wave"

describe("LF-09 authoritative decision wave", () => {
  it("does not produce a wave for a press/sending event", () => {
    expect(authoritativeDecisionWave({ verb: "confirm", actionId: "a-1", authoritative: false })).toBeNull()
    expect(authoritativeDecisionWave({ verb: "confirm", actionId: "a-1" })).toBeNull()
  })

  it("maps the server-confirmed decision to its semantic tone", () => {
    expect(authoritativeDecisionWave({ verb: "confirm", actionId: "a-1", authoritative: true })).toEqual({ actionId: "a-1", verb: "confirm", tone: "green" })
    expect(authoritativeDecisionWave({ verb: "reject", actionId: "a-2", authoritative: true })).toMatchObject({ tone: "red" })
    expect(authoritativeDecisionWave({ verb: "escalate", actionId: "a-3", authoritative: true })).toMatchObject({ tone: "amber" })
  })
})
