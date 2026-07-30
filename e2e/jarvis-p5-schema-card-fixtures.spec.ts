import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T4 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3).
// Renders the REAL ApprovalCockpit -> ActionRenderer -> SchemaCard component
// tree for 5 genuinely UNREGISTERED action types (prefixed `test_unregistered_`
// so they can never collide with any real or future registered type — grepped
// registry.ts to confirm none of the 41+1 real types share this prefix). Each
// exercises a different real code path: no plugin/no fields at all (pure
// generic), a nested-object payload, an array payload, a >4-field payload
// (the "Show details" disclosure), and the owner-debug raw-payload toggle.

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const ACTIONS = [
  {
    id: "fixture-unreg-1",
    actionType: "test_unregistered_action_alpha",
    summary: "A genuinely unregistered action type with a flat payload.",
    payload: { customerName: "Dana Alvarez", amountUsd: 240, scheduledFor: "2026-08-10" },
  },
  {
    id: "fixture-unreg-2",
    actionType: "test_unregistered_action_beta",
    summary: "A genuinely unregistered action type with a nested-object payload.",
    payload: { target: { householdId: "hh-9", label: "Ortiz · Spring Hollow Ct" }, note: "verify before sending" },
  },
  {
    id: "fixture-unreg-3",
    actionType: "test_unregistered_action_gamma",
    summary: "A genuinely unregistered action type with an array payload.",
    payload: { steps: ["check_inventory", "reserve_parts", "notify_technician"], urgent: true },
  },
  {
    id: "fixture-unreg-4",
    actionType: "test_unregistered_action_delta",
    summary: "A genuinely unregistered action type with more than 4 fields — exercises Show details.",
    payload: { fieldOne: "a", fieldTwo: "b", fieldThree: "c", fieldFour: "d", fieldFive: "e", fieldSix: "f" },
  },
  {
    id: "fixture-unreg-5",
    actionType: "test_unregistered_action_epsilon",
    summary: "A genuinely unregistered action type with zero payload fields.",
    payload: {},
  },
]

test.describe.configure({ mode: "serial" })

test.describe("P5.T4 — SchemaCard, FIXTURE harness (real component tree)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("5 unregistered action types each render with dignity, no raw JSON, via the real registry fallback", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    const actions = ACTIONS.map((a) => ({
      ...a,
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }))
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))

    await page.setViewportSize({ width: 1440, height: 1600 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=empty-approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    // Each humanized title renders — proves SchemaCard, not FallbackRenderer's
    // old "unmapped action type" copy, is the live default now.
    await expect(page.getByText("Test unregistered action alpha", { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Test unregistered action beta", { exact: true })).toBeVisible()
    await expect(page.getByText("Test unregistered action gamma", { exact: true })).toBeVisible()
    await expect(page.getByText("Test unregistered action delta", { exact: true })).toBeVisible()
    await expect(page.getByText("Test unregistered action epsilon", { exact: true })).toBeVisible()
    await expect(page.getByText("unmapped action type")).toHaveCount(0)

    // Real field rendering, typed by shape — never JSON.
    await expect(page.getByText("Dana Alvarez")).toBeVisible() // flat field
    await expect(page.getByText(/Household id: hh-9/)).toBeVisible() // nested object, flattened to "key: value" text
    await expect(page.getByText(/check_inventory, reserve_parts, notify_technician/)).toBeVisible() // array joined
    await expect(page.getByText("No payload fields set yet")).toBeVisible() // epsilon, zero fields

    // "Show details" disclosure — delta has 6 fields, only 4 visible until expanded.
    const showDetails = page.getByRole("button", { name: /Show details \(2 more\)/ })
    await expect(showDetails).toBeVisible()
    await expect(page.getByText("fieldFive", { exact: false })).toHaveCount(0)
    await showDetails.click()
    await expect(page.getByText("Field five")).toBeVisible()

    await page.screenshot({ path: `${OUT_DIR}/schema-card-fixture-unregistered-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 2200 })
    await page.screenshot({ path: `${OUT_DIR}/schema-card-fixture-unregistered-390.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })

  test("the owner-debug raw-payload toggle exists, is off by default, and reveals real JSON only when explicitly opened", async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true })
    const action = {
      id: "fixture-unreg-debug",
      actionType: "test_unregistered_action_zeta",
      summary: "Owner-debug toggle check.",
      payload: { rawField: "raw-value-for-debug-check" },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [action] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 15 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=empty-approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    // TEST_OWNER_* is a real owner account (BLOCKER B-3) — the toggle should
    // be present. Raw JSON must NOT be in the DOM until explicitly opened.
    const bodyBefore = await page.locator("body").innerText()
    expect(bodyBefore).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
    // Real robustness finding from this phase's own full-suite run: the
    // toggle is gated on useJarvisAuth()'s real `role`, which re-fetches
    // GET /api/me fresh after this navigation (JarvisAuthProvider remounts
    // on a full page.goto) — under real backend load that can occasionally
    // take longer than 10s. A generous 20s timeout, not a fixed extra sleep,
    // since Playwright's own expect() already polls.
    const debugToggle = page.getByRole("button", { name: "Owner debug: view raw payload" })
    await expect(debugToggle).toBeVisible({ timeout: 20_000 })
    await debugToggle.click()
    // SchemaCard's own toggle just MOUNTS FallbackRenderer (owner-gated) —
    // FallbackRenderer keeps its own separate, still-collapsed internal
    // "show raw payload (debug)" toggle (its own pre-existing behavior,
    // unchanged by this phase). Two real gates, not a bug.
    await expect(page.getByText(/"rawField"/)).toHaveCount(0)
    await page.getByRole("button", { name: /show raw payload \(debug\)/ }).click()
    await expect(page.getByText(/"rawField"/)).toBeVisible()
  })
})
