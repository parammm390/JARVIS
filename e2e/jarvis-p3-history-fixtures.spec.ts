import { mkdirSync } from "node:fs"
import { test, expect } from "@playwright/test"

// P3.T6 labelled fixture evidence only. This exercises the real
// ThreadBridge -> ThreadStack history rendering with source-labelled fixture
// snapshots; it does not claim an authenticated tenant or live backend data.

const OUT_DIR = "qa-screenshots/v3-P3"
const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P3.T6 — thread history audit trail, labelled fixture", () => {
  test.setTimeout(60_000)

  for (const { label, width, height } of VIEWPORTS) {
    test(`keeps real history collapsed as transparent audit rows and preserves keyboard detail access at ${label}px`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()
      await page.setViewportSize({ width, height })

      const errors: string[] = []
      const unauthorizedUrls: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("response", (response) => {
        if (response.status() === 401) unauthorizedUrls.push(response.url())
      })

      await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · receipt")).toBeVisible()

      const history = page.locator("[data-thread-history]")
      await expect(history).toHaveCount(1)
      await expect(history).toHaveAttribute("data-thread-history-count", "3")

      const collapsedRows = history.locator("[data-thread-history-row][data-thread-history-state='collapsed']")
      await expect(collapsedRows).toHaveCount(3)
      await expect(history.locator(".j-panel")).toHaveCount(0)

      const doneRow = history.locator("[data-thread-history-id='fixture-history-done'][data-thread-history-state='collapsed']")
      await expect(doneRow).toHaveCount(1)
      await expect(doneRow).toBeVisible()
      await expect(doneRow).toHaveAttribute("aria-expanded", "false")
      await expect(doneRow).toContainText("Chase the Petersons for their overdue invoice")
      await expect(doneRow).toContainText("Done")

      await doneRow.focus()
      await expect(doneRow).toBeFocused()
      await doneRow.press("Enter")

      const expandedRow = history.locator("[data-thread-history-id='fixture-history-done'][data-thread-history-state='expanded']")
      await expect(expandedRow).toHaveCount(1)
      await expect(expandedRow).toBeVisible()
      await expect(expandedRow.getByText("History detail · read-only")).toBeVisible()

      const collapse = expandedRow.getByRole("button", { name: "Collapse", exact: true })
      await expect(collapse).toHaveCount(1)
      await collapse.click()
      await expect(history.locator("[data-thread-history-id='fixture-history-done'][data-thread-history-state='collapsed']")).toHaveCount(1)
      await expect(history.locator("[data-thread-history-id='fixture-history-done'][data-thread-history-state='expanded']")).toHaveCount(0)

      await page.screenshot({ path: `${OUT_DIR}/history-audit-trail-receipt-${label}.png`, fullPage: true })
      const unexpectedErrors = errors.filter((message) => !message.includes("Failed to load resource: the server responded with a status of 401 (Unauthorized)"))
      expect(unexpectedErrors, `unexpected browser errors at ${label}px: ${unexpectedErrors.join(" | ")}`).toEqual([])
      expect(unauthorizedUrls.every((url) => /^https?:\/\/[^/]+\/api\/jarvis\/receipts\?domainActionId=fixture-node-\d+$/.test(url))).toBe(true)
    })
  }

  test("reduced motion keeps the same real collapsed history rows", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single reduced-motion fixture run")
    mkdirSync(OUT_DIR, { recursive: true })
    await context.clearCookies()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })

    const history = page.locator("[data-thread-history]")
    await expect(history).toHaveCount(1)
    await expect(history.locator("[data-thread-history-row][data-thread-history-state='collapsed']")).toHaveCount(3)
    await expect(history.locator(".j-panel")).toHaveCount(0)
    await page.screenshot({ path: `${OUT_DIR}/history-audit-trail-receipt-390-reduced.png`, fullPage: true })
  })
})
