import { describe, expect, it } from "vitest"
import {
  parsePersistedOperatingInteractionState,
  persistedOperatingInteractionKey,
  removePersistedOperatingInteractionState,
  resolveOperatingDeepLink,
  serializeOperatingInteractionState,
  type InteractionState,
} from "./operating-interaction"

const STATE: InteractionState = {
  activeWorkId: "work-42",
  focusedEntity: { entityType: "invoice", entityId: "invoice-7" },
  selectedEntities: [{ entityType: "household", entityId: "household-3" }],
  excludedEntities: [],
  surface: { id: "money", route: "/jarvis/money", spatialState: "detail" },
  filters: [{ field: "status", operator: "eq", value: "overdue" }],
  timeContext: { start: "2026-08-01", timezone: "Asia/Kolkata" },
  cohort: null,
  labels: { "household:household-3": "Acme Household" },
}

describe("operating interaction continuity", () => {
  it("round-trips a bounded authenticated-session snapshot", () => {
    expect(parsePersistedOperatingInteractionState(serializeOperatingInteractionState(STATE))).toEqual(STATE)
  })

  it("rejects malformed or unbounded browser state instead of trusting it", () => {
    expect(parsePersistedOperatingInteractionState("not-json")).toBeNull()
    expect(parsePersistedOperatingInteractionState(JSON.stringify({ version: 1, state: { ...STATE, selectedEntities: Array.from({ length: 51 }, (_, index) => ({ entityType: "household", entityId: `h-${index}` })) } }))).toBeNull()
    expect(parsePersistedOperatingInteractionState(JSON.stringify({ version: 1, state: { ...STATE, focusedEntity: { entityType: "root", entityId: "danger" } } }))).toBeNull()
  })

  it("carries household and canonical Work while focusing the current surface entity", () => {
    expect(resolveOperatingDeepLink("/jarvis/money", "?invoiceId=invoice-7&householdId=household-3&workCaseId=work-42")).toEqual({
      focusedEntity: { entityType: "invoice", entityId: "invoice-7" },
      contextualEntities: [
        { entityType: "household", entityId: "household-3" },
        { entityType: "work", entityId: "work-42" },
      ],
      activeWorkId: "work-42",
    })
  })

  it("keeps customer context focused on surfaces without a more exact entity", () => {
    expect(resolveOperatingDeepLink("/jarvis/agents", "?householdId=household-3&workCaseId=work-42").focusedEntity).toEqual({ entityType: "household", entityId: "household-3" })
  })

  it("removes the previous principal's session snapshot on logout", () => {
    const removed: string[] = []
    removePersistedOperatingInteractionState({ removeItem: (key) => removed.push(key) }, "employee-old")
    expect(removed).toEqual([persistedOperatingInteractionKey("employee-old")])
  })
})
