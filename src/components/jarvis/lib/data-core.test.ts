// Plan v3 P1.T9 — defect C-15: the signed-out 401 storm (~90 req/min on production).
//
// The scheduler itself needs a browser, but the two decisions that actually stop the
// storm are pure and are asserted here: how a lane's failures are classified, and how
// long it waits before trying again.

import { describe, expect, it } from "vitest"
import { BACKOFF_LADDER_MS, classifyLaneOutcome, nextBackoffMs } from "./data-core"
import { JarvisApiError } from "./api"

const ok = (v: unknown): PromiseSettledResult<unknown> => ({ status: "fulfilled", value: v })
const fail = (reason: unknown): PromiseSettledResult<unknown> => ({ status: "rejected", reason })

describe("nextBackoffMs — the 4 -> 8 -> 16 -> 32 -> 60 s ladder", () => {
  it("is exactly the specified ladder", () => {
    expect(BACKOFF_LADDER_MS).toEqual([4_000, 8_000, 16_000, 32_000, 60_000])
  })

  it("no failures means no backoff — the lane uses its own interval", () => {
    expect(nextBackoffMs(0)).toBe(0)
    expect(nextBackoffMs(-1)).toBe(0)
  })

  it("climbs one rung per consecutive failure", () => {
    expect([1, 2, 3, 4, 5].map(nextBackoffMs)).toEqual([4_000, 8_000, 16_000, 32_000, 60_000])
  })

  it("saturates at 60s instead of growing without bound", () => {
    expect(nextBackoffMs(6)).toBe(60_000)
    expect(nextBackoffMs(50)).toBe(60_000)
    expect(nextBackoffMs(10_000)).toBe(60_000)
  })
})

describe("classifyLaneOutcome — stop vs slow down vs fine", () => {
  it("all fulfilled is neither denied nor failing", () => {
    expect(classifyLaneOutcome([ok(1), ok(2)])).toEqual({ denied: null, transientFailure: false })
  })

  it("an empty lane is treated as fine, not as a failure", () => {
    expect(classifyLaneOutcome([])).toEqual({ denied: null, transientFailure: false })
  })

  it("401 denies as signed-out — this is the C-15 stop condition", () => {
    expect(classifyLaneOutcome([fail(new JarvisApiError("GET stats failed (401)", 401))])).toEqual({
      denied: "signed-out",
      transientFailure: false,
    })
  })

  it("403 denies as role", () => {
    expect(classifyLaneOutcome([fail(new JarvisApiError("GET dlq failed (403)", 403))])).toEqual({
      denied: "role",
      transientFailure: false,
    })
  })

  it("a 401 anywhere in the batch denies the whole lane", () => {
    expect(
      classifyLaneOutcome([ok(1), ok(2), fail(new JarvisApiError("nope", 401)), ok(3)]),
    ).toMatchObject({ denied: "signed-out" })
  })

  it("a refusal outranks a transient failure in the same batch", () => {
    const out = classifyLaneOutcome([fail(new Error("network down")), fail(new JarvisApiError("nope", 401))])
    expect(out.denied).toBe("signed-out")
  })

  it("5xx is transient — retry on the ladder, do not stop", () => {
    expect(classifyLaneOutcome([fail(new JarvisApiError("boom", 500))])).toEqual({
      denied: null,
      transientFailure: true,
    })
    expect(classifyLaneOutcome([fail(new JarvisApiError("gateway", 502))])).toEqual({
      denied: null,
      transientFailure: true,
    })
  })

  it("a network error or an abort is transient, not a refusal", () => {
    expect(classifyLaneOutcome([fail(new TypeError("Failed to fetch"))])).toEqual({
      denied: null,
      transientFailure: true,
    })
    expect(classifyLaneOutcome([fail(new DOMException("Aborted", "AbortError"))])).toEqual({
      denied: null,
      transientFailure: true,
    })
  })

  it("404 is transient, not a permanent stop — a missing route is not a refusal", () => {
    expect(classifyLaneOutcome([fail(new JarvisApiError("missing", 404))])).toMatchObject({
      denied: null,
      transientFailure: true,
    })
  })
})

describe("the C-15 storm arithmetic", () => {
  it("a lane that keeps failing settles at one request per minute, not 15", () => {
    // The fast lane's own cadence is 4s -> 15 requests/min if nothing backs off.
    // After five consecutive failures the ladder has it asking once a minute.
    const perMinuteWithoutBackoff = 60_000 / 4_000
    const perMinuteAtLadderTop = 60_000 / nextBackoffMs(5)
    expect(perMinuteWithoutBackoff).toBe(15)
    expect(perMinuteAtLadderTop).toBe(1)
  })
})
