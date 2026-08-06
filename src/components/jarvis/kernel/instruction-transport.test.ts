// Plan v3 P3.T11 evidence: startInstructionTransport's real SSE-with-fallback
// scheduling, unit tested by stubbing `EventSource`/`window`/auth token and
// mocking `./instruction`'s startTracePoll (no DOM — same B-1 pattern as
// instruction-trace-poll.test.ts's own jarvisGet mock).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const startTracePollMock = vi.fn()
vi.mock("./instruction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./instruction")>()
  return { ...actual, startTracePoll: (...args: unknown[]) => startTracePollMock(...args) }
})

const getCurrentAccessTokenMock = vi.fn<() => string | null>()
vi.mock("../lib/jarvis-auth", () => ({
  getCurrentAccessToken: () => getCurrentAccessTokenMock(),
}))

import { startInstructionTransport } from "./transport"

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
}

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_JARVIS_SSE

beforeEach(() => {
  vi.useFakeTimers()
  startTracePollMock.mockReset()
  startTracePollMock.mockReturnValue({ stop: vi.fn() })
  getCurrentAccessTokenMock.mockReset()
  getCurrentAccessTokenMock.mockReturnValue("real-access-token")
  FakeEventSource.instances = []
  // @ts-expect-error test-only global stub
  globalThis.EventSource = FakeEventSource
  // @ts-expect-error test-only global stub
  globalThis.window = { location: { origin: "http://localhost:3000" } }
})
afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error test-only global stub cleanup
  delete globalThis.EventSource
  // @ts-expect-error test-only global stub cleanup
  delete globalThis.window
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_JARVIS_SSE
  else process.env.NEXT_PUBLIC_JARVIS_SSE = ORIGINAL_ENV
})

describe("kernel/transport — startInstructionTransport (P3.T11)", () => {
  it("NEXT_PUBLIC_JARVIS_SSE unset -> SSE is enabled by default", () => {
    delete process.env.NEXT_PUBLIC_JARVIS_SSE
    const onEvents = vi.fn()
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange })
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(startTracePollMock).not.toHaveBeenCalled()
    expect(onHealthChange).not.toHaveBeenCalled()
  })

  it("NEXT_PUBLIC_JARVIS_SSE=0 -> polling immediately", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "0"
    const onEvents = vi.fn()
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange })
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(startTracePollMock).toHaveBeenCalledWith("i1", onEvents, 0, { onStatus: expect.any(Function) })
    expect(onHealthChange).toHaveBeenCalledWith("polling")
  })

  it("flag enabled but no access token -> falls back to polling, never opens a connection", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    getCurrentAccessTokenMock.mockReturnValue(null)
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(startTracePollMock).toHaveBeenCalledWith("i1", expect.any(Function), 0, { onStatus: expect.any(Function) })
    expect(onHealthChange).toHaveBeenCalledWith("polling")
  })

  it("flag enabled with a token -> opens a real EventSource at /api/jarvis/stream with instructionId+token", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange: vi.fn() })
    expect(FakeEventSource.instances).toHaveLength(1)
    const url = new URL(FakeEventSource.instances[0]!.url)
    expect(url.pathname).toBe("/api/jarvis/stream")
    expect(url.searchParams.get("instructionId")).toBe("i1")
    expect(url.searchParams.get("token")).toBe("real-access-token")
  })

  it("onopen -> reports 'live'", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    FakeEventSource.instances[0]!.onopen?.()
    expect(onHealthChange).toHaveBeenCalledWith("live")
  })

  it("onmessage -> parses the frame and delivers it to onEvents, tracking its seq", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onEvents = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange: vi.fn() })
    const frame = { seq: 3, phase: "planning", payload: {}, createdAt: "t" }
    FakeEventSource.instances[0]!.onmessage?.({ data: JSON.stringify(frame) })
    expect(onEvents).toHaveBeenCalledWith([frame])
  })

  it("a malformed onmessage frame is a real no-op — never throws, never delivers a fabricated event", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onEvents = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange: vi.fn() })
    expect(() => FakeEventSource.instances[0]!.onmessage?.({ data: "not json" })).not.toThrow()
    expect(onEvents).not.toHaveBeenCalled()
  })

  it("a terminal real frame closes the stream without opening a reconnect", async () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onEvents = vi.fn()
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange })
    const es = FakeEventSource.instances[0]!
    es.onmessage?.({ data: JSON.stringify({ seq: 9, phase: "completed", payload: {}, createdAt: "t" }) })

    expect(es.closed).toBe(true)
    expect(onEvents).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(onHealthChange).not.toHaveBeenCalledWith("reconnecting")
  })

  it("first onerror -> 'reconnecting', closes the dead connection, does NOT fall back yet", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    const first = FakeEventSource.instances[0]!
    first.onerror?.()
    expect(first.closed).toBe(true)
    expect(onHealthChange).toHaveBeenCalledWith("reconnecting")
    expect(startTracePollMock).not.toHaveBeenCalled()
  })

  it("a 2nd consecutive failure gives up to polling, resuming from the last seen seq", async () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const onEvents = vi.fn()
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange })

    FakeEventSource.instances[0]!.onmessage?.({ data: JSON.stringify({ seq: 5, phase: "planning", payload: {}, createdAt: "t" }) })
    FakeEventSource.instances[0]!.onerror?.() // failure 1 -> reconnecting, schedules a retry
    await vi.advanceTimersByTimeAsync(500)
    FakeEventSource.instances[1]!.onerror?.() // failure 2 -> gives up

    expect(onHealthChange).toHaveBeenCalledWith("unavailable")
    expect(startTracePollMock).toHaveBeenCalledWith("i1", onEvents, 5, { onStatus: expect.any(Function) })
  })

  it("stop() closes the EventSource and clears any pending reconnect", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const handle = startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange: vi.fn() })
    const es = FakeEventSource.instances[0]!
    handle.stop()
    expect(es.closed).toBe(true)
  })

  it("stop() after giving up to polling also stops the fallback poll", async () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "1"
    const stopPollMock = vi.fn()
    startTracePollMock.mockReturnValue({ stop: stopPollMock })
    const handle = startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange: vi.fn() })
    FakeEventSource.instances[0]!.onerror?.() // failure 1 -> schedules a retry
    await vi.advanceTimersByTimeAsync(500)
    FakeEventSource.instances[1]!.onerror?.() // failure 2 -> gives up, starts the fallback poll
    handle.stop()
    expect(stopPollMock).toHaveBeenCalled()
  })
})
