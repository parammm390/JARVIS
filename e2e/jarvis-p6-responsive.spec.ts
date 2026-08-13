import { test, expect } from "@playwright/test"

const viewports = [
  { label: "1440", width: 1440, height: 900 },
  { label: "768", width: 768, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

// P6.T1 — safe local fixture sweep. It measures the real shared Thread tree;
// no authenticated facts, approval, workflow control, or external action is
// used. Production-shaped owner/device coverage remains a separate gate.
test.describe("P6.T1 — responsive collision and keyboard sweep", () => {
  for (const viewport of viewports) {
    test(`keeps the approval surface usable at ${viewport.label}px`, async ({ page }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "viewport is explicit")
      await page.setViewportSize(viewport)
      await page.goto("/jarvis/next?fixture=flagship-c-approval-known", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · flagship-c-approval-known")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole("heading", { name: /needs your approval/i })).toBeVisible()

      const metrics = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-jarvis-thread]")
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
        const canvas = document.querySelector<HTMLElement>(".jarvis-canvas")
        const deck = document.querySelector<HTMLElement>(".jarvis-command-deck")
        const planControl = document.querySelector<HTMLElement>("[data-thread-block='plan'] button")
        const rect = planControl?.getBoundingClientRect()
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          rootPresent: root !== null,
          canvasPresent: canvas !== null,
          // Fixture mode intentionally omits the owner-only command deck; the
          // shared canvas owns the same bottom safe-area clearance there.
          deckPaddingBottom: deck
            ? Number.parseFloat(getComputedStyle(deck).paddingBottom)
            : canvas
              ? Number.parseFloat(getComputedStyle(canvas).paddingBottom)
              : 0,
          dialogPaddingBottom: dialog ? Number.parseFloat(getComputedStyle(dialog).paddingBottom) : 0,
          selectRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        }
      })

      expect(metrics.scrollWidth, `${viewport.label}px horizontal overflow`).toBeLessThanOrEqual(metrics.clientWidth)
      expect(metrics.rootPresent).toBe(true)
      expect(metrics.canvasPresent).toBe(true)
      // The command deck owns the fixed-dock/safe-area clearance; the root
      // and canvas are structural containers and deliberately carry none.
      expect(metrics.deckPaddingBottom).toBeGreaterThan(0)
      expect(metrics.dialogPaddingBottom).toBeGreaterThan(0)
      expect(metrics.selectRect).not.toBeNull()
      expect(metrics.selectRect!.width).toBeGreaterThanOrEqual(40)
      expect(metrics.selectRect!.height).toBeGreaterThanOrEqual(40)
      expect(metrics.selectRect!.x).toBeGreaterThanOrEqual(0)
      expect(metrics.selectRect!.x + metrics.selectRect!.width).toBeLessThanOrEqual(metrics.clientWidth)

      const planControl = page.locator("[data-thread-block='plan'] button")
      await planControl.focus()
      expect(await planControl.evaluate((element) => document.activeElement === element)).toBe(true)
      await page.keyboard.press("Enter")
      // The active causal block is intentionally not collapsible: Enter is
      // keyboard-safe and keeps the live approval plan visible rather than
      // hiding the object that currently owns the decision.
      await expect(page.locator("[data-thread-block='plan']")).toHaveAttribute("data-thread-block-collapsed", "false")
    })
  }
})
