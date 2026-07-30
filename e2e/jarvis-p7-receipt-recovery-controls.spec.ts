import { test, expect } from "@playwright/test"

// P7.T5: the real receipt surface may expose Retry only after it resolves the
// receipt's durable workflowRunId against the run read model for its current
// optimistic-lock version. Every request below is intercepted: this proves the
// production component's binding without performing a business mutation.
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222"
const RUN_ID = "33333333-3333-4333-8333-333333333333"
const COMPENSATED_RECEIPT_ID = "44444444-4444-4444-8444-444444444444"
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

const COMPENSATED_RECEIPT = {
  ...RECEIPT,
  id: COMPENSATED_RECEIPT_ID,
  workflowRunId: null,
  failure: { errorKind: "compensated", recoveryPath: "view_rollback", message: "The previous effect was rolled back." },
  actualResult: { compensation: { status: "compensated", caseId: "case-rollback-1", reason: "customer canceled" } },
}

async function signInOwner(page: import("@playwright/test").Page) {
  await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
  await page.getByPlaceholder(/you@example.com/i).click()
  await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
  await page.getByPlaceholder(/•+/i).click()
  await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
  await page.getByRole("button", { name: /sign in/i }).click()
  await page.waitForURL("**/jarvis", { timeout: 20_000 })
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

  await signInOwner(page)

  await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
  await expect(page.getByText("FIXTURE · receipt")).toBeVisible({ timeout: 10_000 })
  const retry = page.getByLabel("Recovery: transient").getByRole("button", { name: "Retry" })
  await expect(retry).toBeVisible()
  const request = page.waitForRequest(`**/api/jarvis/workflows/runs/${RUN_ID}/retry`)
  await retry.click()
  await request
})

test("P7 receipt View rollback targets the recorded compensation case", async ({ page }) => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.skip(test.info().project.name !== "desktop-chromium", "single explicit viewport")
  await page.route("**/api/jarvis/receipts?domainActionId=*", (route) =>
    route.fulfill({ json: { receipts: [{ id: COMPENSATED_RECEIPT_ID }] } }),
  )
  await page.route(`**/api/jarvis/receipts/${COMPENSATED_RECEIPT_ID}`, (route) => route.fulfill({ json: { receipt: COMPENSATED_RECEIPT } }))
  await signInOwner(page)
  await page.goto("/jarvis/next?fixture=receipt", { waitUntil: "domcontentloaded" })
  await expect(page.getByText("FIXTURE · receipt")).toBeVisible({ timeout: 10_000 })

  const receipt = page.locator("#compensation-case-rollback-1")
  await expect(receipt).toContainText("Rolled back", { timeout: 10_000 })
  await page.getByRole("button", { name: "View rollback" }).click()
})
