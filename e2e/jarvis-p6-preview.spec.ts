import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

const widths = [
  { label: "1440", width: 1440, height: 900 },
  { label: "768", width: 768, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P6 public preview", () => {
  for (const viewport of widths) {
    test(`labels public preview at ${viewport.label}px without private facts`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "width is explicit")
      mkdirSync("qa-screenshots/v3-P6", { recursive: true })
      await context.clearCookies()
      await page.setViewportSize(viewport)
      await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("PUBLIC PREVIEW", { exact: true })).toBeVisible()
      await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible()
      expect(await page.locator('[data-truth="known"][data-source^="api:"]').count()).toBe(0)
      await page.screenshot({ path: `qa-screenshots/v3-P6/preview-${viewport.label}.png`, fullPage: true, animations: "disabled" })
    })
  }
})
