import { mkdirSync } from "node:fs"
import { test, expect } from "@playwright/test"

// P3.T4 labelled fixture support only. This exercises the real Thread/BlockShell
// component tree with a source-labelled plan fixture; it does not claim a live
// authenticated state edge, tenant data, or backend transition timing.

const OUT_DIR = "qa-screenshots/v3-P3"
const widths = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P3.T4 — Thread spatial continuity, labelled fixture", () => {
  test.setTimeout(60_000)

  for (const viewport of widths) {
    test(`fixture=plan keeps reached bodies mounted and the active block open at ${viewport.label}px`, async ({ page, context }) => {
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

      await page.goto("/jarvis/next?fixture=plan", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · plan")).toBeVisible()

      const blocks = page.locator("[data-thread-block]")
      await expect(blocks).toHaveCount(3)
      await expect(page.locator("[data-thread-block-body]")).toHaveCount(3)
      await expect(page.locator("[data-thread-block-active='true']")).toHaveCount(1)

      const activeBlock = page.locator("[data-thread-block='plan']")
      await expect(activeBlock).toHaveAttribute("data-thread-block-active", "true")
      await expect(activeBlock).toHaveAttribute("data-thread-block-collapsed", "false")
      await expect(activeBlock.locator("[data-thread-block-body]")).toHaveAttribute("data-thread-block-body-collapsed", "false")
      await expect(activeBlock.locator("button")).toHaveCount(1)

      const collapsedBodies = page.locator("[data-thread-block-body-collapsed='true']")
      await expect(collapsedBodies).toHaveCount(2)

      const activeHeader = activeBlock.locator("button")
      await activeHeader.focus()
      await expect(activeHeader).toBeFocused()
      await activeHeader.press("Enter")
      await expect(activeBlock).toHaveAttribute("data-thread-block-collapsed", "false")
      await expect(activeBlock.locator("[data-thread-block-body]")).toHaveAttribute("data-thread-block-body-collapsed", "false")
      await expect(activeHeader).toBeFocused()

      await page.screenshot({ path: `${OUT_DIR}/continuity-${viewport.label}.png`, fullPage: false })
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    })
  }

  test("reduced motion keeps the same mounted/expanded state", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit reduced-motion fixture")
    mkdirSync(OUT_DIR, { recursive: true })
    await context.clearCookies()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/jarvis/next?fixture=plan", { waitUntil: "domcontentloaded" })

    await expect(page.locator("[data-thread-block]")).toHaveCount(3)
    await expect(page.locator("[data-thread-block-body]")).toHaveCount(3)
    await expect(page.locator("[data-thread-block='plan'] [data-thread-block-body]")).toHaveAttribute("data-thread-block-body-collapsed", "false")
    await page.screenshot({ path: `${OUT_DIR}/continuity-390-reduced.png`, fullPage: false })
  })
})
