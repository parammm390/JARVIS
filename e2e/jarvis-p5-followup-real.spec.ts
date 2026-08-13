import { test, expect, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T5 — V8 follow-up references, driven for real: two
// instructions in the SAME session (the live Thread mints one `sessionId`
// per tab, persisted in sessionStorage, per P2.T4's own fix — verified real
// and live, not assumed, since kernel/instruction.ts's `getOrCreateSessionId`
// reuses the existing id for the tab). Research only this run — observe what
// the real backend actually does with a follow-up reference before deciding
// how the frontend should render an unresolved one, per this session's own
// "verify before building" discipline.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const OUT_DIR = "qa-screenshots/v3-P5"

test.describe("P5.T5 — follow-up references, real session, research only", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(120_000)

  test("a second, referential instruction in the same session — observe the real outcome", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-journey run")
    mkdirSync(OUT_DIR, { recursive: true })

    const errors: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      if (msg.type() === "error" && !text.includes("401") && !text.includes("500") && !text.includes("429") && !text.includes("404")) errors.push(text)
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    const rail = page.getByRole("textbox", { name: "Tell JARVIS what you need" })
    await expect(rail).toBeVisible({ timeout: 15_000 })
    await rail.click()
    await rail.fill("Book a water test for the Hendersons this week")
    await rail.press("Enter")
    await expect(page.getByText("Book a water test for the Hendersons this week").first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT_DIR}/followup-00-first-turn-1440.png`, fullPage: true })

    const sessionIdAfterFirst = await page.evaluate(() =>
      Object.keys(window.sessionStorage)
        .filter((k) => k.includes("session"))
        .map((k) => `${k}=${window.sessionStorage.getItem(k)}`)
        .join(", "),
    )
    console.log(`REAL sessionStorage session keys after turn 1: ${sessionIdAfterFirst}`)

    // The real planner may either ask for the missing household identity or
    // produce an approval-gated booking plan when that context is already in
    // memory. Resolve either outcome without executing it: cancel a
    // clarification or reject every pending action. The follow-up below then
    // remains a new, referential turn in the same authenticated session.
    const cancelButton = page.getByRole("button", { name: "Cancel" })
    const rejectButtons = page.getByRole("button", { name: "Reject" })
    await expect.poll(async () => {
      if (await rail.isEditable().catch(() => false)) return "ready"
      if (await cancelButton.first().isVisible().catch(() => false)) return "cancel"
      if (await rejectButtons.first().isVisible().catch(() => false)) return "reject"
      return "waiting"
    }, { timeout: 30_000 }).not.toBe("waiting")

    if (await cancelButton.first().isVisible().catch(() => false)) {
      await cancelButton.first().click()
    } else {
      while (await rejectButtons.first().isVisible().catch(() => false)) {
        await rejectButtons.first().click()
      }
    }

    await expect(rail).toBeEditable({ timeout: 30_000 })
    await rail.click()
    await rail.fill("Actually, make that Thursday instead")
    await rail.press("Enter")
    await expect(page.getByText("Actually, make that Thursday instead").first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT_DIR}/followup-01-second-turn-1440.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    console.log(`REAL page text after the follow-up turn (first 2000 chars): ${bodyText.slice(0, 2000)}`)

    expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
  })
})
