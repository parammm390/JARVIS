import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const startTracePollMock = vi.fn()
vi.mock("./instruction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./instruction")>()
  return { ...actual, startTracePoll: (...args: unknown[]) => startTracePollMock(...args) }
})

const getCurrentAccessTokenMock = vi.fn<() => string | null>()
vi.mock("../lib/jarvis-auth", () => ({ getCurrentAccessToken: () => getCurrentAccessTokenMock() }))

import { startInstructionTransport } from "./transport"

const fetchMock = vi.fn<typeof fetch>()
const ORIGINAL_ENV = process.env.NEXT_PUBLIC_JARVIS_SSE

function responseWithFrames(frames: unknown[], keepOpen = false): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`))
      if (!keepOpen) controller.close()
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(responseWithFrames([], true))
  vi.stubGlobal("fetch", fetchMock)
  startTracePollMock.mockReset()
  startTracePollMock.mockReturnValue({ stop: vi.fn() })
  getCurrentAccessTokenMock.mockReset()
  getCurrentAccessTokenMock.mockReturnValue("real-access-token")
  // @ts-expect-error test-only browser origin
  globalThis.window = { location: { origin: "http://localhost:3000" } }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // @ts-expect-error test-only cleanup
  delete globalThis.window
  if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_JARVIS_SSE
  else process.env.NEXT_PUBLIC_JARVIS_SSE = ORIGINAL_ENV
})

describe("kernel/transport — authenticated instruction stream", () => {
  it("defaults to fetch-stream SSE and keeps the bearer token out of the URL", async () => {
    delete process.env.NEXT_PUBLIC_JARVIS_SSE
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [rawUrl, init] = fetchMock.mock.calls[0]!
    const url = new URL(String(rawUrl))
    expect(url.pathname).toBe("/api/jarvis/stream")
    expect(url.searchParams.get("instructionId")).toBe("i1")
    expect(url.searchParams.has("token")).toBe(false)
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer real-access-token")
    expect(onHealthChange).toHaveBeenCalledWith("live")
  })

  it("uses polling immediately when SSE is deliberately disabled", () => {
    process.env.NEXT_PUBLIC_JARVIS_SSE = "0"
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(startTracePollMock).toHaveBeenCalledWith("i1", expect.any(Function), 0, { onStatus: expect.any(Function) })
    expect(onHealthChange).toHaveBeenCalledWith("polling")
  })

  it("falls back to authenticated polling when no session token exists", () => {
    getCurrentAccessTokenMock.mockReturnValue(null)
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(startTracePollMock).toHaveBeenCalled()
    expect(onHealthChange).toHaveBeenCalledWith("polling")
  })

  it("parses a real frame, deduplicates sequence, and stops at terminal", async () => {
    const frame = { seq: 3, phase: "completed", payload: { actionId: "a1" }, createdAt: "t" }
    fetchMock.mockResolvedValue(responseWithFrames([frame, frame]))
    const onEvents = vi.fn()
    const handle = startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange: vi.fn() })
    await settle()
    expect(onEvents).toHaveBeenCalledTimes(1)
    expect(onEvents).toHaveBeenCalledWith([frame])
    handle.stop()
  })

  it("ignores malformed frames without inventing lifecycle state", async () => {
    fetchMock.mockResolvedValue(responseWithFrames(["not json"], true))
    const onEvents = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents, onHealthChange: vi.fn() })
    await settle()
    expect(onEvents).not.toHaveBeenCalled()
  })

  it("falls back after two consecutive connection failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"))
    const onHealthChange = vi.fn()
    startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange })
    await settle()
    expect(onHealthChange).toHaveBeenCalledWith("reconnecting")
    await vi.advanceTimersByTimeAsync(500)
    await settle()
    expect(onHealthChange).toHaveBeenCalledWith("unavailable")
    expect(startTracePollMock).toHaveBeenCalledWith("i1", expect.any(Function), 0, { onStatus: expect.any(Function) })
  })

  it("stop aborts the authenticated stream", async () => {
    const handle = startInstructionTransport({ instructionId: "i1", onEvents: vi.fn(), onHealthChange: vi.fn() })
    await settle()
    const signal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(signal?.aborted).toBe(false)
    handle.stop()
    expect(signal?.aborted).toBe(true)
  })
})
