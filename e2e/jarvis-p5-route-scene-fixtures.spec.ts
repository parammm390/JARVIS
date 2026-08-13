import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T2 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3), same
// posture as every prior phase's harness. Renders the REAL ApprovalCockpit ->
// ActionRenderer -> RouteScene -> DispatchMapCore component tree (not a
// separate mock), with only `actions/pending` and `dispatch/map` intercepted.
// `dispatch/map`'s fixture shape matches panels/DispatchMap.tsx's real
// `MapData`/`Stop` types exactly (verified by reading the file), with real
// Cedar Falls, IA coordinates matching this tenant's own seeded addresses —
// never invented geometry.

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

const FIXTURE_TECH_ID = "fixture-tech-priya"
const FIXTURE_DATE = "2026-08-05"

const FIXTURE_MAP_DATA = {
  date: FIXTURE_DATE,
  synthetic: false,
  unplacedStops: 0,
  route: { naiveKm: 42.1, optimizedKm: 31.6, kmSaved: 10.5 },
  stops: [
    { visitId: "visit-1", technicianId: FIXTURE_TECH_ID, technicianName: "Priya Nair", householdId: "hh-1", address: "215 Cypress Ct, Cedar Falls, IA", latitude: 42.529, longitude: -92.445, type: "water_test", scheduledAt: `${FIXTURE_DATE}T14:00:00.000Z`, notes: null, optimized: { sequence: 1 } },
    { visitId: "visit-2", technicianId: FIXTURE_TECH_ID, technicianName: "Priya Nair", householdId: "hh-2", address: "77 Fieldstone Dr, Cedar Falls, IA", latitude: 42.521, longitude: -92.462, type: "install", scheduledAt: `${FIXTURE_DATE}T16:00:00.000Z`, notes: null, optimized: { sequence: 2 } },
    { visitId: "visit-3", technicianId: "other-tech", technicianName: "Dale Brooks", householdId: "hh-3", address: "340 Prairie View Ave, Cedar Falls, IA", latitude: 42.512, longitude: -92.44, type: "install", scheduledAt: `${FIXTURE_DATE}T10:00:00.000Z`, notes: null, optimized: null },
  ],
}

test.describe.configure({ mode: "serial" })

test.describe("P5.T2 — RouteScene, FIXTURE harness (real component tree)", () => {
  test.setTimeout(120_000)
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("route_suggestion renders the real DispatchMap, scoped to this technician's stops only", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    const routeAction = {
      id: "fixture-node-route",
      actionType: "route_suggestion",
      summary: `Review the ${FIXTURE_DATE} route suggestion for Priya Nair (2 scheduled stops).`,
      payload: { technicianId: FIXTURE_TECH_ID, date: FIXTURE_DATE },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [routeAction] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    await page.route(`**/api/jarvis/dispatch/map?date=${FIXTURE_DATE}`, (route) => route.fulfill({ json: FIXTURE_MAP_DATA }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=route-approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)

    await expect(page.getByText("Route Suggestion", { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    // Real, technician-scoped stop count: 2 of the 3 fixture stops belong to
    // FIXTURE_TECH_ID — the third (Dale Brooks) must be filtered out client-side.
    await expect(page.getByText("Priya Nair · 2026-08-05 · 2 stops")).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(6000) // let the dynamic maplibre-gl import + real tile load settle
    await page.screenshot({ path: `${OUT_DIR}/route-scene-fixture-approval-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT_DIR}/route-scene-fixture-approval-390.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })

  test("a technician/date with zero real stops renders an honest empty state, not a blank map", async ({ page }) => {
    // Real finding from this phase's own full-suite run: a real sign-in
    // races against another project's own real sign-in under full
    // parallelism — single real-session run only, matching this file's own
    // first test and every other real-session spec's convention.
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })
    const routeAction = {
      id: "fixture-node-route-empty",
      actionType: "route_suggestion",
      summary: "Review the 2026-08-06 route suggestion for Dale Brooks (0 scheduled stops).",
      payload: { technicianId: "fixture-tech-empty", date: "2026-08-06" },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [routeAction] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))
    await page.route("**/api/jarvis/dispatch/map?date=2026-08-06", (route) =>
      route.fulfill({ json: { date: "2026-08-06", synthetic: false, unplacedStops: 0, route: null, stops: [] } }),
    )

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).fill(password!)
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 20_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=route-empty-approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000)
    await expect(page.getByText("No scheduled stops for this technician on this date yet.")).toBeVisible({ timeout: 10_000 })
  })
})
