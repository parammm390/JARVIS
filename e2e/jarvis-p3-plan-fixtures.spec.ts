import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// P3.T2 visual support — the real Thread/ThreadPlan component tree through the
// dev-only labelled fixture harness. This fixture intentionally contains real
// action-shaped nodes without a dependency fact, so the test proves that the
// renderer does not invent an edge or placeholder. Dependency-edge behavior is
// covered by the source/pure-contract checks when a real dependsOn fact exists.

const OUT_DIR = "qa-screenshots/v3-P3"
const WIDTHS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("P3.T2 — PLAN nodes (labelled FIXTURE harness)", () => {
  test.setTimeout(60_000)

  for (const { label, width, height } of WIDTHS) {
    test(`fixture=plan at ${label}px`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "viewport is set per-test; one project is enough")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()
      await page.setViewportSize({ width, height })

      const errors: string[] = []
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text())
      })
      page.on("pageerror", (err) => errors.push(String(err)))

      await page.goto("/jarvis/next?fixture=plan", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · plan")).toBeVisible()
      await expect(page.locator("[data-jarvis-plan-graph]")).toHaveCount(1)
      await expect(page.locator("[data-jarvis-plan-node]")).toHaveCount(6)
      await expect(page.locator("[data-jarvis-plan-node-entering='true']")).toHaveCount(0)
      await expect(page.locator("[data-jarvis-plan-edge]")).toHaveCount(0)

      await page.screenshot({ path: `${OUT_DIR}/plan-${label}.png`, fullPage: true, animations: "disabled" })
      expect(errors, `console errors on plan fixture at ${label}px: ${errors.join(" | ")}`).toEqual([])
    })
  }
})
