import { test, expect } from "@playwright/test"

// P7.T5: the real receipt surface may expose Retry only after it resolves the
// receipt's durable workflowRunId against the run read model for its current
// optimistic-lock version. Every request below is intercepted: this proves the
// production component's binding without performing a business mutation.
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222"
const RUN_ID = "33333333-3333-4333-8333-333333333333"
const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const RECEIPT = {
  id: RECEIPT_ID,
  workflowRunId: RUN_ID,
  objective: "Collect an overdue invoice",
  evidence: [],
  policyApplied: { id: "fixture-policy", version: 1 },
  riskTier: "medium",
  proposedAction: { stepType: "charge_card", payload: { invoiceId: "fixture-invoice" } },
  approval: { required: true, approvedBy: "fixture-owner", at: new Date().toISOString() },
  expectedResult: { charged: true },
  actualResult: {},
  failure: { errorKind: "provider_error", recoveryPath: "retry_run", message: "The provider timed out." },
  correlationId: "fixture-correlation",
  createdAt: new Date().toISOString(),
  finalizedAt: new Date().toISOString(),
  predicted: null,
  predictionDiff: null,
}

test("P7 receipt Retry binds the real run id and current version", async ({ page }) => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.skip(test.info().project.name !== "desktop-chromium", "single explicit viewport")
  await page.route("**/api/jarvis/receipts?domainActionId=*", (route) =>
    route.fulfill({ json: { receipts: [{ id: RECEIPT_ID }] } }),
  )
  await page.route(`**/api/jarvis/receipts/${RECEIPT_ID}`, (route) => route.fulfill({ json: { receipt: RECEIPT } }))
  await page.route("**/api/jarvis/workflows/runs", (route) => route.fulfill({
    json: { runs: [{ id: RUN_ID, status: "failed", version: 7 }] },
  }))
  await page.route(`**/api/jarvis/workflows/runs/${RUN_ID}/retry`, async (route) => {
    expect(route.request().method()).toBe("POST")
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 7 })
    await route.fulfill({ json: { run: { id: RUN_ID, status: "running", version: 8 } } })
  })

  await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
  await page.getByPlaceholder(/you@example.com/i).click()
  await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
  await page.getByPlaceholder(/•+/i).click()
  await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/jarvis", { timeout: 20_000 })

  await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Retry" }).click()
})
