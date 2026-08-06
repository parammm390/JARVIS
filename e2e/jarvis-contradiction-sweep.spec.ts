import { test, expect } from "@playwright/test"

// P7.T6: a DOM-level check, not a source grep. It walks the actual visible
// business facts rendered by every deterministic Thread fixture and fails if a
// number-bearing fact lacks a selector-named `data-source` marker. Static copy,
// addresses, and fixture chrome are deliberately out of scope: they are not
// business facts. The labelled fixture root establishes fixture mode, not fact
// provenance, so it is expressly insufficient for this check.
const FIXTURES = ["rest", "understood", "plan", "clarify", "approval", "execution", "receipt"] as const
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
      // The fixture label is the public boundary of the deterministic harness.
      // Count it (rather than applying a visibility assertion to its fixed,
      // animated placement) and then inspect the rendered Thread root itself.
      await expect(page.getByText(`FIXTURE · ${fixture}`, { exact: true })).toHaveCount(1)
      const threadRoot = page.locator("[data-jarvis-thread]")
      await expect(threadRoot).toBeVisible()

      const missing = await threadRoot.evaluate((root) => {
        const facts = [...root.querySelectorAll<HTMLElement>("[data-jarvis-fact]")].filter((element) =>
          element.offsetParent !== null && /\d/.test(element.innerText),
        )
        return facts
          .map((element) => ({ element, source: element.closest<HTMLElement>("[data-source]")?.dataset.source }))
          .filter(({ source }) => !source || source === "fixture" || !/^[a-z][\w.[\]]*(?:\s*·\s*.+)?$/.test(source))
          .map(({ element, source }) => ({ tag: element.tagName, text: element.innerText.trim(), source: source ?? null }))
      })

      expect(missing).toEqual([])
    })
  }
}
