// Plan v3 P3.T6 evidence: startTracePoll's real scheduling/stopping logic, unit
// tested by mocking `../lib/api`'s jarvisGet (no DOM — B-1's own pattern, carried
// forward: this module does real I/O, so it is tested by controlling the I/O
// boundary and Vitest's fake timers, not by pretending it is pure).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const jarvisGetMock = vi.fn()
vi.mock("../lib/api", () => ({
  jarvisGet: (...args: unknown[]) => jarvisGetMock(...args),
  jarvisPost: vi.fn(),
}))

import { mintInstructionId, startTracePoll, TRACE_POLL_CEILING_MS, TRACE_POLL_INTERVAL_MS } from "./instruction"

beforeEach(() => {
  vi.useFakeTimers()
  jarvisGetMock.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("kernel/instruction — mintInstructionId (P3.T6)", () => {
  it("mints a bare uuid (no source prefix, unlike sessionId)", () => {
    const id = mintInstructionId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("mints a fresh id every call — never reused across submissions", () => {
    expect(mintInstructionId()).not.toBe(mintInstructionId())
  })
})

describe("kernel/instruction — startTracePoll (P3.T6, §7.1 Stage 1)", () => {
  it("polls immediately on start, with after=0", async () => {
    jarvisGetMock.mockResolvedValue({ events: [] })
    startTracePoll("instr-1", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    expect(jarvisGetMock).toHaveBeenCalledWith("instructions/instr-1/events", { after: "0" })
  })

  it("polls again after 400ms, passing the last-seen seq as `after`", async () => {
    jarvisGetMock.mockResolvedValueOnce({ events: [{ seq: 3, phase: "planning", payload: {}, createdAt: "t" }] })
    jarvisGetMock.mockResolvedValueOnce({ events: [] })
    startTracePoll("instr-2", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS)
    expect(jarvisGetMock).toHaveBeenCalledTimes(2)
    expect(jarvisGetMock).toHaveBeenLastCalledWith("instructions/instr-2/events", { after: "3" })
  })

  it("delivers new events to onEvents in the order the server returned them", async () => {
    const received: unknown[] = []
    jarvisGetMock.mockResolvedValue({
      events: [
        { seq: 1, phase: "received", payload: {}, createdAt: "t1" },
        { seq: 2, phase: "context_retrieved", payload: { chips: [] }, createdAt: "t2" },
      ],
    })
    startTracePoll("instr-3", (events) => received.push(...events))
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect((received[0] as { phase: string }).phase).toBe("received")
    expect((received[1] as { phase: string }).phase).toBe("context_retrieved")
  })

  it("stops on a 'completed' event — no further polls", async () => {
    jarvisGetMock.mockResolvedValueOnce({ events: [{ seq: 1, phase: "completed", payload: {}, createdAt: "t" }] })
    startTracePoll("instr-4", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS * 3)
    expect(jarvisGetMock).toHaveBeenCalledTimes(1)
  })

  it("stops on a 'failed' event — no further polls", async () => {
    jarvisGetMock.mockResolvedValueOnce({ events: [{ seq: 1, phase: "failed", payload: {}, createdAt: "t" }] })
    startTracePoll("instr-5", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS * 3)
    expect(jarvisGetMock).toHaveBeenCalledTimes(1)
  })

  it("does NOT stop on a non-terminal phase — keeps polling", async () => {
    jarvisGetMock.mockResolvedValue({ events: [{ seq: 1, phase: "action_gated", payload: {}, createdAt: "t" }] })
    startTracePoll("instr-6", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS)
    expect(jarvisGetMock).toHaveBeenCalledTimes(2)
  })

  it("stops at the 120s ceiling even with no terminal event", async () => {
    jarvisGetMock.mockResolvedValue({ events: [] })
    startTracePoll("instr-7", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_CEILING_MS + TRACE_POLL_INTERVAL_MS * 2)
    const callsAtCeiling = jarvisGetMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS * 5)
    expect(jarvisGetMock.mock.calls.length).toBe(callsAtCeiling)
  })

  it("a transient poll failure does not stop the poll — tries again next tick", async () => {
    jarvisGetMock.mockRejectedValueOnce(new Error("network blip"))
    jarvisGetMock.mockResolvedValueOnce({ events: [] })
    startTracePoll("instr-8", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS)
    expect(jarvisGetMock).toHaveBeenCalledTimes(2)
  })

  it("external .stop() halts future polls immediately", async () => {
    jarvisGetMock.mockResolvedValue({ events: [] })
    const handle = startTracePoll("instr-9", () => {})
    await vi.waitFor(() => expect(jarvisGetMock).toHaveBeenCalledTimes(1))
    handle.stop()
    await vi.advanceTimersByTimeAsync(TRACE_POLL_INTERVAL_MS * 5)
    expect(jarvisGetMock).toHaveBeenCalledTimes(1)
  })
})
