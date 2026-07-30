import { test, expect } from "@playwright/test"

// P7.T6: a DOM-level check, not a source grep. It walks the actual visible leaf
// text rendered by every deterministic Thread fixture and fails if any visible
// numeral lacks a nearest `data-source` provenance marker.
const FIXTURES = ["understood", "plan", "clarify", "approval", "execution", "receipt"] as const
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const

for (const fixture of FIXTURES) {
  for (const viewport of WIDTHS) {
    test(`P7 contradiction sweep: fixture=${fixture} at ${viewport.width}`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit desktop/mobile widths run once")
      await context.clearCookies()
      await page.setViewportSize(viewport)
      await page.goto(`/jarvis/next?fixture=${fixture}`, { waitUntil: "domcontentloaded" })
      await expect(page.getByText(`FIXTURE · ${fixture}`)).toBeVisible()

      const missing = await page.locator("[data-jarvis-thread]").evaluate((root) => {
        const ignored = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"])
        const leaves = [...root.querySelectorAll<HTMLElement>("*")].filter((element) =>
          !ignored.has(element.tagName) &&
          element.children.length === 0 &&
          element.offsetParent !== null &&
          /\d/.test(element.innerText),
        )
        return leaves
          .filter((element) => !element.closest("[data-source]"))
          .map((element) => ({ tag: element.tagName, text: element.innerText.trim() }))
      })

      expect(missing).toEqual([])
    })
  }
}
