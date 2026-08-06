import { mkdirSync } from "node:fs"
import { test, expect } from "@playwright/test"

// P3.T5 labelled fixture evidence only. This inspects the real
// ThreadBridge -> Thread -> BlockShell tree with source-labelled fixture data;
// it does not claim an authenticated tenant or a live backend transition.

const OUT_DIR = "qa-screenshots/v3-P3"
const WIDTHS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P3.T5 — one causal spine, labelled fixture", () => {
  test.setTimeout(60_000)

  for (const { label, width, height } of WIDTHS) {
    test(`fixture=plan uses spine nodes and semantic active treatment at ${label}px`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()
      await page.setViewportSize({ width, height })

      const errors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      page.on("pageerror", (error) => errors.push(error.message))

      await page.goto("/jarvis/next?fixture=plan", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · plan")).toBeVisible()

      const spine = page.locator("[data-jarvis-action-spine-document]")
      await expect(spine).toHaveCount(1)
      await expect(spine.locator("[data-thread-spine-node]")).toHaveCount(3)
      await expect(spine.locator("[data-thread-spine-state='active']")).toHaveCount(1)
      await expect(spine.locator("[data-thread-spine-node='plan']")).toHaveAttribute("data-thread-spine-state", "active")

      const outerClasses = await spine.locator("[data-thread-spine-node]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("class") ?? ""))
      expect(outerClasses.every((className) => !/(^|\s)(j-panel|j-panel-hot|border)(\s|$)/.test(className))).toBe(true)

      // Inner plan nodes remain real source-labelled action surfaces; T5 only
      // removes the repeated Thread-level card shell around them.
      await expect(spine.locator("[data-jarvis-plan-node]")).toHaveCount(6)
      const planNodeClasses = await spine.locator("[data-jarvis-plan-node]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("class") ?? ""))
      expect(planNodeClasses.every((className) => className.includes("j-panel"))).toBe(true)

      const activeMarker = await spine.locator("[data-thread-spine-state='active']").evaluate((node) => {
        const style = getComputedStyle(node, "::before")
        return { content: style.content, boxShadow: style.boxShadow }
      })
      expect(activeMarker.content).toBe('""')
      expect(activeMarker.boxShadow).not.toBe("none")

      const activeHeader = spine.locator("[data-thread-spine-node='plan'] button")
      await activeHeader.focus()
      await expect(activeHeader).toBeFocused()
      await activeHeader.press("Enter")
      await expect(spine.locator("[data-thread-spine-node='plan']")).toHaveAttribute("data-thread-block-collapsed", "false")
      await expect(activeHeader).toBeFocused()

      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth)
      await page.screenshot({ path: `${OUT_DIR}/spine-${label}.png`, fullPage: false })
      expect(errors, `browser errors at ${label}px: ${errors.join(" | ")}`).toEqual([])
    })
  }

  test("reduced motion preserves the same spine and active state", async ({ page, context }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "explicit reduced-motion fixture")
    mkdirSync(OUT_DIR, { recursive: true })
    await context.clearCookies()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/jarvis/next?fixture=plan", { waitUntil: "domcontentloaded" })

    await expect(page.locator("[data-jarvis-action-spine-document]")).toHaveCount(1)
    await expect(page.locator("[data-thread-spine-node]")).toHaveCount(3)
    await expect(page.locator("[data-thread-spine-state='active']")).toHaveCount(1)
    await expect(page.locator("[data-thread-block='plan'] [data-thread-block-body]")).toHaveAttribute("data-thread-block-body-collapsed", "false")
    await page.screenshot({ path: `${OUT_DIR}/spine-390-reduced.png`, fullPage: false })
  })
})

