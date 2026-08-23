import { describe, expect, it } from "vitest"
import { isRegisteredMetricForRole } from "./metric-registry"
import { isRegisteredQuickActionForRole } from "./quick-action-registry"
import { registeredExtension } from "./extension-registry"

describe("tenant experience registries", () => {
  it("allowlists source-backed metrics by backend role", () => {
    expect(isRegisteredMetricForRole("technician_load", "dispatcher")).toBe(true)
    expect(isRegisteredMetricForRole("collected_usd", "dispatcher")).toBe(false)
    expect(isRegisteredMetricForRole("invented_revenue", "owner")).toBe(false)
  })

  it("allowlists only governed quick-action keys for each role", () => {
    expect(isRegisteredQuickActionForRole("open_my_day", "technician")).toBe(true)
    expect(isRegisteredQuickActionForRole("review_pipeline", "technician")).toBe(false)
    expect(isRegisteredQuickActionForRole("arbitrary_fetch", "owner")).toBe(false)
  })

  it("fails closed for unknown extensions and incompatible slots", () => {
    expect(registeredExtension("reference.northstar-service-priority", "ready.primary")).toBe(true)
    expect(registeredExtension("reference.northstar-service-priority", "working.visual")).toBe(false)
    expect(registeredExtension("client.runtime-module", "ready.primary")).toBe(false)
  })
})
