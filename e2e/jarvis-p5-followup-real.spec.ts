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
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    const rail = page.getByRole("textbox", { name: "Tell JARVIS what you need" })
    await expect(rail).toBeVisible({ timeout: 15_000 })
    await rail.click()
    await rail.fill("Book a water test for the Hendersons this week")
    await rail.press("Enter")
    await expect(page.getByText("Book a water test for the Hendersons this week")).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT_DIR}/followup-00-first-turn-1440.png`, fullPage: true })

    const sessionIdAfterFirst = await page.evaluate(() =>
      Object.keys(window.sessionStorage)
        .filter((k) => k.includes("session"))
        .map((k) => `${k}=${window.sessionStorage.getItem(k)}`)
        .join(", "),
    )
    console.log(`REAL sessionStorage session keys after turn 1: ${sessionIdAfterFirst}`)

    // Real, honest finding: turn 1 itself came back as a real clarification
    // ("What is the phone number or household ID of the Hendersons?") — the
    // rail's placeholder changes to "Answer above, or ask something else"
    // (§6④), but the SAME rail (stable aria-label, not the placeholder) stays
    // usable. Cancel this clarification (a clean, real, in-session state) so
    // the second submission below is unambiguously a NEW instruction the
    // planner must resolve "that" against turn 1's own memory, not an
    // in-progress answer to it.
    const cancelButton = page.getByRole("button", { name: "Cancel" })
    if (await cancelButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cancelButton.click()
      await page.waitForTimeout(1000)
    }

    await expect(rail).toBeEditable({ timeout: 15_000 })
    await rail.click()
    await rail.fill("Actually, make that Thursday instead")
    await rail.press("Enter")
    await expect(page.getByText("Actually, make that Thursday instead")).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT_DIR}/followup-01-second-turn-1440.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    console.log(`REAL page text after the follow-up turn (first 2000 chars): ${bodyText.slice(0, 2000)}`)

    expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
  })
})
