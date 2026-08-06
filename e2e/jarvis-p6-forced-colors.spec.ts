import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// P6.T2 — a visibly labelled local fixture is the safe runtime boundary for
// the approval state when no authenticated owner credentials are available.
// This verifies the real Thread/approval tree under forced colours + reduced
// motion; it does not claim live tenant or external-action evidence.
test.describe("P6.T2 — forced colours and reduced motion", () => {
  test("keeps approval, focus, and causal surfaces legible without glow", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit 1440px fixture viewport")
    test.setTimeout(60_000)
    mkdirSync("qa-screenshots/v3-P6", { recursive: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" })
    const action = {
      id: "fixture-action-bulk-known",
      actionType: "bulk_notify_existing_customers",
      summary: "Reach 12 customers with marketing consent via sms — approve to send all?",
      payload: { channel: "sms", targets: Array.from({ length: 12 }, (_, index) => ({ householdId: `hh-${index}`, label: `Household ${index}`, phone: `+13195550${100 + index}` })) },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [action] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    await page.route("**/api/jarvis/user-prefs", (route) => route.fulfill({ json: { prefs: { quietHoursStart: null, quietHoursEnd: null } } }))
    for (const fixtureKey of ["rest", "heard", "plan", "clarify", "flagship-c-approval-known", "execution", "verifying", "receipt"]) {
      await page.goto(`/jarvis/next?fixture=${fixtureKey}`, { waitUntil: "domcontentloaded" })
      await expect(page.getByText(`FIXTURE · ${fixtureKey}`)).toBeVisible({ timeout: 10_000 })
      await expect(page.locator("[data-jarvis-thread]").first()).toBeVisible()
      const mode = await page.locator("[data-jarvis-thread]").first().getAttribute("data-liveframe-mode")
      expect(["ready", "listening", "thinking", "decision", "working", "verifying", "resolved", "fault"]).toContain(mode)
      expect(await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }

    await page.goto("/jarvis/next?fixture=flagship-c-approval-known", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("FIXTURE · flagship-c-approval-known")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: /needs your approval/i })).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(1)

    const panelStyles = await page.locator(".j-panel").first().evaluate((element) => {
      const styles = getComputedStyle(element)
      return { backgroundColor: styles.backgroundColor, borderColor: styles.borderTopColor, boxShadow: styles.boxShadow }
    })
    expect(panelStyles.boxShadow).toBe("none")

    const select = page.getByRole("button", { name: "Select" })
    await expect(select).toBeVisible()
    await select.focus()
    const focusStyles = await select.evaluate((element) => {
      const styles = getComputedStyle(element)
      return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth }
    })
    expect(focusStyles.outlineStyle).toBe("solid")
    expect(Number.parseFloat(focusStyles.outlineWidth)).toBeGreaterThanOrEqual(3)

    await page.screenshot({ path: "qa-screenshots/v3-P6/forced-colors-approval-1440.png", fullPage: true, animations: "disabled" })
  })
})
