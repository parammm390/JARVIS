import { test, expect } from "@playwright/test"

// Phase 7 MAESTRO PACK §7.10 — the full authenticated flow (login → briefing →
// approve an action → watch its timeline complete → open "Why?" → submit a
// correction) needs a real Supabase account's email+password. This repo's session
// has no safe way to obtain one (creating or resetting a real production account,
// or reading its password, isn't something to do unilaterally). Matching this
// codebase's own established pattern for exactly this class of gap (finnor-os's
// tests/integration/real-provider-conformance.test.ts skips cleanly without live
// credentials rather than faking them): set TEST_OWNER_EMAIL + TEST_OWNER_PASSWORD
// (a dedicated test/dev account, never the real owner's) to run these for real.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("authenticated cockpit flow", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set — see file header for why this isn't faked")

  test.beforeEach(async ({ page }) => {
    await page.goto("/jarvis/login")
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis")
  })

  test("daily briefing renders real numbers and a Why? link works", async ({ page }) => {
    await expect(page.getByText("Daily Briefing")).toBeVisible({ timeout: 15_000 })
    const whyButton = page.getByRole("button", { name: /^why\?/i }).first()
    await whyButton.click()
    await expect(page.getByText("Objective")).toBeVisible({ timeout: 10_000 })
  })

  test("approving a pending action removes it from the inbox", async ({ page }) => {
    const dock = page.locator("#approval-dock")
    await expect(dock).toBeVisible()
    const firstApprove = dock.getByRole("button", { name: /approve/i }).first()
    if (await firstApprove.count() === 0) {
      test.skip(true, "no pending actions in the queue right now to approve")
    }
    await firstApprove.click()
    await expect(firstApprove).toHaveCount(0, { timeout: 10_000 })
  })

  test("a live workflow run's drawer opens and shows its steps", async ({ page }) => {
    const runRow = page.getByText(/running/i).first()
    if (await runRow.count() === 0) {
      test.skip(true, "no live workflow runs in flight right now")
    }
    await runRow.click()
    await expect(page.getByRole("button", { name: /close/i })).toBeVisible()
  })
})

test.describe("dispatcher no-show recovery (Phase 7.4 gap)", () => {
  test.skip(
    true,
    "No dedicated dispatcher view exists yet — Phase 7.4 shipped role plumbing + owner-only gating on the surfaces added this pass, not the full separate dispatcher/technician page layouts the pack's fuller wording asks for. Logged honestly in phase-status.md rather than faked here.",
  )
})

test.describe("technician mobile visit-report (Phase 7.4 gap)", () => {
  test.use({ viewport: { width: 375, height: 812 } })
  test.skip(
    true,
    "No dedicated technician visit-report view exists yet — same honest gap as the dispatcher flow above.",
  )
})
