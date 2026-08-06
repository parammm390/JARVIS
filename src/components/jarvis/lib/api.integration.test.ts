import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const tokenMock = vi.hoisted(() => vi.fn<() => string | null>())
vi.mock("./jarvis-auth", () => ({ getCurrentAccessToken: tokenMock }))

import {
  jarvisDelete,
  jarvisGet,
  jarvisPost,
  jarvisPut,
  JarvisApiError,
  JARVIS_GET_TIMEOUT_MS,
  JARVIS_MUTATION_TIMEOUT_MS,
  onJarvisRequest,
} from "./api"

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  tokenMock.mockReturnValue("caller-token")
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("JARVIS client boundary", () => {
  it("uses the caller token, preserves query params, and records a real response", async () => {
    const events: Array<{ method: string; path: string; status: number }> = []
    const unsubscribe = onJarvisRequest((event) => events.push(event))
    await expect(jarvisGet<{ ok: boolean }>("dispatch/map", { date: "2026-08-02" })).resolves.toEqual({ ok: true })
    unsubscribe()

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jarvis/dispatch/map?date=2026-08-02",
      expect.objectContaining({ method: "GET", cache: "no-store", headers: { authorization: "Bearer caller-token" }, signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual([expect.objectContaining({ method: "GET", path: "/dispatch/map", status: 200 })])
  })

  it("normalizes non-OK JSON responses without losing the backend message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Dispatch access required" }), { status: 403 }))
    await expect(jarvisGet("dispatch/map")).rejects.toMatchObject({
      name: "JarvisApiError",
      status: 403,
      retryable: false,
      message: "Dispatch access required",
    })
  })

  it("turns network failures into an explicit retryable degraded error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(jarvisGet("technician/my-day")).rejects.toMatchObject({
      name: "JarvisApiError",
      status: 503,
      retryable: true,
    })
  })

  it.each([
    ["GET", JARVIS_GET_TIMEOUT_MS, () => jarvisGet("data-quality/findings")],
    ["POST", JARVIS_MUTATION_TIMEOUT_MS, () => jarvisPost("data-quality/findings/finding-1/resolve", {})],
    ["PUT", JARVIS_MUTATION_TIMEOUT_MS, () => jarvisPut("policies/tenant-1/action", {})],
  ])("bounds a hanging %s request and publishes 504", async (_method, timeoutMs, run) => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
    }))
    const events: Array<{ status: number }> = []
    const unsubscribe = onJarvisRequest((event) => events.push(event))
    const pending = run()
    const rejection = expect(pending).rejects.toMatchObject({ status: 504, retryable: true })
    await vi.advanceTimersByTimeAsync(Number(timeoutMs) + 1)
    await rejection
    unsubscribe()
    expect(events.at(-1)?.status).toBe(504)
  })

  it("does not issue mutations without a session and makes the reason recoverable", async () => {
    tokenMock.mockReturnValue(null)
    await expect(jarvisPost("dispatch/map", {})).rejects.toBeInstanceOf(JarvisApiError)
    await expect(jarvisPut("policies/tenant-1/action", {})).rejects.toMatchObject({ status: 401, retryable: false })
    await expect(jarvisDelete("push-subscriptions")).rejects.toMatchObject({ status: 401, retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not treat a successful empty response as a hanging or parse failure", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(jarvisDelete("push-subscriptions")).resolves.toBeUndefined()
  })
})
