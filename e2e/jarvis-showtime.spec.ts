import { expect, test } from "@playwright/test"

// D8 exit-gate proof. The account remains supplied only by the environment: this
// test never creates a user, sends email, or approves/executes an action.
test("retired Dealer Zero route resolves to the canonical workspace", async ({ page }) => {
  const email = process.env.TEST_OWNER_EMAIL
  const password = process.env.TEST_OWNER_PASSWORD
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  await page.goto("/jarvis/login")
  await page.getByRole("textbox", { name: "Email" }).fill(email!)
  await page.getByRole("textbox", { name: "Password" }).fill(password!)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("**/jarvis")

  await page.goto("/jarvis/showtime")
  await expect(page).toHaveURL(/\/jarvis$/)
  await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
  await expect(page.getByRole("heading", { name: "What needs attention now" })).toBeVisible()
})
