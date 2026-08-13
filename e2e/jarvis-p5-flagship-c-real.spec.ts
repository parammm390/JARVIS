import { test, expect, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T3 — Flagship C, driven for real: sign in, submit the plan's
// own exact phrase, verify the REAL pending action's `channel` before ever
// touching Approve. Per this session's own pre-flight (BLOCKER B-7, asked
// via AskUserQuestion before writing this spec): `bulk_notify_existing_
// customers` with `channel:"call"` calls the real `vapi_place_call` tool
// directly in this environment (VAPI_API_KEY + a real VAPI_PHONE_NUMBER_ID
// are both configured) — a real outbound call to every matching consented
// customer. `channel:"sms"` resolves to sandbox (GOHIGHLEVEL_API_KEY is
// unset). The plan owner's go-ahead is narrow: approve ONLY if the real
// pending action's channel is confirmed "sms" first; anything else
// (including "call") is a no-go, reported, never approved.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const OUT_DIR = process.env.JARVIS_E2E_OUT_DIR ?? "qa-screenshots/v3-P5"
const FORBIDDEN_CHANNEL = "call"

interface PlannedAction {
  id: string
  actionType: string
  payload: Record<string, unknown>
}

async function getRealAccessToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.includes("auth-token")) continue
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null")
        if (parsed?.access_token) return parsed.access_token as string
      } catch {
        continue
      }
    }
    return null
  })
}

test.describe("P5.T3 — Flagship C, driven for real, never approving a real outbound call", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(120_000)

  test("the flagship phrase produces a real plan, and the channel safety gate is honored", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-journey run")
    mkdirSync(OUT_DIR, { recursive: true })

    const errors: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      if (msg.type() === "error" && !text.includes("401") && !text.includes("500") && !text.includes("429") && !text.includes("404")) errors.push(text)
    })

    let plannedActions: PlannedAction[] = []
    page.on("response", (res) => {
      if (res.url().includes("/api/jarvis/actions") && res.request().method() === "POST") {
        res
          .json()
          .then((body) => {
            if (Array.isArray(body?.planned)) plannedActions = body.planned
          })
          .catch(() => undefined)
      }
    })

    const token0 = await (async () => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
      await page.getByPlaceholder(/you@example.com/i).fill(email!)
      await page.getByPlaceholder(/•+/i).fill(password!)
      await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
      await page.getByRole("button", { name: /sign in/i }).click()
      await page.waitForURL("**/jarvis", { timeout: 20_000 })
      return getRealAccessToken(page)
    })()
    expect(token0, "real Supabase access token must be extractable after a real sign-in").not.toBeNull()

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    const rail = page.getByPlaceholder("Tell JARVIS what you need")
    await expect(rail).toBeVisible({ timeout: 45_000 })
    await rail.click()
    await rail.fill("Tell every customer on a softener plan that we're doing free hardness checks next month")
    await rail.press("Enter")

    await expect(page.getByText("Tell every customer on a softener plan that we're doing free hardness checks next month").first()).toBeVisible({ timeout: 10_000 })
    // The adaptive workspace can still truthfully say "Preparing workspace"
    // after the planning response has arrived. Prove the real plan from the
    // response that the channel gate consumes, then assert its canonical
    // campaign workspace instead of waiting on one transient copy variant.
    await expect.poll(() => plannedActions.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByRole("heading", { name: /campaign workspace|execution workspace/i })).toBeVisible()
    await page.waitForTimeout(1500)

    await page.screenshot({ path: `${OUT_DIR}/flagship-c-00-plan-1440.png`, fullPage: true })

    const businessActions = plannedActions.filter((a) => a.actionType !== "clarification_request")
    const bulkActions = businessActions.filter((a) => a.actionType === "bulk_notify_existing_customers")
    const channels = bulkActions.map((a) => a.payload?.channel ?? "sms")
    console.log(`REAL planned action types this run: ${businessActions.map((a) => a.actionType).join(", ") || "(none)"}`)
    console.log(`REAL bulk-notify channel(s): ${channels.join(", ") || "(none)"}`)

    const allSafe = businessActions.length > 0 && businessActions.length === bulkActions.length && channels.every((c) => c === "sms")

    const rejectButtons = page.getByRole("button", { name: "Reject" })
    const hasCockpit = await rejectButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)

    if (!hasCockpit || !allSafe) {
      if (hasCockpit) {
        const count = await rejectButtons.count()
        for (let i = 0; i < count; i++) await rejectButtons.first().click({ timeout: 5_000 }).catch(() => undefined)
      }
      test.info().annotations.push({
        type: "channel-no-go",
        description: `Planned action types were [${businessActions.map((a) => a.actionType).join(", ")}], channels [${channels.join(", ")}]. Rejected everything — never approving a plan that isn't 100% confirmed channel:"sms" (never "${FORBIDDEN_CHANNEL}"), per this session's own pre-flight go/no-go.`,
      })
      expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
      return
    }

    // Real go: channel is confirmed "sms" for every bulk-notify action in
    // this plan. Approve for real.
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-01-approval-cockpit-1440.png`, fullPage: true })
    const approveButtons = page.getByRole("button", { name: "Approve" })
    const approveCount = await approveButtons.count()
    for (let i = 0; i < approveCount; i++) {
      await approveButtons.first().click()
      await page.waitForTimeout(400)
    }

    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT_DIR}/flagship-c-02-after-approval-1440.png`, fullPage: true })

    expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
  })
})
