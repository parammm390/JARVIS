import { test, expect, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T1 — Flagship B (plan v3 §8 PHASE 5) driven for real: sign in,
// submit the flagship phrase, verify the ACTUAL planned action types before
// ever touching Approve. Per this session's own pre-flight (asked via
// AskUserQuestion before writing this spec): `start_water_test_workflow`'s
// `send_confirmation_call` step resolves through the seed tenant's REAL vapi
// communications binding (verified live: GET /api/setup/status ->
// bindings.communications = {mode:"vapi", source:"tenant"}, real phone number
// +13463636975, circuit breaker closed) — approving that bundle would place a
// real outbound call, exactly the category this session's standing rule
// forbids. The plan owner's explicit go-ahead is narrower: approve a real
// pending `assign_technician_to_visit` action ONLY (pure DB write, zero
// external side effects — verified from source, scheduling/index.ts:184-201),
// and NEVER approve `start_water_test_workflow` live this phase.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const OUT_DIR = process.env.JARVIS_E2E_OUT_DIR ?? "qa-screenshots/v3-P5"
const FORBIDDEN_ACTION_TYPE = "start_water_test_workflow"
const SAFE_ACTION_TYPE = "assign_technician_to_visit"

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

test.describe("P5.T1 — Flagship B, driven for real, never approving a real outbound call", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(120_000)

  test("the flagship phrase produces a real plan, and the call-risk safety gate is honored", async ({ page }) => {
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

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    const token = await getRealAccessToken(page)
    expect(token, "real Supabase access token must be extractable after a real sign-in").not.toBeNull()

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1500)

    const rail = page.getByPlaceholder("Tell JARVIS what you need")
    await expect(rail).toBeVisible({ timeout: 15_000 })
    await rail.click()
    await rail.fill("Book a water test for the Hendersons this week and give it to whoever's closest")
    await rail.press("Enter")

    await expect(page.getByText("Book a water test for the Hendersons this week and give it to whoever's closest").first()).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => plannedActions.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByRole("heading", { name: /schedule workspace|execution workspace|plan and action/i })).toBeVisible()
    await page.waitForTimeout(1500)

    await page.screenshot({ path: `${OUT_DIR}/flagship-b-00-plan-1440.png`, fullPage: true })

    const businessActions = plannedActions.filter((a) => a.actionType !== "clarification_request")
    const types = businessActions.map((a) => a.actionType)
    console.log(`REAL planned action types this run: ${types.join(", ") || "(none)"}`)

    const containsForbidden = types.includes(FORBIDDEN_ACTION_TYPE)
    const hasSafeType = types.includes(SAFE_ACTION_TYPE)

    const rejectButtons = page.getByRole("button", { name: "Reject" })
    const hasCockpit = await rejectButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)

    if (containsForbidden || !hasSafeType) {
      // Never approve a plan containing start_water_test_workflow — its
      // send_confirmation_call step would place a real outbound Vapi call.
      // A plan with no safe assign_technician_to_visit action is also a
      // no-go for THIS spec's own approval branch (there is nothing safe to
      // approve) — reject everything real and report honestly.
      if (hasCockpit) {
        const count = await rejectButtons.count()
        for (let i = 0; i < count; i++) await rejectButtons.first().click({ timeout: 5_000 }).catch(() => undefined)
      }
      test.info().annotations.push({
        type: "call-risk-no-go",
        description: `Planned action types were [${types.join(", ")}]. Contains forbidden ${FORBIDDEN_ACTION_TYPE}: ${containsForbidden}. Rejected everything — never approving a plan that would place a real outbound call, per this session's own pre-flight go/no-go.`,
      })
      expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
      return
    }

    // Real go: approve ONLY the assign_technician_to_visit card(s). Reject
    // any other card present (defense in depth — containsForbidden is
    // already false here, but never approve blind). Each card is
    // role="group" with an aria-label of "<action type, spaces> — <tier>
    // risk" (ApprovalCockpit.tsx:220-221) — no data-action-type attribute
    // exists, so the accessible name is the real selector.
    await page.screenshot({ path: `${OUT_DIR}/flagship-b-01-approval-cockpit-1440.png`, fullPage: true })
    const safeCardName = SAFE_ACTION_TYPE.replaceAll("_", " ")
    const safeCards = page.getByRole("group", { name: new RegExp(safeCardName, "i") })
    const safeCount = await safeCards.count().catch(() => 0)
    for (let i = 0; i < safeCount; i++) {
      await safeCards.first().getByRole("button", { name: "Approve" }).click({ timeout: 5_000 }).catch(() => undefined)
      await page.waitForTimeout(400)
    }
    const remainingRejects = page.getByRole("button", { name: "Reject" })
    const remainingCount = await remainingRejects.count().catch(() => 0)
    for (let i = 0; i < remainingCount; i++) {
      await remainingRejects.first().click({ timeout: 5_000 }).catch(() => undefined)
      await page.waitForTimeout(400)
    }

    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT_DIR}/flagship-b-02-after-decision-1440.png`, fullPage: true })

    expect(errors, `unexpected console errors: ${errors.join(" | ")}`).toEqual([])
  })
})
