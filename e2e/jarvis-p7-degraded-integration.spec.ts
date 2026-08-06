import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// P7.T4: fixture data is explicitly confined to the dev-only Thread harness.
// The rendered receipt, recovery panel, and setup destination are the production
// component tree and public route, so the assertion exercises the real link.
const RECEIPT_ID = "fixture-receipt-integration-unavailable"

const RECEIPT = {
  id: RECEIPT_ID,
  objective: "Collect an overdue invoice",
  evidence: [],
  policyApplied: { id: "fixture-policy", version: 1 },
  riskTier: "medium",
  proposedAction: { stepType: "charge_card", payload: { invoiceId: "fixture-invoice" } },
  approval: { required: true, approvedBy: "fixture-owner", at: new Date().toISOString() },
  expectedResult: { charged: true },
  actualResult: {},
  failure: {
    errorKind: "provider_down",
    recoveryPath: "connect_integration",
    message: "Stripe credentials are unavailable for this fixture.",
  },
  correlationId: "fixture-correlation",
  createdAt: new Date().toISOString(),
  finalizedAt: new Date().toISOString(),
  predicted: null,
  predictionDiff: null,
}

test("P7 degraded integration receipt exposes a truthful Connect setup path", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "single explicit viewport")
  mkdirSync("qa-screenshots/v3-P7", { recursive: true })
  await page.route("**/api/jarvis/receipts?domainActionId=*", (route) =>
    route.fulfill({ json: { receipts: [{ id: RECEIPT_ID }] } }),
  )
  await page.route(`**/api/jarvis/receipts/${RECEIPT_ID}`, (route) => route.fulfill({ json: { receipt: RECEIPT } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })

  await expect(page.getByText("The required integration isn't connected yet.")).toBeVisible({ timeout: 10_000 })
  const connect = page.getByRole("link", { name: "Connect" })
  await expect(connect).toHaveAttribute("href", "/resources/pilot-setup-checklist")
  await page.screenshot({ path: "qa-screenshots/v3-P7/degraded-integration-recovery-1440.png", fullPage: true, animations: "disabled" })

  await connect.click()
  await expect(page).toHaveURL(/\/resources\/pilot-setup-checklist$/)
  await expect(page.getByRole("heading", { name: "JARVIS Deployment Setup Checklist" })).toBeVisible()
})
