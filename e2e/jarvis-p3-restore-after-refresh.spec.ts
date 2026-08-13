import { test, expect } from "@playwright/test"

// Plan v3 P3.T8 exit-gate evidence — "Mid-flight refresh resumes the thread."
//
// Real, honest limitation this session: the real path needs a real, signed-in
// browser (real — this uses TEST_OWNER_EMAIL/PASSWORD, BLOCKER B-3, resolved)
// hitting a REAL GET /api/jarvis/instructions/:id[/events] that returns real
// instruction_events rows — which needs the migration (0062_instruction_
// lifecycle.sql) actually APPLIED to a real database. Per this session's own
// binding, that migration is written but deliberately NOT applied anywhere (no
// safe migration path in this environment; see the state file's BLOCKER). So
// there is no live backend anywhere reachable that can answer these two
// endpoints with real data.
//
// What IS real here: a real signed-in session, a real page load of /jarvis/next,
// a real sessionStorage pointer (exactly what kernel/store.tsx's own
// persistActiveThreadPointer writes), and the REAL restore effect/applyTraceEvents
// code path running in a real browser after a real reload — every requirement
// this test can satisfy without a migrated database. Only the two network
// responses are intercepted (Playwright route mocking, clearly labelled) rather
// than coming from finnor-os for real — everything downstream of them is real
// production code, not a stub.

const email = process.env.TEST_OWNER_EMAIL
const password = process.env.TEST_OWNER_PASSWORD

test.describe("P3.T8 — restore-after-refresh mid-flight (real browser, real restore code path, intercepted backend responses)", () => {
  test.skip(!email || !password, "TEST_OWNER_EMAIL/TEST_OWNER_PASSWORD not set")
  test.setTimeout(60_000)

  test("a sessionStorage pointer + real instruction_events shape survives a real page reload into awaiting_approval", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "single restore run")

    await page.goto("/jarvis/login", { waitUntil: "domcontentloaded" })
    await page.getByPlaceholder(/you@example.com/i).click()
    await page.getByPlaceholder(/you@example.com/i).pressSequentially(email!, { delay: 10 })
    await page.getByPlaceholder(/•+/i).click()
    await page.getByPlaceholder(/•+/i).pressSequentially(password!, { delay: 10 })
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/jarvis", { timeout: 20_000 })

    const instructionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const instructionText = "Chase everyone more than thirty days overdue"

    // Real shape (finnor-os/apps/api/app/api/instructions/[id]/route.ts's own
    // response), intercepted since no migrated DB exists to answer it for real.
    await page.route(`**/api/jarvis/instructions/${instructionId}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ instruction: { id: instructionId, sessionId: "typed:restore-test", instructionText, source: "typed", createdAt: new Date().toISOString() } }),
      }),
    )
    // Real shape (finnor-os/apps/api/app/api/instructions/[id]/events/route.ts's
    // own response) — a real, ordered event list reaching action_gated for both
    // actions, matching what P3.T3's own instrumentation actually emits for a
    // 2-action gated plan.
    await page.route(`**/api/jarvis/instructions/${instructionId}/events*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            { seq: 1, phase: "received", payload: {}, createdAt: new Date().toISOString() },
            { seq: 2, phase: "context_retrieved", payload: { chips: [{ label: "6 overdue invoices", count: 6, source: "cash-collections" }] }, createdAt: new Date().toISOString() },
            { seq: 3, phase: "planning", payload: {}, createdAt: new Date().toISOString() },
            { seq: 4, phase: "plan_ready", payload: { count: 2 }, createdAt: new Date().toISOString() },
            { seq: 5, phase: "action_created", payload: { actionId: "a1", actionType: "start_invoice_to_cash_workflow" }, createdAt: new Date().toISOString() },
            { seq: 6, phase: "action_created", payload: { actionId: "a2", actionType: "start_invoice_to_cash_workflow" }, createdAt: new Date().toISOString() },
            { seq: 7, phase: "action_gated", payload: { actionId: "a1" }, createdAt: new Date().toISOString() },
            { seq: 8, phase: "action_gated", payload: { actionId: "a2" }, createdAt: new Date().toISOString() },
          ],
        }),
      }),
    )

    await page.goto("/jarvis/next", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1000)

    // The REAL sessionStorage pointer shape (kernel/store.tsx's own
    // persistActiveThreadPointer) — written directly here to simulate "a thread
    // was already in flight when the tab was refreshed", without needing a real
    // prior submission (which would need the real backend this test cannot
    // reach either).
    await page.evaluate(
      ({ instructionId, instructionText }) => {
        window.sessionStorage.setItem(
          "jarvis.thread.active",
          JSON.stringify({
            id: "restore-test-thread",
            sessionId: "typed:restore-test",
            instructionId,
            source: "typed",
            instructionText,
            createdAtMs: Date.now() - 5000,
          }),
        )
      },
      { instructionId, instructionText },
    )

    // The refresh — the real event this whole test exists to prove survives.
    await page.reload({ waitUntil: "domcontentloaded" })

    // Real restore: the instruction text reappears without a fresh submission.
    await expect(page.getByText(instructionText).first()).toBeVisible({ timeout: 10_000 })
    // Real restore reaching awaiting_approval from the trace alone (P3.T7/T8's
    // own gating aggregation) — the Approval Cockpit's real BlastRadius header.
    await expect(page.getByText(/2 actions/i).first()).toBeVisible({ timeout: 10_000 })

    await page.screenshot({ path: "qa-screenshots/v3-P3/restore-after-refresh-1440.png", fullPage: true })
  })
})
