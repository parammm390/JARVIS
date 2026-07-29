import { describe, expect, it } from "vitest"
import { deriveTransportHealth, OFFLINE_AFTER_MS } from "./transport"

describe("kernel/transport — general lane signal (no active thread tracing)", () => {
  it("signed out -> polling (the page shows its own sign-in gate; this value is moot there)", () => {
    expect(deriveTransportHealth({ signedIn: false, statsDegraded: true, degradedForMs: 999_999 })).toBe("polling")
  })

  it("signed in, healthy -> polling", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: false, degradedForMs: null })).toBe("polling")
  })

  it("signed in, just started failing -> reconnecting", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: true, degradedForMs: 100 })).toBe("reconnecting")
  })

  it("signed in, degraded right up to the threshold -> still reconnecting", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: true, degradedForMs: OFFLINE_AFTER_MS - 1 })).toBe("reconnecting")
  })

  it("signed in, degraded past the threshold -> offline", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: true, degradedForMs: OFFLINE_AFTER_MS })).toBe("offline")
  })

  it("with no sseHealth (or null), never returns 'live' — only a real active-thread SSE connection can", () => {
    const cases = [
      { signedIn: false, statsDegraded: false, degradedForMs: null },
      { signedIn: true, statsDegraded: false, degradedForMs: null },
      { signedIn: true, statsDegraded: true, degradedForMs: 1 },
      { signedIn: true, statsDegraded: true, degradedForMs: 999_999 },
    ]
    for (const c of cases) {
      expect(deriveTransportHealth(c)).not.toBe("live")
      expect(deriveTransportHealth({ ...c, sseHealth: null })).not.toBe("live")
    }
  })
})

describe("kernel/transport — sseHealth overrides the general lane signal (P3.T11)", () => {
  it("sseHealth 'live' -> live, even if the general lane is degraded", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: true, degradedForMs: 999_999, sseHealth: "live" })).toBe("live")
  })

  it("sseHealth 'reconnecting' -> reconnecting, even if the general lane is healthy", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: false, degradedForMs: null, sseHealth: "reconnecting" })).toBe("reconnecting")
  })

  it("sseHealth 'unavailable' falls through to the general lane signal (the SSE ladder gave up — polling is now the real transport)", () => {
    expect(deriveTransportHealth({ signedIn: true, statsDegraded: false, degradedForMs: null, sseHealth: "unavailable" })).toBe("polling")
  })

  it("signed out still wins over sseHealth — never 'live' while signed out", () => {
    expect(deriveTransportHealth({ signedIn: false, statsDegraded: false, degradedForMs: null, sseHealth: "live" })).toBe("polling")
  })
})
