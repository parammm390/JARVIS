// Plan v3 P3.T8 evidence: the restore-after-refresh pointer (persist/read/clear),
// unit tested by stubbing sessionStorage — same no-jsdom pattern as
// instruction.test.ts's own sessionStorage stub (BLOCKER B-1).

import { afterEach, describe, expect, it } from "vitest"
import { clearActiveThreadPointer, persistActiveThreadPointer, readActiveThreadPointer, type ActiveThreadPointer } from "./store"

function fakeSessionStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

const SAMPLE: ActiveThreadPointer = {
  id: "thread-1",
  sessionId: "typed:abc",
  instructionId: "11111111-1111-4111-8111-111111111111",
  source: "typed",
  instructionText: "Chase everyone more than thirty days overdue",
  createdAtMs: 12345,
}

afterEach(() => {
  // @ts-expect-error test-only global stub cleanup
  delete globalThis.window
})

describe("kernel/store — active thread pointer (P3.T8 restore-after-refresh)", () => {
  it("readActiveThreadPointer returns null with no window (SSR-safe)", () => {
    expect(readActiveThreadPointer()).toBeNull()
  })

  it("persist then read round-trips the exact pointer", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    persistActiveThreadPointer(SAMPLE)
    expect(readActiveThreadPointer()).toEqual(SAMPLE)
  })

  it("clear removes it — a subsequent read returns null", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    persistActiveThreadPointer(SAMPLE)
    clearActiveThreadPointer()
    expect(readActiveThreadPointer()).toBeNull()
  })

  it("malformed/partial JSON in storage is a real no-op — never throws, never returns a fabricated pointer", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    window.sessionStorage.setItem("jarvis.thread.active", JSON.stringify({ id: "only-an-id" }))
    expect(() => readActiveThreadPointer()).not.toThrow()
    expect(readActiveThreadPointer()).toBeNull()
  })

  it("non-JSON garbage in storage is a real no-op", () => {
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: fakeSessionStorage() }
    window.sessionStorage.setItem("jarvis.thread.active", "{not json")
    expect(readActiveThreadPointer()).toBeNull()
  })

  it("a storage exception (private mode) degrades to a silent no-op on persist, never throws", () => {
    const throwingStorage = {
      ...fakeSessionStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    }
    // @ts-expect-error test-only global stub
    globalThis.window = { sessionStorage: throwingStorage }
    expect(() => persistActiveThreadPointer(SAMPLE)).not.toThrow()
  })
})
