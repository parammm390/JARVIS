// Plan v3 P2.T1 evidence: presence derivation order (§4.5), all 12 values reached,
// and the C-13 regression guard (voiceState "connecting" must never read as
// "planning" directly — Bridge.tsx:73-88's `useOrbLiveState` is deleted in P2.T12
// precisely because it computed presence itself; this is the one place that may).

import { describe, expect, it } from "vitest"
import { derivePresence, type PresenceInput } from "./presence"

function input(over: Partial<PresenceInput> = {}): PresenceInput {
  return {
    transport: "live",
    activeInstructionState: null,
    terminalDecayActive: false,
    voiceSpeaking: false,
    micOpen: false,
    blockedCount: 0,
    needsHumanReviewCount: 0,
    ...over,
  }
}

describe("kernel/presence — derivation order, first match wins", () => {
  it("rule 1: offline transport -> severed, even with an active thread", () => {
    expect(derivePresence(input({ transport: "offline", activeInstructionState: "executing" }))).toBe("severed")
  })

  it("rule 1 does not fire for polling/reconnecting — a transient blip does not sever the Orb", () => {
    expect(derivePresence(input({ transport: "polling" }))).not.toBe("severed")
    expect(derivePresence(input({ transport: "reconnecting" }))).not.toBe("severed")
  })

  it.each<[string, string]>([
    ["captured", "thinking"],
    ["understanding", "thinking"],
    ["planning", "thinking"],
    ["clarifying", "asking"],
    ["awaiting_approval", "proposing"],
    ["executing", "working"],
    ["verifying", "verifying"],
  ])("rule 2: %s -> %s", (state, presence) => {
    expect(derivePresence(input({ activeInstructionState: state as PresenceInput["activeInstructionState"] }))).toBe(presence)
  })

  it("rule 2: completed + terminal decay active -> resolved", () => {
    expect(derivePresence(input({ activeInstructionState: "completed", terminalDecayActive: true }))).toBe("resolved")
  })

  it("rule 2: completed + decay elapsed -> falls through (not resolved)", () => {
    expect(derivePresence(input({ activeInstructionState: "completed", terminalDecayActive: false }))).not.toBe("resolved")
  })

  it("rule 2: failed + terminal decay active -> wounded", () => {
    expect(derivePresence(input({ activeInstructionState: "failed", terminalDecayActive: true }))).toBe("wounded")
  })

  it("rule 2: partial + terminal decay active -> wounded (never resolved — §6⑦ 'never a blanket done')", () => {
    expect(derivePresence(input({ activeInstructionState: "partial", terminalDecayActive: true }))).toBe("wounded")
  })

  it("rule 2: cancelled carries no presence signal — falls through to rule 5 (dormant)", () => {
    expect(derivePresence(input({ activeInstructionState: "cancelled", terminalDecayActive: true }))).toBe("dormant")
  })

  it("rule 3: voice speaking -> hearing, outranking idle voice/blocked", () => {
    expect(derivePresence(input({ voiceSpeaking: true }))).toBe("hearing")
  })

  it("rule 3: mic open (not speaking) -> listening", () => {
    expect(derivePresence(input({ micOpen: true }))).toBe("listening")
  })

  it("rule 3 outranks rule 4: speaking while blocked actions exist still reads as hearing", () => {
    expect(derivePresence(input({ voiceSpeaking: true, blockedCount: 3 }))).toBe("hearing")
  })

  it("rule 4: blocked actions with no instruction/voice -> obstructed", () => {
    expect(derivePresence(input({ blockedCount: 1 }))).toBe("obstructed")
  })

  it("rule 4: needs-human-review with no instruction/voice -> obstructed", () => {
    expect(derivePresence(input({ needsHumanReviewCount: 2 }))).toBe("obstructed")
  })

  it("rule 5: nothing happening -> dormant", () => {
    expect(derivePresence(input())).toBe("dormant")
  })

  it("C-13 regression guard: a merely-connecting voice session with no instruction never reads as thinking/planning", () => {
    // The legacy bug (Bridge.tsx:73-88) read `voiceState === 'connecting'` as
    // "planning" directly. This kernel has no "connecting" input at all — a
    // connecting call is neither speaking nor mic-open-and-listening yet, so it
    // must fall all the way through to dormant, never invent a cognition state.
    expect(derivePresence(input({ voiceSpeaking: false, micOpen: false }))).toBe("dormant")
  })

  it("rule 2 outranks rule 3: an active instruction wins over a merely-open mic", () => {
    expect(derivePresence(input({ activeInstructionState: "planning", micOpen: true }))).toBe("thinking")
  })

  it("all 12 Presence values are reachable", () => {
    const reached = new Set<string>()
    reached.add(derivePresence(input({ transport: "offline" })))
    reached.add(derivePresence(input({ activeInstructionState: "captured" })))
    reached.add(derivePresence(input({ activeInstructionState: "clarifying" })))
    reached.add(derivePresence(input({ activeInstructionState: "awaiting_approval" })))
    reached.add(derivePresence(input({ activeInstructionState: "executing" })))
    reached.add(derivePresence(input({ activeInstructionState: "verifying" })))
    reached.add(derivePresence(input({ activeInstructionState: "completed", terminalDecayActive: true })))
    reached.add(derivePresence(input({ activeInstructionState: "failed", terminalDecayActive: true })))
    reached.add(derivePresence(input({ voiceSpeaking: true })))
    reached.add(derivePresence(input({ micOpen: true })))
    reached.add(derivePresence(input({ blockedCount: 1 })))
    reached.add(derivePresence(input()))
    expect(reached).toEqual(
      new Set(["severed", "thinking", "asking", "proposing", "working", "verifying", "resolved", "wounded", "hearing", "listening", "obstructed", "dormant"]),
    )
  })
})
