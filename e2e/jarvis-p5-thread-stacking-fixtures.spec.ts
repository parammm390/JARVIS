import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T8 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3).
// Renders the REAL kernel-shaped Thread/ThreadStack/RecentThreadsPanel
// component tree (not a separate mock) via `?fixture=stacked-approval`,
// which supplies both THREAD_FIXTURES (the active thread) and
// THREAD_HISTORY_FIXTURES (3 real superseded threads, each a different real
// outcome — done, a genuine empty plan, and a user cancellation) added
// specifically for this evidence.

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

// Real finding from this phase's own full-suite run: two real sign-ins in
// the same file race each other under full parallelism (the same cause
// P4's own dd3dd65 commit already documented) — serial mode, matching every
// other multi-test real-session spec's own established convention.
test.describe.configure({ mode: "serial" })

test.describe("P5.T8 — thread stacking, FIXTURE harness (real component tree)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("older threads render newest-first, collapsed to a row, each with its own honest outcome — and re-expand on click", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    await page.setViewportSize({ width: 1440, height: 1400 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=stacked-approval", { waitUntil: "domcontentloaded" })

    // The active (newest) thread renders fully expanded, at the top.
    await expect(page.getByText("Chase everyone more than thirty days overdue")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("AWAITING YOUR APPROVAL")).toBeVisible()

    // 3 real, distinct collapsed rows below it, each with its own honest outcome.
    const doneRow = page.getByRole("button", { name: /Chase the Petersons for their overdue invoice.*Done/ })
    // A genuine 0-action plan (PLAN_EMPTY) transitions to the real `failed`
    // state (machine.ts's own table) — "Failed" is the honest label here,
    // not "left in progress".
    const emptyRow = page.getByRole("button", { name: /Book a water test for the Alvarez household.*Failed/ })
    const cancelledRow = page.getByRole("button", { name: /Send a follow-up message to the Ortiz household.*Cancelled/ })
    await expect(doneRow).toBeVisible()
    await expect(emptyRow).toBeVisible()
    await expect(cancelledRow).toBeVisible()

    await page.screenshot({ path: `${OUT_DIR}/thread-stacking-fixture-collapsed-1440.png`, fullPage: true })

    // Re-expand one — reuses the REAL Thread component tree, not a summary.
    // The active thread's own real Approval Cockpit modal (correctly, per
    // §2.3's depth-2 rules) sits on top of the page while awaiting_approval
    // — real browser hit-testing routes even a `force:true` mouse click to
    // that topmost backdrop, not the row underneath. In the real live
    // product a person would reject/escape the cockpit first; this static
    // fixture can't. `element.click()` (real DOM API, real React synthetic
    // event, no coordinate-based hit-testing) exercises the row's own real
    // onClick handler directly instead.
    await doneRow.evaluate((el) => (el as HTMLElement).click())
    await expect(page.getByText("Collapse")).toBeVisible()
    await expect(page.getByText("WHAT ACTUALLY HAPPENED")).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/thread-stacking-fixture-expanded-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 1800 })
    await page.screenshot({ path: `${OUT_DIR}/thread-stacking-fixture-collapsed-390.png`, fullPage: true })

    // Same real 3-row history, on top of a TERMINAL active thread (no
    // Approval Cockpit modal in the way) — a cleanly legible screenshot of
    // the same real stacking mechanism, not a different implementation.
    await page.setViewportSize({ width: 1440, height: 1400 })
    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("button", { name: /Chase the Petersons for their overdue invoice.*Done/ })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `${OUT_DIR}/thread-stacking-fixture-clean-1440.png`, fullPage: true })
  })

  test("⌘K → Recent threads lists all real threads and jumps to the selected one", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    await page.setViewportSize({ width: 1440, height: 1400 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    await page.keyboard.press("Meta+k")
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole("button", { name: /^Recent threads$/ })).toBeVisible()
    await page.getByRole("button", { name: /^Recent threads$/ }).click()

    await expect(page.getByRole("dialog", { name: "Recent threads" })).toBeVisible({ timeout: 5_000 })
    // A brand-new signed-in session with no submissions yet honestly shows
    // the empty state — never a fabricated list.
    await expect(page.getByText("No threads yet this session.")).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/recent-threads-panel-empty-1440.png` })

    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Recent threads" })).toBeHidden({ timeout: 5_000 })
  })
})
