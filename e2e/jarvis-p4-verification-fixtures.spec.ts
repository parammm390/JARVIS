import { test, expect, type Route } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { SANDBOX_LITERAL } from "../src/components/jarvis/lib/sandbox-detection"

// jarvis-v3 P4.T3/T6 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3),
// same posture as P2's own harness: the golden-consequence e2e (P4.T8) proved
// live that this session's real planner consistently (3/3 attempts) routes
// the golden phrase to `call_overdue_invoices`, not the authorized
// `start_invoice_to_cash_workflow` — so a real predicted<->actual diff and a
// real sandbox-labelled step were never reachable live this session (see
// BLOCKER B-5). This spec renders the REAL ThreadVerification/ReceiptDrawer
// component tree (not a separate mock) through the P2 fixture harness
// (`/jarvis/next?fixture=receipt`), with ONLY the two backend GET responses
// intercepted (same pattern e2e/jarvis-p3-restore-after-refresh.spec.ts
// already established) — the predicted/predictionDiff/sandbox data itself is
// shaped exactly like a real backend response (see P4.T1's predicted-outcome.ts
// and P4.T4's payment-webhook-receipt.test.ts), never invented structure.

const OUT_DIR = "qa-screenshots/v3-P4"

const FIXTURE_RECEIPT_ID = "fixture-receipt-sync-invoice"

const FIXTURE_RECEIPT = {
  id: FIXTURE_RECEIPT_ID,
  objective: "Collect on invoice for Henderson · Cedar Creek Rd",
  evidence: [{ source: "cash-collections", ref: "invoice:fixture-invoice-0", timestamp: new Date().toISOString() }],
  policyApplied: { id: "fixture-policy-invoice-to-cash", version: 3 },
  riskTier: "medium",
  proposedAction: { stepType: "send_message", payload: { contactId: "fixture-household-0", message: "Your invoice for $890 is ready. Pay securely here: https://pay.sandbox.finnor.local/fixture" } },
  approval: { required: true, approvedBy: "owner@test-dealer.finnor.local", at: new Date().toISOString() },
  expectedResult: { invoiceId: "fixture-invoice-0" },
  actualResult: { invoiceId: "fixture-invoice-0", sent: true, channel: "sms", paymentReceived: true, amountPaidUsd: 890, paidAt: new Date().toISOString() },
  failure: null,
  correlationId: "fixture-correlation",
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  finalizedAt: new Date().toISOString(),
  predicted: { invoiceId: "fixture-invoice-0", invoiceFound: true, amountUsd: 890, steps: ["create_payment_link", "send_message", "sync_invoice"] },
  predictionDiff: {
    compared: 2,
    matched: 2,
    accuracy: 1,
    fields: [
      { path: "invoiceId", predicted: "fixture-invoice-0", actual: "fixture-invoice-0", matched: true },
      { path: "amountPaidUsd", predicted: 890, actual: 890, matched: true },
    ],
  },
}

// Preserve the real SetupStatus envelope (especially actionTypes) and override
// only the labelled binding facts needed to exercise the sandbox literal. A
// partial synthetic response makes the actual Thread crash before the receipt
// can render, which would test fixture shape rather than P4.T6 behavior.
async function fulfillFixtureSetupStatus(route: Route): Promise<void> {
  // This is a labelled receipt fixture. Return the complete setup envelope
  // synchronously so the receipt's sandbox label does not depend on the live
  // tenant's 10-second sanity-lane schedule or its rate limiter.
  await route.fulfill({
    json: {
      actionTypes: [],
      environment: {
        nodeEnv: "test",
        secretProvider: { provider: "env", loaded: true, loadedAt: new Date().toISOString() },
        bindings: {
          scheduling: { mode: "native", source: "default" },
          communications: { mode: "native", source: "default" },
          documents: { mode: "native", source: "default" },
          esign: { mode: "native", source: "default" },
          inventory: { mode: "native", source: "default" },
          accounting: { mode: "native", source: "default" },
          payments: { mode: "emulator", source: "default" },
          crm: { mode: "native", source: "default" },
          marketing: { mode: "native", source: "default" },
        },
      },
    },
  })
}

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

// Several tests in this file sign in for real against the same live tenant.
// Real finding while building this evidence: running them concurrently
// (fullyParallel's own default) races the SAME login form against itself
// across workers and intermittently fails ("Sign in" stays disabled) — a
// contention artifact of this harness, not a product bug. `serial` mode is
// the correct fix (not a global --workers=1), matching Playwright's own
// documented pattern for tests that share one real external resource.
test.describe.configure({ mode: "serial" })

test.describe("P4.T3/T6 — ThreadVerification + sandbox honesty, FIXTURE harness", () => {
  test.setTimeout(120_000)
  // jarvis-v3 finding while building this evidence: data-core.ts's own lanes
  // (P1.T9/C-15's own fix — "no session -> no request", verified at
  // runLane()) include the sanity lane that fetches setup/status, so an
  // UNAUTHENTICATED fixture-harness load never fires it at all, and a route
  // interception on it is never hit — not a bug in isSandboxStep, a real
  // consequence of the signed-out network-hygiene fix this exact suite
  // enforces (e2e/jarvis-network-hygiene.spec.ts). A real sign-in (needed
  // anyway for BLOCKER B-3/B-5's own established credentials) makes the lane
  // fire for real, while the fixture harness still supplies the receipt
  // content — real session, fixture data, both honest.
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("the receipt fixture renders the real two-column predicted<->actual diff and the sandbox literal, no raw JSON", async ({ page }) => {
    // Real sign-in races itself under full-suite concurrency (--workers=2,
    // fullyParallel) — same finding as every other real-session spec in this
    // suite (jarvis-next-real-journey.spec.ts's own "single real-journey run"
    // comment). One real login is enough to prove this; running it twice
    // (once per project) buys nothing and adds real load to a shared tenant.
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })
    await page.route("**/api/jarvis/receipts?domainActionId=*", (route) => route.fulfill({ json: { receipts: [{ id: FIXTURE_RECEIPT_ID }] } }))
    await page.route(`**/api/jarvis/receipts/${FIXTURE_RECEIPT_ID}`, (route) => route.fulfill({ json: { receipt: FIXTURE_RECEIPT } }))
    await page.route("**/api/jarvis/setup/status", fulfillFixtureSetupStatus)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })

    await expect(page.getByText("Predicted vs actual")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("100% matched")).toBeVisible()
    // Real, correct duplication: the diff table's own row AND the (now
    // JSON-free) "Actual result" FieldList section both surface the same real
    // field — not a bug, both are honest projections of the same actualResult.
    await expect(page.locator("span:visible", { hasText: "amountPaidUsd" }).first()).toBeVisible()
    // P4.T6: this receipt's own step (send_message) resolved to "native" (not
    // ghl) — the literal sandbox string must render, never disguised.
    await expect(page.getByText(SANDBOX_LITERAL)).toBeVisible({ timeout: 25_000 })
    await page.screenshot({ path: `${OUT_DIR}/verification-diff-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT_DIR}/verification-diff-390.png`, fullPage: true })

    // Hard rule 8: no raw JSON anywhere in the rendered receipt.
    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })

  test("no prediction recorded renders the exact literal, never hidden", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single explicit viewport")
    mkdirSync(OUT_DIR, { recursive: true })
    await page.route("**/api/jarvis/receipts?domainActionId=*", (route) => route.fulfill({ json: { receipts: [{ id: "fixture-receipt-no-prediction" }] } }))
    await page.route("**/api/jarvis/receipts/fixture-receipt-no-prediction", (route) =>
      route.fulfill({
        json: {
          receipt: {
            ...FIXTURE_RECEIPT,
            id: "fixture-receipt-no-prediction",
            predicted: null,
            predictionDiff: null,
            proposedAction: { stepType: "sync_invoice", payload: {} },
          },
        },
      }),
    )
    await page.route("**/api/jarvis/setup/status", fulfillFixtureSetupStatus)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("No prediction was recorded for this action.")).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `${OUT_DIR}/verification-no-prediction-1440.png`, fullPage: true })
  })

  test("P4.T7 — ⌘K opens the real Ops destination with the 4 real counts, never a route", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    // The real auth/role gate can still be in its honest "Waking JARVIS…"
    // state one second after navigation. Wait for the real command rail rather
    // than racing the shortcut against a listener that has not mounted yet.
    await expect(page.getByRole("textbox", { name: "Tell JARVIS what you need" })).toBeVisible({ timeout: 10_000 })

    const urlBefore = page.url()
    // The product handler intentionally accepts either modifier; use the
    // control chord so this evidence can run consistently across Chromium
    // hosts while exercising that real meta-or-control listener.
    await page.keyboard.press("Control+K")
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible({ timeout: 5_000 })
    await page.getByRole("button", { name: /^Ops$/ }).click()

    // Never a route — the same /jarvis/next URL, just an overlay on top of it.
    expect(page.url()).toBe(urlBefore)
    await expect(page.getByRole("dialog", { name: "Ops" })).toBeVisible({ timeout: 5_000 })
    const ops = page.getByRole("dialog", { name: "Ops" })
    await expect(ops.getByText("Overdue invoices", { exact: true })).toBeVisible()
    await expect(ops.getByText("Collected", { exact: true })).toBeVisible()
    await expect(ops.getByText("Pending approvals", { exact: true })).toBeVisible()
    await expect(ops.getByText("Runs in flight", { exact: true })).toBeVisible()
    await page.waitForTimeout(2000) // let the fast/slow lanes land a real value instead of a loading skeleton
    await page.screenshot({ path: `${OUT_DIR}/ops-panel-1440.png` })

    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Ops" })).toBeHidden({ timeout: 5_000 })
  })

  test("P4.T2 — the approval card expands a real predicted outcome", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })
    const fixtureAction = {
      id: "fixture-node-0",
      actionType: "start_invoice_to_cash_workflow",
      summary: "Create a payment link for invoice fixture-, text/email it to the customer, and sync to QuickBooks.",
      payload: { invoiceId: "fixture-invoice-0", channel: "sms" },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: { invoiceId: "fixture-invoice-0", invoiceFound: true, amountUsd: 890, steps: ["create_payment_link", "send_message", "sync_invoice"] },
    }
    await page.route("**/api/jarvis/actions/pending*", (route) => {
      const filter = new URL(route.request().url()).searchParams.get("filter")
      return route.fulfill({ json: { actions: filter === "blocked" ? [] : [fixtureAction] } })
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(10_000) // let the authenticated fast lane's pending poll (intercepted above) land under the full matrix load

    const predictedChip = page.getByRole("button", { name: "predicted outcome" })
    await expect(predictedChip).toBeVisible({ timeout: 45_000 })
    await predictedChip.click()
    await expect(page.getByText("amountUsd")).toBeVisible()
    // "890" appears twice, honestly: ActionRenderer's own real payload chip
    // ("$890") and the predicted-outcome FieldList this task adds ("890").
    await expect(page.getByText("890", { exact: true })).toBeVisible()
    await page.waitForTimeout(500) // let the AnimatePresence expand settle before the screenshot
    await page.screenshot({ path: `${OUT_DIR}/approval-card-predicted-1440.png`, fullPage: true })
  })
})
