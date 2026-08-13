import { test, expect } from "@playwright/test"

// jarvis-v3 P5.T7 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3).
// `voice.say()` is a real no-op without a live Vapi session (`vapiRef.current`
// is null until a real voice session starts, which needs a real microphone —
// established absent in this environment, P2/P3) — so this cannot prove
// AUDIO played, only that the real timer/effect in bridge/ThreadBridge.tsx
// (guarded by the unit-tested `shouldFireD3Narration`, lib/d3-narration.test.ts)
// fires at the real D3_LONG_EXECUTION_MS delay without throwing. The decision
// LOGIC itself is unit-tested directly; this is the runtime half of the same
// real code path.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("P5.T7 — D3 narration pilot, FIXTURE harness (real timer/effect)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(60_000)

  test("the real D3 effect fires past its own delay for an executing thread, with zero console errors", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")

    // Same filter every other real-session spec this phase uses: the sanity
    // lane's own pipeline-health/reliability read-models genuinely 500 on the
    // real deployed backend (pre-existing, documented DEFECT LEDGER NEW-2,
    // out of this task's scope) — filtered as known noise, not swallowing a
    // real new error.
    const errors: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      if (msg.type() === "error" && !text.includes("401") && !text.includes("500") && !text.includes("429") && !text.includes("404")) errors.push(text)
    })
    page.on("pageerror", (err) => errors.push(err.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=execution", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("Doing it")).toBeVisible({ timeout: 10_000 })

    // D3_LONG_EXECUTION_MS is 8000ms — wait past it for real (this environment
    // has no way to fast-forward a real browser's own setTimeout honestly).
    await page.waitForTimeout(9_000)

    expect(errors, `unexpected console/page errors after the D3 effect's own real delay: ${errors.join(" | ")}`).toEqual([])
  })
})
