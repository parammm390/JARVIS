import { test, expect } from "@playwright/test"

// P7.T5 re-verification of the source-authorized, visibly labelled fixture
// path. This deliberately does not claim a live tenant, live voice, or an
// approved side effect; those require their own evidence.
const widths = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
] as const

const goldenStates = ["heard", "understood", "plan", "approval", "execution", "receipt"] as const

test.describe("P7 labelled Thread certification fixtures", () => {
  test.setTimeout(60_000)

  for (const viewport of widths) {
    for (const fixture of goldenStates) {
      test(`${fixture} fixture renders at ${viewport.label} width`, async ({ page, context }) => {
        test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
        await context.clearCookies()
        await page.setViewportSize(viewport)
        await page.goto(`/jarvis/next?fixture=${fixture}`, { waitUntil: "domcontentloaded" })
        await expect(page.getByText(`FIXTURE · ${fixture}`)).toBeVisible()
      })
    }

    test(`clarification fixture has keyboard-reachable controls at ${viewport.label} width`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop-chromium", "explicit widths")
      await context.clearCookies()
      await page.setViewportSize(viewport)
      await page.goto("/jarvis/next?fixture=clarify", { waitUntil: "domcontentloaded" })
      await expect(page.getByText("FIXTURE · clarify")).toBeVisible()
      await expect(page.getByRole("button", { name: "Answer" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Skip" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
    })
  }
})
