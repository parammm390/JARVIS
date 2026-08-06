import { mkdirSync } from "node:fs"
import { test, expect } from "@playwright/test"

// P3.T3 labelled fixture evidence only. The fixture renders the real
// ThreadBridge -> Thread -> ThreadClarify tree; it does not claim an
// authenticated tenant, a live clarification event, or a submitted answer.

const OUT_DIR = "qa-screenshots/v3-P3"
const widths = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P3.T3 — clarification question focus, labelled fixture", () => {
  test.setTimeout(60_000)

  for (const viewport of widths) {
    test(`question owns focus and keyboard return at ${viewport.label}px`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on("pageerror", (error) => pageErrors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text())
      })

      await page.goto("/jarvis/next?fixture=clarify", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · clarify")).toBeVisible()

      const root = page.locator("[data-jarvis-thread]")
      await expect(root).toHaveAttribute("data-liveframe-focus", "clarification")
      await expect(root).toHaveAttribute("data-jarvis-question-focus", "true")
      await expect(page.locator("[data-jarvis-clarification-question]")).toBeVisible()

      const input = page.locator("[data-jarvis-clarification-input]")
      await expect(input).toHaveCount(1)
      await expect(input).toBeFocused()

      const dimmed = page.locator("[data-jarvis-question-depth][data-jarvis-question-dimmed='true']")
      const dimmedCount = await dimmed.count()
      expect(dimmedCount).toBe(3)
      const firstDimmed = dimmed.nth(0)
      await expect.poll(async () => Number(await firstDimmed.evaluate((element) => getComputedStyle(element).opacity))).toBe(0.42)

      const why = page.getByRole("button", { name: "Why I’m asking" })
      await expect(why).toHaveCount(1)
      await input.press("Tab")
      await expect(why).toBeFocused()

      const answer = page.getByRole("button", { name: "Answer" })
      await expect(answer).toHaveCount(1)
      await why.press("Tab")
      await expect(answer).toBeFocused()

      await page.screenshot({ path: `${OUT_DIR}/clarification-${viewport.label}.png`, fullPage: false })
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    })
  }

  test("reduced motion settles the same dim/focus state without travel", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit reduced-motion fixture")
    mkdirSync(OUT_DIR, { recursive: true })
    await context.clearCookies()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/jarvis/next?fixture=clarify", { waitUntil: "domcontentloaded" })

    const input = page.locator("[data-jarvis-clarification-input]")
    await expect(input).toHaveCount(1)
    await expect(input).toBeFocused()
    const dimmed = page.locator("[data-jarvis-question-depth][data-jarvis-question-dimmed='true']")
    const dimmedCount = await dimmed.count()
    expect(dimmedCount).toBe(3)
    const firstDimmed = dimmed.nth(0)
    await expect.poll(async () => Number(await firstDimmed.evaluate((element) => getComputedStyle(element).opacity))).toBe(0.42)
    await page.screenshot({ path: `${OUT_DIR}/clarification-390-reduced.png`, fullPage: false })
  })
})

