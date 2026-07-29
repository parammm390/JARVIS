import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// Plan v3 P1.T12 — the "before" baseline for the whole v3 programme.
//
// This captures signed-out `/jarvis` at 1440 and 390 as it stands at the end of
// Phase 1: the surface that will be replaced by the Instruction Thread at
// `/jarvis/next` in P2 and cut over in P6.T7. Every later phase compares against
// these, and the P6 exit gate requires `/jarvis/classic` to still match.
//
// Two artefacts, deliberately:
//   1. Plain PNGs into `qa-screenshots/v3-P1/`, which is what the plan's evidence
//      table asks for and what a human actually looks at.
//   2. Playwright snapshot comparisons, which are what CI fails on.
//
// Signed out is the only state assertable without a credential — see `## BLOCKERS`
// in the state file for the missing TEST_OWNER_* credentials that P2 needs.

const OUT_DIR = "qa-screenshots/v3-P1"

const WIDTHS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const

test.describe("golden baseline — signed-out /jarvis (P1 'before')", () => {
  test.setTimeout(120_000)

  for (const { label, width, height } of WIDTHS) {
    test(`signed-out /jarvis at ${label}px`, async ({ page, context }) => {
      // This spec sets its own viewport per case, so running it under both Playwright
      // projects would capture the same two images twice under two different snapshot
      // names. Pin it to one project; the widths come from WIDTHS, not the project.
      test.skip(test.info().project.name !== "desktop-chromium", "viewport is set per-test; one project is enough")
      mkdirSync(OUT_DIR, { recursive: true })
      await context.clearCookies()
      await page.setViewportSize({ width, height })

      await page.goto("/jarvis", { waitUntil: "domcontentloaded" })
      await expect(page.locator("body")).toBeVisible()

      // Let the ambient layers settle so the capture is a steady state rather than
      // a mid-transition frame. Nothing is polling — P1.T9 stopped that — so this
      // is purely animation settle time.
      await page.waitForTimeout(4_000)

      await page.screenshot({
        path: `${OUT_DIR}/jarvis-signed-out-${label}.png`,
        fullPage: true,
        animations: "disabled",
      })

      // C-01, asserted rather than eyeballed: signed out, no metric may claim to be
      // a known value from a live API source.
      expect(await page.locator('[data-truth="known"][data-source^="api:"]').count()).toBe(0)

      await expect(page).toHaveScreenshot(`golden-baseline-signed-out-${label}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})
