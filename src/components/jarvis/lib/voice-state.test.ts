import { describe, expect, it } from "vitest"
import { deriveVoiceStateCopy, type VoiceStateCopyInput } from "./voice-state"

function input(overrides: Partial<VoiceStateCopyInput> = {}): VoiceStateCopyInput {
  return {
    available: true,
    voiceState: "idle",
    userSpeaking: false,
    micSilenceWarning: false,
    lastError: null,
    retrying: false,
    ...overrides,
  }
}

describe("P2.T5 voice state copy", () => {
  it.each([
    ["unavailable", "Unavailable", input({ available: false })],
    ["connecting", "Connecting", input({ voiceState: "connecting" })],
    ["listening", "Listening", input({ voiceState: "live" })],
    ["hearing", "Hearing", input({ voiceState: "live", userSpeaking: true })],
    ["silence", "Silence", input({ voiceState: "live", micSilenceWarning: true })],
    ["speaking", "Speaking", input({ voiceState: "speaking" })],
    ["retrying", "Retrying", input({ retrying: true })],
    ["stopped", "Stopped", input()],
  ] as const)("maps the real session facts to %s", (state, label, current) => {
    expect(deriveVoiceStateCopy(current)).toMatchObject({ state, label })
  })

  it("preserves permission denial as a specific retryable state", () => {
    expect(deriveVoiceStateCopy(input({ voiceState: "error", lastError: "Microphone access was blocked. Allow microphone access for this site, then retry." }))).toMatchObject({
      state: "permission-denied",
      label: "Permission denied",
      retryable: true,
    })
  })

  it("does not turn a non-permission error into a false permission claim", () => {
    expect(deriveVoiceStateCopy(input({ voiceState: "error", lastError: "The voice session timed out while connecting." }))).toMatchObject({
      state: "error",
      label: "Needs attention",
      retryable: true,
    })
  })

  it("shows Hearing when real local mic activity barges in during assistant speech", () => {
    expect(deriveVoiceStateCopy(input({ voiceState: "speaking", userSpeaking: true }))).toMatchObject({
      state: "hearing",
      label: "Hearing",
      detail: "I hear you.",
    })
  })

  it("lets current local mic activity clear a stale silence warning", () => {
    expect(deriveVoiceStateCopy(input({ voiceState: "speaking", userSpeaking: true, micSilenceWarning: true }))).toMatchObject({
      state: "hearing",
      label: "Hearing",
    })
  })
})
