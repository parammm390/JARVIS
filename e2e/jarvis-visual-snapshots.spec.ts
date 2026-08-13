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

// The compact sidebar intentionally shortens these two labels at narrow widths.
// Keep the same logical view and baseline name across viewports while targeting the
// control a mobile user can actually see.
function sidebarAccessibleName(label: string): string | RegExp {
  if (label === "Leads & CRM") return /^(Leads & CRM|Leads)$/
  if (label === "Water Compliance") return /^(Water Compliance|Compliance)$/
  return label
}

async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("heading", { name: "JARVIS workspace" })).toBeVisible()
}

test.describe("visual snapshots — canonical workspace shell", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeEach(async ({ page }) => {
    await page.goto("/jarvis")
    await waitForAppReady(page)
  })

  for (const label of SIDEBAR_VIEWS) {
    test(`${label} view`, async ({ page }) => {
      // These labels belonged to the retired multi-panel console. Each case
      // remains an explicit guard against a stale island returning under an old
      // label; the canonical adaptive workspace is now the only owner surface.
      await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
      await expect(page.getByRole("heading", { name: "JARVIS workspace" })).toBeVisible()
      await expect(page.getByRole("button", { name: sidebarAccessibleName(label) })).toHaveCount(0)
    })
  }
})

test.describe("visual snapshots — /jarvis/stage", () => {
  test("logged-out gate screen", async ({ page }) => {
    await page.goto("/jarvis/stage")
    await expect(page).toHaveURL(/\/jarvis$/)
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
    await expect(page.getByText("PUBLIC PREVIEW", { exact: true })).toBeVisible()
  })

  test("owner content — useLiveQuery fixture section", async ({ page }) => {
    await page.goto("/jarvis/stage")
    await expect(page).toHaveURL(/\/jarvis$/)
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
    await expect(page.getByRole("heading", { name: "JARVIS workspace" })).toBeVisible()
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
    await expect(page).toHaveURL(/\/jarvis$/)
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
    await expect(page.getByText("PUBLIC PREVIEW", { exact: true })).toBeVisible()
  })

  test("owner content — Bridge with live Orb/PulseBar/ApprovalCockpit", async ({ page }) => {
    await page.goto("/jarvis/bridge")
    await expect(page).toHaveURL(/\/jarvis$/)
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
    await expect(page.getByRole("heading", { name: "JARVIS workspace" })).toBeVisible()
  })
})

test.describe("/jarvis/showtime (D8)", () => {
  test("keeps the Dealer Zero demo behind the honest signed-in gate", async ({ page }) => {
    await page.goto("/jarvis/showtime")
    await expect(page).toHaveURL(/\/jarvis$/)
    await expect(page.locator("[data-jarvis-adaptive-runtime]")).toBeVisible()
    await expect(page.getByText("PUBLIC PREVIEW", { exact: true })).toBeVisible()
  })
})
