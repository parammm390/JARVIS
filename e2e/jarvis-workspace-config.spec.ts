import { expect, test } from "@playwright/test"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const defaultConfig = {
  enabledSurfaces: ["home", "work", "customers", "schedule", "money", "agents"],
  terminology: { home: "Home", work: "Work", customers: "Customers", schedule: "Schedule", money: "Money", agents: "Agents" },
  voiceEnabled: true,
  navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
  brand: { accent: "cyan", radius: "soft", mark: "F" },
  visibility: { policy: true, authority: true },
}

test.describe("tenant-native JARVIS workspace controls", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("one owner configuration reshapes navigation, voice, brand, and inspector presentation", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single authenticated configuration journey")
    test.setTimeout(90_000)
    let config = structuredClone(defaultConfig)
    let writes = 0

    await page.route("**/api/jarvis/**", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === "/api/jarvis/workspace-config") {
        if (request.method() === "PUT") {
          writes += 1
          config = await request.postDataJSON()
        }
        await route.fulfill({ json: { config, editable: true } })
        return
      }
      if (url.pathname === "/api/jarvis/me") { await route.fulfill({ json: { userId: "workspace-owner", tenantId: "workspace-tenant", role: "owner" } }); return }
      if (url.pathname === "/api/jarvis/user-prefs") { await route.fulfill({ json: { prefs: { homepage: null, density: "comfortable", accent: null, quietHoursStart: null, quietHoursEnd: null } } }); return }
      if (url.pathname === "/api/jarvis/read-models/work-cases") { await route.fulfill({ json: { data: [] } }); return }
      if (url.pathname === "/api/jarvis/actions/pending") { await route.fulfill({ json: { actions: [] } }); return }
      if (url.pathname === "/api/jarvis/workflows/runs") { await route.fulfill({ json: { runs: [] } }); return }
      if (url.pathname === "/api/jarvis/stats") { await route.fulfill({ json: { pending: 0, blocked: 0, recentActions: [] } }); return }
      if (url.pathname === "/api/jarvis/events") { await route.fulfill({ json: { events: [] } }); return }
      if (url.pathname === "/api/jarvis/comms") { await route.fulfill({ json: { outbox: [], communications: [] } }); return }
      if (url.pathname === "/api/jarvis/employees") { await route.fulfill({ json: { employees: [] } }); return }
      if (url.pathname === "/api/jarvis/setup/status") { await route.fulfill({ json: { actionTypes: [] } }); return }
      if (url.pathname === "/api/jarvis/integrations/status") { await route.fulfill({ json: { voiceAssistants: [], bindings: {}, summary: { configuredCount: 0, healthyCount: 0, unhealthyCount: 0 } } }); return }
      if (url.pathname === "/api/jarvis/insights") { await route.fulfill({ json: { actionTypeStats: [], criticFindings: [], topConcerns: [] } }); return }
      if (url.pathname.startsWith("/api/jarvis/read-models/")) { await route.fulfill({ json: { data: {} } }); return }
      if (url.pathname.startsWith("/api/jarvis/resources/")) { await route.fulfill({ json: { rows: [] } }); return }
      await route.continue()
    })

    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 10 })
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 10 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })
    await expect(page.getByRole("button", { name: "Open workspace settings" })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Open workspace settings" }).click()

    const dialog = page.getByRole("dialog", { name: "Operational presentation" })
    await dialog.getByRole("checkbox", { name: "Customers" }).uncheck()
    await dialog.getByRole("checkbox", { name: "Agents" }).uncheck()
    await dialog.getByRole("textbox", { name: "work" }).fill("Cases")
    await dialog.getByRole("checkbox", { name: "Voice command input" }).uncheck()
    await dialog.getByRole("checkbox", { name: "Policy context" }).uncheck()
    await dialog.getByRole("checkbox", { name: "Authority context" }).uncheck()
    await dialog.getByRole("combobox", { name: "Accent" }).selectOption("violet")
    await dialog.getByRole("combobox", { name: "Corner tone" }).selectOption("precise")
    await dialog.getByRole("textbox", { name: "Mark" }).fill("W")
    await dialog.getByRole("button", { name: "Move Money up" }).click()
    await dialog.getByRole("button", { name: "Move Money up" }).click()
    await dialog.getByRole("button", { name: "Move Money up" }).click()
    await dialog.getByRole("button", { name: "Save workspace" }).click()
    await expect(dialog.getByText("Saved for this tenant")).toBeVisible()
    expect(writes).toBe(1)
    expect(config).toMatchObject({ enabledSurfaces: ["home", "work", "schedule", "money"], terminology: { work: "Cases" }, voiceEnabled: false, brand: { accent: "violet", radius: "precise", mark: "W" }, visibility: { policy: false, authority: false } })
    await dialog.getByRole("button", { name: "Close workspace settings" }).click()

    const nav = page.getByLabel("JARVIS navigation")
    await expect(nav.getByRole("link", { name: "Cases" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Customers" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: "Agents" })).toHaveCount(0)
    await expect(page.locator("html")).toHaveAttribute("data-jarvis-tenant-accent", "violet")
    await expect(page.locator("html")).toHaveAttribute("data-jarvis-workspace-radius", "precise")
    await expect(page.getByRole("button", { name: "Voice is disabled for this tenant workspace" })).toBeDisabled()
    await expect(page.getByText("Disabled for this tenant workspace.")).toBeVisible()
  })
})
