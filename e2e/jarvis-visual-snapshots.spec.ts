import { test, expect, type Page } from "@playwright/test"

// C1.T4 — visual regression protection BEFORE any strangler-pattern panel migration
// (hard rule #8: no panel refactors before this exists). Covers /jarvis/stage plus
// every existing view the sidebar switches between (JarvisCommandCenter.tsx's `view`
// state — Command Center, Voice Console, Leads & CRM, Customers, Workflows,
// Inventory, Invoices, Water Compliance, Web Research, Activity, Production
// Readiness), all reachable logged-out via the app's own designed sample-data
// fallback (same public surface e2e/jarvis-public.spec.ts already exercises without
// credentials).
//
// Baselines are approximate by design, not pixel-perfect: this app is animation- and
// live-data-heavy (framer-motion, particle fields, tickers, sparklines with
// synthetic-but-moving values). animations: "disabled" freezes CSS/JS-driven
// transitions Playwright can see; maxDiffPixelRatio absorbs the residual canvas/SVG
// motion (particle fields, animated dashes) that isn't a CSS transition and can't be
// frozen that way. The point of this suite is catching gross structural/layout
// regressions before a panel gets touched, not zero-tolerance pixel diffing.
const SCREENSHOT_OPTS = { animations: "disabled" as const, maxDiffPixelRatio: 0.05 }

const SIDEBAR_VIEWS = [
  "Command Center",
  "Voice Console",
  "Leads & CRM",
  "Customers",
  "Workflows",
  "Inventory",
  "Invoices",
  "Water Compliance",
  "Web Research",
  "Activity",
  "Production Readiness",
]

async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator("main").getByText(/^(Live|Simulation)$/).first()).toBeVisible({ timeout: 15_000 })
  // Let the boot sequence / first poll settle so the snapshot isn't mid-fade-in.
  await page.waitForTimeout(500)
}

test.describe("visual snapshots — sidebar views (logged out, sample-data mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/jarvis")
    await waitForAppReady(page)
  })

  // Voice Console genuinely needs a wider tolerance than every other view: it mounts
  // ParticleField + LiveCallPanel (dynamic-imported canvas/SVG animation, JarvisOrb-
  // adjacent), which `animations: "disabled"` can't freeze the way it does CSS
  // transitions. Measured for real, not guessed: a plain back-to-back rerun against
  // its own freshly-written baseline (no code change in between) diffed ~6% of
  // pixels — every other view diffed 0% at the default 5% tolerance. Widening only
  // this one view keeps the other 10 at the tight default instead of hiding a real
  // regression behind a blanket loose threshold.
  const PER_VIEW_TOLERANCE: Record<string, number> = { "Voice Console": 0.12 }

  for (const label of SIDEBAR_VIEWS) {
    test(`${label} view`, async ({ page }) => {
      if (label !== "Command Center") {
        await page.getByRole("button", { name: label }).first().click()
        await page.waitForTimeout(300) // view-switch transition settle
      }
      const opts = PER_VIEW_TOLERANCE[label] ? { ...SCREENSHOT_OPTS, maxDiffPixelRatio: PER_VIEW_TOLERANCE[label] } : SCREENSHOT_OPTS
      await expect(page).toHaveScreenshot(`view-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, opts)
    })
  }
})

test.describe("visual snapshots — /jarvis/stage", () => {
  test("logged-out gate screen", async ({ page }) => {
    await page.goto("/jarvis/stage")
    await expect(page.getByText("Owner access required")).toBeVisible()
    await expect(page).toHaveScreenshot("stage-signed-out-gate.png", SCREENSHOT_OPTS)
  })

  const email = process.env.TEST_OWNER_EMAIL
  const password = process.env.TEST_OWNER_PASSWORD
  test("owner content — useLiveQuery fixture section", async ({ page }) => {
    test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set — see e2e/jarvis-authenticated.spec.ts's header for why this isn't faked")
    await page.goto("/jarvis/login")
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis")
    await page.goto("/jarvis/stage")
    await expect(page.getByText("useLiveQuery")).toBeVisible()
    await page.waitForTimeout(3_000) // let at least one fixture poll land
    await expect(page).toHaveScreenshot("stage-owner-content.png", SCREENSHOT_OPTS)
  })
})

test.describe("visual snapshots — /jarvis/bridge (D1 Command Bridge + D2 Approval Cockpit)", () => {
  // Bridge gates its whole route behind a real session (BridgeShell in Bridge.tsx) —
  // same honest limitation as Stage's owner-content case below: a signed-in mouse-
  // free approve/reject/undo cycle needs a real Supabase account, which this repo's
  // standing rule says never to mint. The signed-out gate is what's real and
  // reachable without one.
  test("logged-out gate screen", async ({ page }) => {
    await page.goto("/jarvis/bridge")
    await expect(page.getByText("Sign in required")).toBeVisible()
    await expect(page).toHaveScreenshot("bridge-signed-out-gate.png", SCREENSHOT_OPTS)
  })

  const email = process.env.TEST_OWNER_EMAIL
  const password = process.env.TEST_OWNER_PASSWORD
  test("owner content — Bridge with live Orb/PulseBar/ApprovalCockpit", async ({ page }) => {
    test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set — see e2e/jarvis-authenticated.spec.ts's header for why this isn't faked")
    await page.goto("/jarvis/login")
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis")
    await page.goto("/jarvis/bridge")
    await expect(page.getByText("Awaiting Your Approval")).toBeVisible()
    await page.waitForTimeout(3_000) // let at least one fast-lane poll land
    await expect(page).toHaveScreenshot("bridge-owner-content.png", SCREENSHOT_OPTS)
  })
})
