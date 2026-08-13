import { test, expect } from "@playwright/test"

// Authenticated canonical-workspace smoke coverage needs a real Supabase
// account's email+password. This repo's session
// has no safe way to obtain one (creating or resetting a real production account,
// or reading its password, isn't something to do unilaterally). Matching this
// codebase's own established pattern for exactly this class of gap (finnor-os's
// tests/integration/real-provider-conformance.test.ts skips cleanly without live
// credentials rather than faking them): set TEST_OWNER_EMAIL + TEST_OWNER_PASSWORD
// (a dedicated test/dev account, never the real owner's) to run these for real.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("authenticated cockpit flow", () => {
  test.describe.configure({ mode: "serial" })
  test.setTimeout(120_000)
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set — see file header for why this isn't faked")

  test.beforeEach(async ({ page }) => {
    await page.goto("/jarvis/login")
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    const signIn = page.getByRole("button", { name: /sign in/i })
    await expect(signIn).toBeEnabled({ timeout: 30_000 })
    await signIn.click()
    await page.waitForURL("**/jarvis", { timeout: 60_000 })
  })

  test("the authenticated adaptive workspace exposes the real command surface", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "responsive public/private shell coverage is certified separately")
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "JARVIS workspace" })).toBeVisible()
    await expect(page.getByPlaceholder("Tell JARVIS what you need")).toBeVisible()
    await expect(page.getByText("PUBLIC PREVIEW", { exact: true })).toHaveCount(0)
  })

  test("the same employee session opens the live durable Work projection", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "responsive public/private shell coverage is certified separately")
    await page.getByRole("link", { name: "Work", exact: true }).click()
    await expect(page).toHaveURL(/\/jarvis\/work$/)
    await expect(page.locator("[data-jarvis-work]")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible()
    await expect(page.getByText(/cases observed/i)).toBeVisible({ timeout: 15_000 })
  })

  test("one authenticated session crosses Customer and Money projections without a stale island", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "responsive public/private shell coverage is certified separately")
    await page.getByRole("link", { name: "Customers", exact: true }).click()
    await expect(page.locator("[data-jarvis-household-360]")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "One household, one operational record." })).toBeVisible()
    await page.getByLabel("Operational surfaces", { exact: true }).getByRole("link", { name: "Money", exact: true }).click()
    await expect(page.locator("[data-jarvis-cash-pressure]")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Where cash is stuck." })).toBeVisible()
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
