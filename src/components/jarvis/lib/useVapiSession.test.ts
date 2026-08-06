import { describe, expect, it } from "vitest"
import {
  interpretTranscriptMessage,
  isVapiEventForCall,
  isVoiceOutputEligible,
  readVapiCallId,
  transcriptMessageKey,
  updateVapiCallIdentity,
} from "./useVapiSession"

describe("interpretTranscriptMessage", () => {
  it("keeps replacing a user's real partial transcript", () => {
    expect(interpretTranscriptMessage({ type: "transcript", role: "user", transcript: "show me" })).toEqual({
      kind: "partial",
      text: "show me",
    })
    expect(interpretTranscriptMessage({ type: "transcript", role: "user", transcript: "show me overdue" })).toEqual({
      kind: "partial",
      text: "show me overdue",
    })
  })

  it("turns a final user event into one Heard line and keeps assistant turns distinct", () => {
    expect(interpretTranscriptMessage({ type: "transcript", role: "user", transcriptType: "final", transcript: "show me overdue invoices" })).toEqual({
      kind: "final",
      line: { role: "you", text: "show me overdue invoices" },
    })
    expect(interpretTranscriptMessage({ type: "transcript", role: "assistant", transcriptType: "final", transcript: "I found them" })).toEqual({
      kind: "final",
      line: { role: "jarvis", text: "I found them" },
    })
    expect(interpretTranscriptMessage({ type: "transcript", role: "assistant", transcript: "I am still speaking" })).toEqual({ kind: "ignore" })
  })

  it("accepts only explicit Vapi user/assistant roles for final transcripts", () => {
    expect(interpretTranscriptMessage({ type: "transcript", transcriptType: "final", transcript: "missing role" })).toEqual({ kind: "ignore" })
    expect(interpretTranscriptMessage({ type: "transcript", role: "system", transcriptType: "final", transcript: "system text" })).toEqual({ kind: "ignore" })
    expect(interpretTranscriptMessage({ type: "transcript", role: "User", transcriptType: "final", transcript: "wrong case" })).toEqual({ kind: "ignore" })
    expect(interpretTranscriptMessage({ type: "transcript[transcriptType='final']", role: "user", transcript: "explicit final" })).toEqual({
      kind: "final",
      line: { role: "you", text: "explicit final" },
    })
  })

  it("ignores non-transcript and empty events rather than inventing text", () => {
    expect(interpretTranscriptMessage({ type: "status-update", transcript: "not a transcript" })).toEqual({ kind: "ignore" })
    expect(interpretTranscriptMessage({ type: "transcript", role: "user", transcript: "" })).toEqual({ kind: "ignore" })
  })
})

describe("Vapi call-scoped voice guards", () => {
  it("surfaces SDK call ids and rejects late events from an ended or different call", () => {
    expect(readVapiCallId({ callId: "call-current" })).toBe("call-current")
    expect(readVapiCallId({ call: { id: "call-nested" } })).toBe("call-nested")
    expect(isVapiEventForCall("call-old", "call-current", new Set(["call-old"]))).toBe(false)
    expect(isVapiEventForCall("call-other", "call-current")).toBe(false)
    expect(isVapiEventForCall(null, "call-current")).toBe(true)
  })

  it("keeps the immutable browser session id when Vapi reports its provider id", () => {
    expect(updateVapiCallIdentity({ voiceSessionId: "voice-session-1", vapiCallId: null }, { callId: "vapi-call-1" })).toEqual({
      voiceSessionId: "voice-session-1",
      vapiCallId: "vapi-call-1",
    })
  })

  it("gives duplicate final events the same key for one-call rejection", () => {
    const message = { type: "transcript", role: "user", transcriptType: "final", transcript: "same request", call: { id: "call-1" } }
    const update = interpretTranscriptMessage(message)
    expect(transcriptMessageKey(message, update, "call-1")).toBe(transcriptMessageKey(message, update, "call-1"))
  })

  it("only permits output while the current call is active and armed", () => {
    expect(isVoiceOutputEligible({ callActive: true, outputArmed: true, activeCallId: "call-1" })).toBe(true)
    expect(isVoiceOutputEligible({ callActive: false, outputArmed: true, activeCallId: "call-1" })).toBe(false)
    expect(isVoiceOutputEligible({ callActive: true, outputArmed: false, activeCallId: "call-1" })).toBe(false)
    expect(isVoiceOutputEligible({ callActive: true, outputArmed: true, activeCallId: "call-1", expectedCallId: "call-old" })).toBe(false)
  })
})
