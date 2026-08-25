import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

// P3.T3 — the public Fleet route proves the honest no-session boundary. Tenant Work
// and calls are fetched only after auth; the source-linked projection is exercised by
// the unit/read-model contracts rather than by invented browser fixtures.

const OUT_DIR = "evidence/jarvis-p3-t3-v6"
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const

test.describe("P3.T3 — Agent causality and auth-boundary audit", () => {
  test.setTimeout(120_000)

  test("keeps tenant Work fetch auth-gated and renders source-bound empty lanes", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit 1440/768/390 viewport audit")
    await context.clearCookies()
    mkdirSync(OUT_DIR, { recursive: true })
    const requests: string[] = []
    const errors: string[] = []
    page.on("request", (request) => requests.push(request.url()))
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
    page.on("pageerror", (error) => errors.push(error.message))
    const snapshots: Array<Record<string, unknown>> = []

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto("/jarvis/agents", { waitUntil: "domcontentloaded" })
      await expect(page.locator("[data-jarvis-agent-fleet]")).toBeVisible()
      await expect(page.locator("[data-agent-fleet-rail] [data-agent-key]")).toHaveCount(9)
      await expect(page.locator(".jarvis-calling-agents")).toContainText("Assistant status not read")
      await expect(page.locator(".jarvis-calling-agents")).toContainText("Call records not read")
      await expect(page.locator(".jarvis-agent-fleet__provider-scope")).toContainText("not agent readiness")
      await expect(page.locator("[data-agent-fleet-inspector]")).toHaveCount(0)

      const snapshot = await page.evaluate((currentViewport) => ({
        viewport: currentViewport,
        workFetches: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("read-models/work-cases")).length,
        scrollWidth: document.documentElement.scrollWidth,
        workNotRead: document.querySelector(".jarvis-agent-fleet__lane")?.textContent?.includes("Sign in to inspect canonical Work links.") ?? false,
      }), viewport.width)
      snapshots.push(snapshot)
      expect(snapshot.workFetches).toBe(0)
      expect(snapshot.scrollWidth).toBe(viewport.width)
      expect(snapshot.workNotRead).toBe(true)
      await page.screenshot({ path: `${OUT_DIR}/fleet-causality-${viewport.width}x${viewport.height}.png`, fullPage: true })
    }

    expect(requests.filter((url) => url.includes("read-models/work-cases"))).toEqual([])
    expect(errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))).toEqual([])
    writeFileSync(`${OUT_DIR}/after-metrics.json`, JSON.stringify({ snapshots, unexpectedErrors: errors }, null, 2))
  })
})
