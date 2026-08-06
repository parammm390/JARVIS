import { test, expect } from "@playwright/test"
import { mkdirSync } from "node:fs"

// jarvis-v3 P5.T1 exit-gate evidence — a labelled FIXTURE (§0.2 rule 3), same
// posture as P2/P3/P4's own harnesses. The real flagship-B phrase was
// submitted live 4 times this session against the real deployed backend
// (e2e/jarvis-p5-flagship-b-real.spec.ts) and produced a genuine 0-action
// plan every time (screenshotted: qa-screenshots/v3-P5/flagship-b-00-plan-
// 1440.png) — a real, honest new finding (see DEFECT LEDGER NEW-9), not a
// blocker this spec works around dishonestly. This spec renders the REAL
// ApprovalCockpit/ActionRenderer/LeadToWaterTestScene/SchedulingScene
// component tree (not a separate mock) through the P2 fixture harness
// (`/jarvis/next?fixture=flagship-b-approval`), with ONLY `actions/pending` intercepted
// — same pattern e2e/jarvis-p4-verification-fixtures.spec.ts already
// established. Payload shapes match each plugin's real zod schema
// (lead-to-water-test/index.ts's StartWaterTestWorkflowSchema,
// scheduling/index.ts's AssignTechSchema) verbatim, never invented fields.

const OUT_DIR = "qa-screenshots/v3-P5"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe.configure({ mode: "serial" })

test.describe("P5.T1 — Flagship B, FIXTURE harness (real component tree)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("start_water_test_workflow and assign_technician_to_visit both render with dignity in the real cockpit", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single real-session run")
    mkdirSync(OUT_DIR, { recursive: true })

    const waterTestAction = {
      id: "fixture-node-water-test",
      actionType: "start_water_test_workflow",
      summary: "Hold a water test appointment on 2026-08-05 and confirm it with the customer at +13195550142.",
      payload: {
        householdId: "fixture-household-henderson",
        technicianId: "fixture-tech-priya",
        scheduledAt: "2026-08-05T15:00:00.000Z",
        phoneNumber: "+13195550142",
        confirmationMessage: "Your water test is scheduled for 2026-08-05. Reply or call if you need to reschedule.",
      },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    }
    const assignTechAction = {
      id: "fixture-node-assign-tech",
      actionType: "assign_technician_to_visit",
      summary: "Assign Priya Nair to visit 48ea2724.",
      payload: { visitId: "48ea2724-a211-4e24-a9ba-aecdad3145f5", technicianName: "Priya Nair" },
      status: "pending",
      createdAt: new Date().toISOString(),
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: { visitId: "48ea2724-a211-4e24-a9ba-aecdad3145f5", visitFound: true, technician: "Priya Nair", fieldChanges: [{ field: "technicianId", from: null, to: "fixture-tech-priya" }], expectedResult: { visitId: "48ea2724-a211-4e24-a9ba-aecdad3145f5", technician: "Priya Nair" } },
    }
    await page.route("**/api/jarvis/actions/pending?filter=pending", (route) => route.fulfill({ json: { actions: [waterTestAction, assignTechAction] } }))
    await page.route("**/api/jarvis/actions/pending?filter=blocked", (route) => route.fulfill({ json: { actions: [] } }))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750) // wait for the client login form to hydrate before filling controlled inputs
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    await page.goto("/jarvis/next?fixture=flagship-b-approval", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5_000) // let the fast lane's real actions/pending poll (intercepted above) land

    // LeadToWaterTestScene renders the 3-stage funnel labels.
    await expect(page.getByText("hold appointment")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("send confirmation call")).toBeVisible()
    await expect(page.getByText("confirm appointment")).toBeVisible()
    // SchedulingScene renders the technician name for the assign action.
    await expect(page.getByText(/Priya Nair/).first()).toBeVisible()

    await page.screenshot({ path: `${OUT_DIR}/flagship-b-fixture-approval-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT_DIR}/flagship-b-fixture-approval-390.png`, fullPage: true })

    const bodyText = await page.locator("body").innerText()
    expect(bodyText).not.toMatch(/[{[]\s*"[a-zA-Z]+"\s*:/)
  })
})
