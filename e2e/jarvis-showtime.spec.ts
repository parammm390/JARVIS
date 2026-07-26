import { expect, test } from "@playwright/test"

// D8 exit-gate proof. The account remains supplied only by the environment: this
// test never creates a user, sends email, or approves/executes an action.
test("Dealer Zero owner can complete and inspect the synthetic Showtime run", async ({ page }) => {
  const email = process.env.TEST_OWNER_EMAIL
  const password = process.env.TEST_OWNER_PASSWORD
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })

  await page.goto("/jarvis/login")
  await page.getByRole("textbox", { name: "Email" }).fill(email!)
  await page.getByRole("textbox", { name: "Password" }).fill(password!)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("**/jarvis")

  await page.goto("/jarvis/showtime")
  await expect(page.getByRole("heading", { name: "Showtime" })).toBeVisible()
  await page.getByRole("button", { name: "Start 60× demo" }).click()
  await expect(page.getByRole("heading", { name: "DEMO — Dealer Zero synthetic day ends" })).toBeVisible({ timeout: 15_000 })

  const receipts = page.getByRole("button", { name: "Inspect receipt" })
  await expect(receipts).toHaveCount(3)
  await receipts.first().click()
  await expect(page.getByRole("heading", { name: "Why?" })).toBeVisible()
  await expect(page.getByText("finalized", { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
