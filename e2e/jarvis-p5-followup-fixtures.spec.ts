import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T5 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3).
// Renders the REAL Thread -> ThreadClarify component tree in the exact shape
// kernel/store.tsx's own emptyPlanOutcome() now produces for a genuinely
// empty plan on a follow-up-shaped instruction (unit-tested directly in
// kernel/apply-trace-events.test.ts; this is the visual proof of the same
// real code path, not a second implementation).

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("P5.T5 — unresolved follow-up reference, FIXTURE harness (real component tree)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("renders the literal message and falls through to a real, answerable clarification — never a fake match", async ({ page }) => {
    // Real finding from this phase's own full-suite run: a real sign-in
    // races against another project's own real sign-in under full
    // parallelism (the SAME cause P4's own dd3dd65 commit already
    // documented) — single real-session run only, matching every other
    // real-session spec's own established convention.
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=unresolved-reference", { waitUntil: "domcontentloaded" })

    await expect(page.getByText("Actually, make that Thursday instead")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("I need one thing")).toBeVisible()
    await expect(page.getByText("I'm not sure which one you mean.")).toBeVisible()
    // Real, answerable clarification — Answer/Skip/Cancel, never a fabricated
    // Approve/Reject as if a real action had been resolved.
    await expect(page.getByRole("button", { name: "Answer" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Skip" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0)

    await page.getByText(/Why I.m asking/).click()
    await expect(page.getByText(/nothing came back to resolve it against/)).toBeVisible()

    await page.screenshot({ path: `${OUT_DIR}/followup-fixture-unresolved-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT_DIR}/followup-fixture-unresolved-390.png`, fullPage: true })
  })
})
