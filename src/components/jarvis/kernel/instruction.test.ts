// Plan v3 P2.T4 evidence: sessionId minting/persistence is pure enough to unit
// test without a DOM (BLOCKER B-1) by stubbing a minimal sessionStorage on
// globalThis.window — no jsdom required, just the one API surface this module
// actually touches.

import { afterEach, describe, expect, it } from "vitest"
import { getOrCreateSessionId, resetSessionId, sessionIdForVoiceCall } from "./instruction"

function fakeSessionStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

afterEach(() => {
  // @ts-expect-error test-only global stub cleanup
  delete globalThis.window
})

describe("kernel/instruction — session id minting (P2.T4, closing the V8 gap)", () => {
  it("mints a 'web:<uuid>' id for voice when there is no window (SSR-safe)", () => {
    const id = getOrCreateSessionId("voice")
    expect(id).toMatch(/^web:[0-9a-f-]{36}$/)
  })

  it("mints a 'typed:<uuid>' id for typed when there is no window", () => {
    const id = getOrCreateSessionId("typed")
    expect(id).toMatch(/^typed:[0-9a-f-]{36}$/)
  })

  it("persists and reuses the SAME id across calls in the same sessionStorage (plan v3 §3.4)", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    const first = getOrCreateSessionId("voice")
    const second = getOrCreateSessionId("voice")
    expect(second).toBe(first)
  })

  it("voice and typed sessions are independent — different keys, different ids", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    const voice = getOrCreateSessionId("voice")
    const typed = getOrCreateSessionId("typed")
    expect(voice).not.toBe(typed)
    expect(voice.startsWith("web:")).toBe(true)
    expect(typed.startsWith("typed:")).toBe(true)
  })

  it("resetSessionId mints and persists a NEW id, replacing the old one", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    const original = getOrCreateSessionId("voice")
    const rotated = resetSessionId("voice")
    expect(rotated).not.toBe(original)
    expect(getOrCreateSessionId("voice")).toBe(rotated)
  })

  it("uses the provider call id as a namespaced voice session when one is exposed", () => {
    expect(sessionIdForVoiceCall(" call-123 ")).toBe("vapi:call-123")
    expect(sessionIdForVoiceCall(null)).toBeNull()
    expect(sessionIdForVoiceCall("   ")).toBeNull()
  })

  it("a storage exception (private mode) degrades to a fresh id, never throws", () => {
    const throwingStorage = {
      ...fakeSessionStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    }
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: throwingStorage }
    expect(() => getOrCreateSessionId("voice")).not.toThrow()
  })
})
