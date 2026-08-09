import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

// P3.T4 — the browser has no authenticated tenant role, so this audit proves the
// public boundary and the canonical Schedule shell without fabricating owner,
// dispatcher, or technician data. The exact role matrix is covered by the pure
// source contract in role-landing.test.ts.

const OUT_DIR = "evidence/jarvis-p3-t4-v6"
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const

test.describe("P3.T4 — role landing and auth-boundary audit", () => {
  test.setTimeout(120_000)

  test("keeps public Home/Schedule truthful and private role loaders dormant", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit 1440/768/390 viewport audit")
    await context.clearCookies()
    mkdirSync(OUT_DIR, { recursive: true })
    const errors: string[] = []
    const privateRequests: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("/api/jarvis/")) privateRequests.push(request.url())
    })
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
    page.on("pageerror", (error) => errors.push(error.message))
    const snapshots: Array<Record<string, unknown>> = []

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-jarvis-thread]")).toBeVisible()
      const homeSnapshot = await page.evaluate((currentViewport) => ({
        route: "home",
        viewport: currentViewport,
        scrollWidth: document.documentElement.scrollWidth,
        roleLandingMarkers: document.querySelectorAll("[data-jarvis-role-landing]").length,
        privateRoleContent: document.body.textContent?.includes("Waking JARVIS") ?? false,
      }), viewport.width)
      expect(homeSnapshot.scrollWidth).toBe(viewport.width)
      expect(homeSnapshot.roleLandingMarkers).toBe(0)
      expect(homeSnapshot.privateRoleContent).toBe(false)
      snapshots.push(homeSnapshot)
      await page.screenshot({ path: `${OUT_DIR}/home-${viewport.width}x${viewport.height}.png`, fullPage: true })

      await page.goto("/jarvis/schedule", { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-jarvis-dispatch-field]")).toBeVisible()
      await expect(page.locator(".jarvis-dispatch-empty")).toContainText("Sign in to inspect")
      const scheduleSnapshot = await page.evaluate((currentViewport) => ({
        route: "schedule",
        viewport: currentViewport,
        scrollWidth: document.documentElement.scrollWidth,
        navigationLinks: document.querySelectorAll("[data-jarvis-surface-nav] a").length,
        privateDataMarkers: ["dispatch/map", "technician/my-day", "read-models/work-cases"].filter((needle) => performance.getEntriesByType("resource").some((entry) => entry.name.includes(needle))),
      }), viewport.width)
      expect(scheduleSnapshot.scrollWidth).toBe(viewport.width)
      expect(scheduleSnapshot.navigationLinks).toBeGreaterThanOrEqual(6)
      expect(scheduleSnapshot.privateDataMarkers).toEqual([])
      snapshots.push(scheduleSnapshot)
      await page.screenshot({ path: `${OUT_DIR}/schedule-boundary-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }

    expect(privateRequests.filter((url) => !url.includes("/api/jarvis/me") && !url.includes("/api/jarvis/user-prefs"))).toEqual([])
    expect(errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)")).length).toBe(0)
    writeFileSync(`${OUT_DIR}/after-metrics.json`, JSON.stringify({ snapshots, privateRequests, unexpectedErrors: errors }, null, 2))
  })
})
