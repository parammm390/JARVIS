import { describe, expect, it } from "vitest"
import { deriveTransportHealth, OFFLINE_AFTER_MS } from "./transport"

describe("kernel/transport — P2 scope (polling only, no SSE)", () => {
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

  it("never returns 'live' — P2 has no SSE; that value is reachable only from P3", () => {
    const cases = [
      { signedIn: false, statsDegraded: false, degradedForMs: null },
      { signedIn: true, statsDegraded: false, degradedForMs: null },
      { signedIn: true, statsDegraded: true, degradedForMs: 1 },
      { signedIn: true, statsDegraded: true, degradedForMs: 999_999 },
    ]
    for (const c of cases) expect(deriveTransportHealth(c)).not.toBe("live")
  })
})
