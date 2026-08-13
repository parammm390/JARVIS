import { expect, test } from "@playwright/test"
import { mkdirSync } from "node:fs"

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD
const ACTION_ID = "fixture-upgrade-5-action"
const INSTRUCTION_ID = "fixture-upgrade-5-instruction"
const HOUSEHOLD_ID = "fixture-upgrade-5-household"
const VISIT_ID = "fixture-upgrade-5-visit"
const INVOICE_ID = "fixture-upgrade-5-invoice"
const NOW = "2026-08-12T08:00:00.000Z"

test.describe("Upgrade 5 — shared live business projections", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")

  test("one approved operation refreshes every relevant surface through one Work projection", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single authenticated browser journey")
    test.setTimeout(90_000)

    const browserErrors: string[] = []
    page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message))
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text())
    })

    let completed = false
    let workCaseRequests = 0
    let confirmRequests = 0
    const requestVolume: Record<string, number> = {}
    const today = new Date().toISOString().slice(0, 10)

    const action = () => ({
      id: ACTION_ID,
      actionType: "schedule_water_test",
      summary: "Schedule the Upgrade 5 projection water test.",
      payload: { householdId: HOUSEHOLD_ID, scheduledAt: `${today}T16:30:00.000Z`, phoneNumber: "+13195550199" },
      status: completed ? "confirmed" : "pending",
      instructionId: INSTRUCTION_ID,
      planId: null,
      dependsOn: [],
      createdAt: NOW,
      updatedAt: NOW,
      receipt: null,
      critic: null,
      priceBookProvenance: [],
      predicted: null,
    })

    const workCase = () => ({
      id: `instruction:${INSTRUCTION_ID}`,
      root: { kind: "instruction", id: INSTRUCTION_ID },
      title: completed ? "Upgrade 5 cross-surface operation completed" : "Upgrade 5 cross-surface operation awaiting approval",
      status: completed ? "Completed" : "Needs you",
      createdAt: NOW,
      updatedAt: NOW,
      source: { kind: "instruction", id: INSTRUCTION_ID, channel: "typed" },
      instruction: { id: INSTRUCTION_ID, text: "Schedule an Upgrade 5 water test", source: "typed", createdAt: NOW, lastPhase: completed ? "completed" : "action_gated" },
      actions: [action()],
      approvals: [{ actionId: ACTION_ID, status: completed ? "confirmed" : "pending", decidedBy: completed ? "fixture-owner" : null, decidedAt: completed ? NOW : null, pendingConfirmationId: "fixture-confirmation" }],
      workflows: [],
      receipts: completed ? [{ id: "fixture-upgrade-5-receipt", workflowRunId: null, workflowStepId: null, domainActionId: ACTION_ID, objective: "Schedule the water test", evidence: [{ kind: "service_visit", id: VISIT_ID }], approval: { status: "confirmed" }, expectedResult: { visitId: VISIT_ID }, actualResult: { visitId: VISIT_ID }, failure: null, correlationId: INSTRUCTION_ID, createdAt: NOW, finalizedAt: NOW }] : [],
      linkedEntities: [
        { entityType: "household", entityId: HOUSEHOLD_ID, via: "action.payload.householdId" },
        { entityType: "service_visit", entityId: VISIT_ID, via: "action.result.visitId" },
        { entityType: "invoice", entityId: INVOICE_ID, via: "fixture.crossSurface" },
      ],
      businessEvents: completed ? [{ id: "fixture-event", eventType: "service_visit_scheduled", entityType: "service_visit", entityId: VISIT_ID, occurredAt: NOW, payload: {} }] : [],
      calls: [],
      relatedActionIds: [ACTION_ID],
      provenance: [],
    })

    const household = {
      id: HOUSEHOLD_ID,
      tenantId: "fixture-tenant",
      address: "512 Projection Lane, Cedar Falls, IA",
      contactInfo: { name: "Projection Household" },
      waterProfile: {},
      marketingConsent: true,
      latitude: 42.52,
      longitude: -92.44,
      createdAt: NOW,
    }
    const household360 = () => ({
      household: { id: HOUSEHOLD_ID, address: household.address, contactInfo: household.contactInfo, marketingConsent: true, createdAt: NOW },
      contacts: [], equipment: [], leads: [], opportunities: [], quotes: [],
      invoices: completed ? [{ id: INVOICE_ID, status: "sent", amountUsd: 275, memo: "Upgrade 5 projection invoice", createdAt: NOW, dueDate: `${today}T00:00:00.000Z`, payments: [] }] : [],
      workOrders: [],
      serviceVisits: completed ? [{ id: VISIT_ID, type: "water_test", technicianId: null, scheduledAt: `${today}T16:30:00.000Z`, completedAt: null, notes: "Shared projection verification" }] : [],
      appointments: [], conversations: [], calls: [], documents: [], legacyCommunications: [],
      timeline: completed ? [{ entityType: "service_visit", entityId: VISIT_ID, eventType: "service_visit_scheduled", occurredAt: NOW, payload: {} }] : [],
      queryMs: 1,
    })

    await page.route("**/api/jarvis/**", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname}`
      requestVolume[key] = (requestVolume[key] ?? 0) + 1

      if (url.pathname === `/api/jarvis/actions/${ACTION_ID}/confirm`) {
        confirmRequests += 1
        completed = true
        await route.fulfill({ json: { action: action() } })
        return
      }
      if (url.pathname === "/api/jarvis/actions/pending") {
        await route.fulfill({ json: { actions: url.searchParams.get("filter") === "pending" && !completed ? [action()] : [] } })
        return
      }
      if (url.pathname === "/api/jarvis/read-models/work-cases") {
        workCaseRequests += 1
        await route.fulfill({ json: { data: [workCase()] } })
        return
      }
      if (url.pathname === "/api/jarvis/resources/households") {
        await route.fulfill({ json: { rows: completed ? [household] : [] } })
        return
      }
      if (url.pathname === "/api/jarvis/read-models/household-360") {
        await route.fulfill({ json: { data: household360() } })
        return
      }
      if (url.pathname === "/api/jarvis/resources/invoices") {
        await route.fulfill({ json: { rows: completed ? [{ id: INVOICE_ID, tenantId: "fixture-tenant", householdId: HOUSEHOLD_ID, amountUsd: 275, status: "sent", memo: "Upgrade 5 projection invoice", dueDate: `${today}T00:00:00.000Z`, createdAt: NOW }] : [] } })
        return
      }
      if (url.pathname === "/api/jarvis/dispatch/map") {
        await route.fulfill({ json: { date: url.searchParams.get("date"), synthetic: false, unplacedStops: 0, route: null, stops: completed ? [{ visitId: VISIT_ID, sourceKind: "service_visit", technicianId: null, technicianName: null, householdId: HOUSEHOLD_ID, address: household.address, latitude: 42.52, longitude: -92.44, type: "water_test", scheduledAt: `${today}T16:30:00.000Z`, notes: "Shared projection verification", optimized: null }] : [] } })
        return
      }
      if (url.pathname === "/api/jarvis/stats") { await route.fulfill({ json: { pending: completed ? 0 : 1, blocked: 0, recentActions: [] } }); return }
      if (url.pathname === "/api/jarvis/me") { await route.fulfill({ json: { userId: "fixture-owner", tenantId: "fixture-tenant", role: "owner" } }); return }
      if (url.pathname === "/api/jarvis/employees") { await route.fulfill({ json: { employees: [{ id: "fixture-owner", displayName: "Fixture Owner", status: "active", roles: ["owner"], legacyRole: "owner" }] } }); return }
      if (url.pathname === "/api/jarvis/user-prefs") { await route.fulfill({ json: { prefs: { homepage: null, density: "comfortable", accent: null } } }); return }
      if (url.pathname === "/api/jarvis/workflows/runs") { await route.fulfill({ json: { runs: [] } }); return }
      if (url.pathname === "/api/jarvis/events") { await route.fulfill({ json: { events: [] } }); return }
      if (url.pathname === "/api/jarvis/comms") { await route.fulfill({ json: { outbox: [], communications: [] } }); return }
      if (url.pathname === "/api/jarvis/activity") { await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false } }); return }
      if (url.pathname === "/api/jarvis/insights") { await route.fulfill({ json: { actionTypeStats: [], criticFindings: [], topConcerns: [] } }); return }
      if (url.pathname === "/api/jarvis/setup/status") { await route.fulfill({ json: { actionTypes: [] } }); return }
      if (url.pathname === "/api/jarvis/integrations/status") {
        const unavailable = { configured: false, healthy: null }
        await route.fulfill({ json: { meta_ads: unavailable, google_ads: unavailable, quickbooks: unavailable, vapi: unavailable, voiceAssistants: [], ghl: unavailable, stripe: unavailable, docusign: unavailable, bindings: { payments: "emulator", esign: "emulator" }, summary: { configuredCount: 0, healthyCount: 0, unhealthyCount: 0 } } })
        return
      }
      if (url.pathname === "/api/jarvis/receipts") { await route.fulfill({ json: { receipts: [] } }); return }
      if (url.pathname === "/api/jarvis/read-models/pipeline-health") { await route.fulfill({ json: { data: { leadsByStatus: [], quotesByStatus: [], proposalsByStatus: [] } } }); return }
      if (url.pathname === "/api/jarvis/read-models/cash-collections") { await route.fulfill({ json: { data: { invoicesByStatus: [], totalCollected: 0, paymentLinksAwaitingPayment: 0 } } }); return }
      if (url.pathname === "/api/jarvis/read-models/sla-breaches") { await route.fulfill({ json: { data: { stuckWorkflowRuns: 0, openReconciliationCases: 0 } } }); return }
      if (url.pathname === "/api/jarvis/read-models/stock-risk") { await route.fulfill({ json: { data: { belowThreshold: [], openProcurementOrders: 0 } } }); return }
      if (["follow-up-debt", "technician-load", "service-due"].some((name) => url.pathname === `/api/jarvis/read-models/${name}`)) { await route.fulfill({ json: { data: [] } }); return }
      if (url.pathname === "/api/jarvis/read-models/data-quality") { await route.fulfill({ json: { data: { byTypeAndSeverity: [], totalUnresolved: 0 } } }); return }
      if (url.pathname === "/api/jarvis/read-models/reliability") { await route.fulfill({ json: { data: { tenantId: "fixture-tenant", windowDays: 30, workflowSuccessRate: null, stepLatencyMs: { p50: null, p95: null, sampleSize: 0 }, retryRate: null, humanInterventionRate: null, reconciliationBacklog: 0, dlqDepth: 0, receiptCompleteness: null, asOf: NOW } } }); return }
      if (url.pathname.startsWith("/api/jarvis/read-models/")) { await route.fulfill({ json: { data: {} } }); return }
      if (url.pathname.startsWith("/api/jarvis/resources/")) { await route.fulfill({ json: { rows: [] } }); return }
      await route.continue()
    })

    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(750)
    await page.getByPlaceholder(/you@example.com/i).fill(email!)
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 15 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled()
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })
    await page.getByRole("link", { name: "Work", exact: true }).click()

    await expect(page.getByText("Upgrade 5 cross-surface operation awaiting approval").first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("button", { name: "Open approval controls" })).toBeVisible()
    await page.getByRole("button", { name: "Open approval controls" }).click()
    await page.getByLabel(/schedule water test/i).first().getByRole("button", { name: /^Approve$/ }).click()
    await expect(page.getByText("Upgrade 5 cross-surface operation completed").first()).toBeVisible({ timeout: 20_000 })
    expect(confirmRequests).toBe(1)
    expect(workCaseRequests).toBe(2)

    await page.getByLabel("Operational surfaces", { exact: true }).getByRole("link", { name: "Customers", exact: true }).click()
    await expect(page).toHaveURL(/\/jarvis\/customers/, { timeout: 20_000 })
    await expect(page.getByText("Projection Household").first()).toBeVisible()
    await page.getByLabel("Operational surfaces", { exact: true }).getByRole("link", { name: "Schedule", exact: true }).click()
    await expect(page).toHaveURL(/\/jarvis\/schedule/, { timeout: 20_000 })
    await expect(page.getByText(household.address).first()).toBeVisible()
    await page.getByLabel("Operational surfaces", { exact: true }).getByRole("link", { name: "Money", exact: true }).click()
    await expect(page).toHaveURL(/\/jarvis\/money/, { timeout: 20_000 })
    await expect(page.getByText("Upgrade 5 projection invoice").first()).toBeVisible()
    await page.getByLabel("Operational surfaces", { exact: true }).getByRole("link", { name: "Agents", exact: true }).click()
    await expect(page).toHaveURL(/\/jarvis\/agents/, { timeout: 20_000 })
    await page.getByRole("button", { name: /Water Quality/ }).click()
    await expect(page.getByText("Upgrade 5 cross-surface operation completed").first()).toBeVisible()

    expect(workCaseRequests).toBe(2)
    const metrics = await page.evaluate(() => (window as unknown as { __JARVIS_PROJECTION_METRICS__?: { invalidations: number; requestsCompleted: number; lastRefreshLatencyMs: number | null } }).__JARVIS_PROJECTION_METRICS__)
    expect(metrics?.invalidations).toBeGreaterThan(0)
    expect(metrics?.requestsCompleted).toBeGreaterThan(0)
    expect(metrics?.lastRefreshLatencyMs).not.toBeNull()
    expect(browserErrors, browserErrors.join("\n\n")).toEqual([])

    mkdirSync("evidence/upgrade5-live-projection", { recursive: true })
    await page.screenshot({ path: "evidence/upgrade5-live-projection/08-shared-agents-state.png", fullPage: true })
    await test.info().attach("upgrade-5-projection-evidence", {
      body: Buffer.from(JSON.stringify({ confirmRequests, workCaseRequests, requestVolume, metrics }, null, 2)),
      contentType: "application/json",
    })
  })
})
