import { describe, expect, it } from "vitest"
import { DEFAULT_ROLE_LANDING, roleLandingFor } from "./role-landing"

describe("P3.T4 role landing contract", () => {
  it("keeps the backend's three roles and v6 defaults exact", () => {
    expect(DEFAULT_ROLE_LANDING).toEqual({ owner: "home", dispatcher: "schedule", technician: "my-day" })
    expect(roleLandingFor("owner", null)).toBe("home")
    expect(roleLandingFor("dispatcher", null)).toBe("schedule")
    expect(roleLandingFor("technician", null)).toBe("my-day")
  })

  it("accepts only the existing explicit dispatcher map preference", () => {
    expect(roleLandingFor("dispatcher", "map")).toBe("dispatch-map")
    expect(roleLandingFor("dispatcher", "bridge")).toBe("schedule")
    expect(roleLandingFor("dispatcher", "my-day")).toBe("schedule")
  })

  it("does not let stale preferences cross role boundaries", () => {
    expect(roleLandingFor("owner", "map")).toBe("home")
    expect(roleLandingFor("technician", "map")).toBe("my-day")
    expect(roleLandingFor("technician", "bridge")).toBe("my-day")
  })
})
