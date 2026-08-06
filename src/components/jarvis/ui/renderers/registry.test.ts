import { describe, expect, it } from "vitest"
import { BACKEND_ACTION_TYPES } from "./backend-action-types.generated"
import { CERTIFIED_ACTION_STATES } from "./action-state-contract"
import { ACTION_RENDERERS, getRendererEntry } from "./registry"

describe("certified action renderer registry", () => {
  it("resolves every generated backend action type", () => {
    const frontendActionTypes = Object.keys(ACTION_RENDERERS).sort()
    const backendActionTypes = [...BACKEND_ACTION_TYPES].sort()

    expect(frontendActionTypes).toEqual(backendActionTypes)
    expect(BACKEND_ACTION_TYPES.filter((actionType) => ACTION_RENDERERS[actionType]?.fixture === undefined)).toEqual([])
    for (const actionType of BACKEND_ACTION_TYPES) {
      const entry = getRendererEntry(actionType)
      expect(entry, actionType).toBeDefined()
      expect(entry?.fixture, actionType).toBeDefined()
      expect(entry?.states, actionType).toEqual(CERTIFIED_ACTION_STATES)
    }
  })

  it("does not use a fallback renderer for a certified action", () => {
    expect(Object.values(ACTION_RENDERERS).every((entry) => entry.tier !== "fallback")).toBe(true)
  })
})
