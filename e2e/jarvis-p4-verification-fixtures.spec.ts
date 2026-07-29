import { test, expect } from "@playwright/test"
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

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("P4.T3/T6 — ThreadVerification + sandbox honesty, FIXTURE harness", () => {
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
    mkdirSync(OUT_DIR, { recursive: true })
    await page.route("**/api/jarvis/receipts?domainActionId=*", (route) => route.fulfill({ json: { receipts: [{ id: FIXTURE_RECEIPT_ID }] } }))
    await page.route(`**/api/jarvis/receipts/${FIXTURE_RECEIPT_ID}`, (route) => route.fulfill({ json: { receipt: FIXTURE_RECEIPT } }))
    await page.route("**/api/jarvis/setup/status", (route) =>
      route.fulfill({ json: { environment: { nodeEnv: "test", bindings: { payments: { mode: "emulator", source: "default" }, crm: { mode: "native", source: "default" } } } } }),
    )

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })

    await expect(page.getByText("Predicted vs actual")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("100% matched")).toBeVisible()
    // Real, correct duplication: the diff table's own row AND the (now
    // JSON-free) "Actual result" FieldList section both surface the same real
    // field — not a bug, both are honest projections of the same actualResult.
    await expect(page.getByText("amountPaidUsd").first()).toBeVisible()
    // P4.T6: this receipt's own step (send_message) resolved to "native" (not
    // ghl) — the literal sandbox string must render, never disguised.
    await expect(page.getByText(SANDBOX_LITERAL)).toBeVisible()
    await page.screenshot({ path: `${OUT_DIR}/verification-diff-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT_DIR}/verification-diff-390.png`, fullPage: true })

    // Hard rule 8: no raw JSON anywhere in the rendered receipt.
    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })

  test("no prediction recorded renders the exact literal, never hidden", async ({ page }) => {
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
    await page.route("**/api/jarvis/setup/status", (route) => route.fulfill({ json: { environment: { nodeEnv: "test", bindings: {} } } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("No prediction was recorded for this action.")).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `${OUT_DIR}/verification-no-prediction-1440.png`, fullPage: true })
  })
})
