import { describe, expect, it } from "vitest"
import { getConversationalVoiceReply } from "./voice-intent"

describe("getConversationalVoiceReply", () => {
  it("answers a standalone hello without inventing a business action", () => {
    expect(getConversationalVoiceReply("Hello")).toBe("Hello. What would you like me to handle?")
    expect(getConversationalVoiceReply("  HELLO!!!  ")).toBe("Hello. What would you like me to handle?")
  })

  it("handles other standalone greetings", () => {
    expect(getConversationalVoiceReply("Good morning.")).toBe("Good morning. What would you like me to handle?")
    expect(getConversationalVoiceReply("Are you there, Jarvis?")).toBe("I’m here and ready. What would you like me to handle?")
    expect(getConversationalVoiceReply("Don't you speak?")).toBe("Yes. I can speak. What would you like me to handle?")
    expect(getConversationalVoiceReply("Can you hear me?")).toBe("I can hear you. What would you like me to handle?")
  })

  it("does not swallow a real request that happens to begin with hello", () => {
    expect(getConversationalVoiceReply("Hello, show me overdue invoices")).toBeNull()
    expect(getConversationalVoiceReply("Hey, check the pipeline")).toBeNull()
    expect(getConversationalVoiceReply("How many invoices are overdue?")).toBeNull()
  })
})
