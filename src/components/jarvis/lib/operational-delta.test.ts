import { describe, expect, it } from "vitest"
import { parseOperationalCursor, reduceOperationalDelta, type OperationalDelta } from "./operational-delta"

const SCOPE = "11111111-1111-4111-8111-111111111111"
const delta = (seq: number, tags = ["schedule"]): OperationalDelta => ({
  cursor: `${SCOPE}:${seq}`,
  changeType: "appointments.update",
  priority: "normal",
  entityRefs: [{ entityType: "appointment", entityId: "22222222-2222-4222-8222-222222222222" }],
  workId: null,
  projectionTags: tags,
  occurredAt: "2026-08-22T00:00:00.000Z",
})

describe("operational delta ordering", () => {
  it("accepts exactly the next sequence and filters unknown projection tags", () => {
    const state = parseOperationalCursor(`${SCOPE}:4`)!
    expect(reduceOperationalDelta(state, delta(5, ["schedule", "not-a-tag"]))).toMatchObject({ kind: "apply", tags: ["schedule"] })
  })

  it("accepts the bounded tenant-experience preference tag", () => {
    const state = parseOperationalCursor(`${SCOPE}:4`)!
    expect(reduceOperationalDelta(state, delta(5, ["preferences"]))).toMatchObject({ kind: "apply", tags: ["preferences"] })
  })

  it("dedupes repeated and out-of-order older frames", () => {
    const state = parseOperationalCursor(`${SCOPE}:5`)!
    expect(reduceOperationalDelta(state, delta(5)).kind).toBe("ignore")
    expect(reduceOperationalDelta(state, delta(4)).kind).toBe("ignore")
  })

  it("requires resync for a gap, malformed cursor, or a different tenant scope", () => {
    const state = parseOperationalCursor(`${SCOPE}:5`)!
    expect(reduceOperationalDelta(state, delta(7)).kind).toBe("resync")
    expect(reduceOperationalDelta(state, { ...delta(6), cursor: "bad" }).kind).toBe("resync")
    expect(reduceOperationalDelta(state, { ...delta(6), cursor: "33333333-3333-4333-8333-333333333333:6" }).kind).toBe("resync")
  })
})
