import { expect, test } from "@playwright/test"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("Upgrade 10 real Work surface", () => {
  test.skip(!email || !password, "dedicated test-tenant credentials are required; this journey is never faked")
  test.setTimeout(120_000)

  test("an employee assigns a read-only objective and sees its identity, history, and next state on the same Work", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single production-safe journey")
    const objective = `Upgrade 10 proof ${Date.now()}: inspect current business state, report only what you observe, and do not create or execute a business action.`
    const pageErrors: string[] = []
    const failedResponses: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("response", (response) => {
      if (response.status() >= 500) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/work", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible()
    await expect(page.getByText(/cases observed/)).toBeVisible({ timeout: 20_000 })
    await page.getByRole("textbox", { name: "Business objective" }).fill(objective)
    await page.getByRole("button", { name: "Assign objective" }).click()
    await expect(page).toHaveURL(/\/jarvis\/work\?workCaseId=[0-9a-f-]+/i, { timeout: 20_000 })

    await expect(page.locator("#jarvis-work-case-title")).toHaveText(objective, { timeout: 20_000 })
    await expect(page.locator("[data-objective-state]").getByText(objective, { exact: true })).toBeVisible()
    await expect(page.getByText("WHY", { exact: true })).toBeVisible()
    await expect(page.getByText("OWNER", { exact: true })).toBeVisible()
    await expect(page.getByText(/Employee identity and authority context are attached/)).toBeVisible()
    await expect(page.getByText(/revision \d+/)).toBeVisible()
    await page.screenshot({ path: "docs/release/evidence/upgrade10-real-work-journey.png", fullPage: true })

    expect(pageErrors).toEqual([])
    expect(failedResponses).toEqual([])
  })
})
