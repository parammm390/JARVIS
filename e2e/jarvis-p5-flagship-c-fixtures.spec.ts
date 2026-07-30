import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T3 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3), same
// posture as every prior phase's harness. Renders the REAL ThreadApprovalCockpit
// -> ApprovalCockpit -> ActionRenderer -> BulkNotifyScene component tree, with
// only `actions/pending` (and `user-prefs` for the quiet-hours case)
// intercepted. Payload shapes match bulk-notify/index.ts's real draft() output
// verbatim (targets: ConsentedTarget[] with real field names).

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const REAL_TARGETS = Array.from({ length: 12 }, (_, i) => ({
  householdId: `hh-${i}`,
  label: `Household ${i}`,
  phone: `+13195550${100 + i}`,
  equipmentSummary: "water softener",
}))

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
  await page.getByPlaceholder(/you@example.com/i).fill(email!)
  await page.getByPlaceholder(/•+/i).click()
  await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/jarvis", { timeout: 20_000 })
}

test.describe.configure({ mode: "serial" })

test.describe("P5.T3 — Flagship C, FIXTURE harness (real component tree)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("a known recipient count renders the real BlastRadius header with the real count, low risk", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })
    const action = {
      id: "fixture-action-bulk-known",
      actionType: "bulk_notify_existing_customers",
      summary: `Reach ${REAL_TARGETS.length} customers with marketing consent via sms — approve to send all?`,
      payload: { channel: "sms", discountPercent: 15, targets: REAL_TARGETS },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [action] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    await page.route("**/api/jarvis/user-prefs", (route) => route.fulfill({ json: { prefs: { quietHoursStart: null, quietHoursEnd: null } } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto("/jarvis/next?fixture=flagship-c-approval-known", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    await expect(page.getByText(`${REAL_TARGETS.length} customers will be texted`)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("LOW RISK")).toBeVisible()
    await page.waitForTimeout(700) // let the count-up settle before the screenshot
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-fixture-known-count-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-fixture-known-count-390.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })

  test("an unknown recipient count reads the literal header and forces high risk + typed confirm", async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const action = {
      id: "fixture-action-bulk-unknown",
      actionType: "bulk_notify_existing_customers",
      summary: "Reach customers with marketing consent via sms — approve to send all?",
      payload: { channel: "sms", discountPercent: 15 }, // no targets — genuinely unknown count
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [action] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    await page.route("**/api/jarvis/user-prefs", (route) => route.fulfill({ json: { prefs: { quietHoursStart: null, quietHoursEnd: null } } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto("/jarvis/next?fixture=flagship-c-approval-unknown", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    await expect(page.getByText("An unknown number of customers will be texted.")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("HIGH RISK")).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-fixture-unknown-count-1440.png`, fullPage: true })

    // Real, forced typed-confirm: select this card in batch mode and confirm
    // the "Approve N" bar demands the literal "APPROVE" text before it's submittable.
    await page.getByRole("button", { name: "Select" }).click()
    await page.getByRole("checkbox", { name: "Select for batch decision" }).check()
    const approveAllButton = page.getByRole("button", { name: /^Approve \d+$/ })
    await expect(approveAllButton).toBeVisible()
    await expect(approveAllButton).toBeDisabled()
    await page.getByPlaceholder(/type "APPROVE" to continue/i).fill("APPROVE")
    await expect(approveAllButton).toBeEnabled()
  })

  test("active quiet hours render the honest per-user banner, never implying customers are protected", async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const action = {
      id: "fixture-action-bulk-quiet",
      actionType: "bulk_notify_existing_customers",
      summary: `Reach ${REAL_TARGETS.length} customers with marketing consent via sms — approve to send all?`,
      payload: { channel: "sms", targets: REAL_TARGETS },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [action] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    // A wide, always-active window (00:00-23:59) so this test is never flaky
    // against the real current time.
    await page.route("**/api/jarvis/user-prefs", (route) => route.fulfill({ json: { prefs: { quietHoursStart: "00:00", quietHoursEnd: "23:59" } } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto("/jarvis/next?fixture=flagship-c-approval-known", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    await expect(page.getByText(/Your own quiet hours are active/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/does not delay sending to customers/)).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-fixture-quiet-hours-1440.png`, fullPage: true })
  })
})
