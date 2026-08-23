import { expect, test } from "@playwright/test"

// Deterministic browser contract for the production component tree. Authentication
// and API responses are explicitly intercepted fixtures; this proves rendering,
// redaction, graph layout, and responsive behavior, not a live provider journey.
const WORK_ID = "11111111-1111-4111-8111-111111111111"
const ACTION_TASK = "22222222-2222-4222-8222-222222222221"
const ACTION_COMPUTER = "22222222-2222-4222-8222-222222222222"
const ACTOR_ID = "33333333-3333-4333-8333-333333333333"
const NOW = "2026-08-23T00:00:00.000Z"

const actor = { employeeId: ACTOR_ID, displayName: "Avery Owner", role: "owner", sourceRef: `users:${ACTOR_ID}` }
const target = { entityType: "supplier_order", entityId: "WS-48", label: "Supplier order WS-48", status: "open", sourceRef: `domain_actions:${ACTION_COMPUTER}.payload` }
const authority = { state: "allowed", decisionId: "44444444-4444-4444-8444-444444444444", revision: 7, operation: "execution", outcome: "allowed", risk: "medium", reasonCode: "grant_allows", employeeId: ACTOR_ID, sourceRef: "authority_decisions:fixture" }
const approval = { required: false, status: "not_required", requestId: null, currentStep: null, totalSteps: 0, decidedBy: null, decidedAt: null, consequence: "Fixture consequence", sourceRef: null }
const timestamps = { createdAt: NOW, executionStartedAt: NOW, lastChangedAt: NOW }

const execution = {
  version: 1,
  work: { id: WORK_ID, status: "executing", objective: "Confirm supplier ETA and preserve the governed evidence trail", createdAt: NOW, updatedAt: NOW, finalOutcome: null, failure: null },
  targets: [target],
  nodes: [
    {
      id: ACTION_TASK, planId: null, actionType: "create_task", businessVerb: "Create Task", summary: "Verify replacement valve stock", sourceStatus: "completed", status: "succeeded",
      semanticPayload: { subjectRef: { entityType: "work", entityId: WORK_ID }, title: "Verify replacement valve stock", priority: "high" },
      targets: [{ entityType: "work", entityId: WORK_ID, label: "Supplier ETA Work", status: "executing", sourceRef: `domain_actions:${ACTION_TASK}.payload` }], dependencyIds: [], dependentIds: [], blockedBy: [], actor,
      route: { application: "FINNOR", provider: null, identity: null, route: "native", source: "persisted_execution", sourceRef: "workflow_steps:fixture-task" }, authority, approval,
      intent: { expectedResult: { status: "created" }, source: "receipt" }, observation: { actualResult: { status: "created", taskId: "task-48" }, evidence: [{ source: "decision_receipt", ref: "receipt-task-48", timestamp: NOW, restricted: false }], verification: "verified", basis: "A finalized canonical receipt contains the observed actual result." },
      externalEffect: "confirmed", failure: null, workflowRunIds: [], receiptIds: ["receipt-task-48"], computer: null, controls: [], timestamps, sourceRefs: [`domain_actions:${ACTION_TASK}`],
    },
    {
      id: ACTION_COMPUTER, planId: null, actionType: "computer_task", businessVerb: "Computer Task", summary: "Observe supplier order ETA", sourceStatus: "executing", status: "executing",
      semanticPayload: { application: "supplier_portal", task: "Find the confirmed ETA for supplier order WS-48.", target: { kind: "supplier_order", identifier: "WS-48" }, mode: "READ_ONLY", successCriteria: ["A confirmed ETA is visible for WS-48"] },
      targets: [target], dependencyIds: [], dependentIds: [], blockedBy: [], actor,
      route: { application: "supplier_portal", provider: "steel", identity: { kind: "application_account", id: "55555555-5555-4555-8555-555555555555", label: "Supplier West", channel: null }, route: "computer", source: "persisted_execution", sourceRef: "computer_runs:fixture" }, authority, approval,
      intent: { expectedResult: { eta: "observed" }, source: "prediction" }, observation: { actualResult: null, evidence: [{ source: "computer_run", ref: "computer-run-48", timestamp: NOW, restricted: false }], verification: "awaiting_observation", basis: "The persisted computer run is running." },
      externalEffect: "pending", failure: null, workflowRunIds: [], receiptIds: [], controls: [{ kind: "cancel", label: "Cancel computer task", endpoint: "/api/computer/runs/fixture/cancel", method: "POST", expectedVersion: null, reason: "The worker stops before its next primitive." }], timestamps,
      computer: { id: "computer-run-48", status: "running", effectStatus: "pending", mode: "READ_ONLY", application: "supplier_portal", provider: "steel", account: { id: "55555555-5555-4555-8555-555555555555", label: "Supplier West" }, actor, task: "Find the confirmed ETA for supplier order WS-48.", target: { kind: "supplier_order", identifier: "WS-48" }, currentActivity: "Reading confirmed ETA", steps: [{ id: "step-1", seq: 1, phase: "running", operation: "observe", status: "succeeded", summary: "Opened supplier order WS-48", createdAt: NOW, completedAt: NOW }, { id: "step-2", seq: 2, phase: "running", operation: "observe", status: "started", summary: "Reading confirmed ETA", createdAt: NOW, completedAt: null }], stepCount: 2, stepsTruncated: false, result: null, failureCode: null, blockReason: null, cancellationRequested: false, createdAt: NOW, startedAt: NOW, finishedAt: null, sourceRef: "computer_runs:fixture" },
      sourceRefs: [`domain_actions:${ACTION_COMPUTER}`],
    },
  ],
  edges: [],
  workflows: [{ id: "66666666-6666-4666-8666-666666666666", workflowType: "lead_to_water_test", status: "completed", version: 2, actionIds: [ACTION_TASK], steps: [{ id: "77777777-7777-4777-8777-777777777777", sequence: 0, stepType: "hold_appointment", status: "completed", attempts: 1, terminalReason: null, domainActionId: ACTION_TASK, integration: { capability: "hold_appointment", provider: "native", status: "succeeded", sourceRef: "integration_operations:fixture" }, reconciliation: null, compensation: null, controls: [{ kind: "compensate", label: "Compensate", endpoint: "/api/workflows/steps/fixture/compensate", method: "POST", expectedVersion: null, reason: "A typed compensation binding exists." }], updatedAt: NOW, sourceRef: "workflow_steps:fixture" }], controls: [], createdAt: NOW, updatedAt: NOW, sourceRef: "workflow_runs:fixture" }],
  receipts: [{ id: "receipt-task-48", workId: WORK_ID, domainActionId: ACTION_TASK, workflowRunId: null, workflowStepId: null, objective: "Verify replacement valve stock", policyApplied: null, riskTier: "medium", approval: { required: false, approvedBy: null, at: null }, expectedResult: { status: "created" }, actualResult: { status: "created", taskId: "task-48" }, evidence: [{ source: "decision_receipt", ref: "receipt-task-48", timestamp: NOW, restricted: false }], failure: null, finalizedAt: NOW, createdAt: NOW, sourceRef: "decision_receipts:receipt-task-48" }],
  viewer: { role: "owner", evidenceVisibility: "full" }, limits: { actions: 200, workflowSteps: 500, computerStepsPerRun: 40, evidencePerReceipt: 20 }, truncated: { actions: false, workflowSteps: false, computerSteps: false, evidence: false }, asOf: NOW,
}

const replay = {
  version: 1,
  mode: "read_only",
  work: { id: WORK_ID, status: "executing", objective: execution.work.objective, createdAt: NOW, updatedAt: NOW },
  nodes: [
    { id: `trigger:${WORK_ID}`, stage: "trigger", title: "Work received", summary: "The owner asked FINNOR to confirm the supplier ETA.", status: "recorded", occurredAt: "2026-08-23T00:00:00.000Z", sourceRefs: [`works:${WORK_ID}`], evidence: [{ source: "work_input", ref: `work:${WORK_ID}`, recordedAt: NOW, availability: "available", integrityHash: "a".repeat(64) }], facts: { channel: "text" }, entityRefs: [{ entityType: "supplier_order", entityId: "WS-48" }] },
    { id: `decision-context:${WORK_ID}`, stage: "context", title: "Decision-time operating context", summary: "Immutable context captured before planning with authority revision 7.", status: "complete", occurredAt: "2026-08-23T00:00:01.000Z", sourceRefs: [`work_planner_attempts:${WORK_ID}`], evidence: [{ source: "decision_context_snapshot", ref: `planner:${WORK_ID}`, recordedAt: NOW, availability: "available", integrityHash: "b".repeat(64) }], facts: { authorityRevision: 7, entities: [{ entityType: "supplier_order", entityId: "WS-48", status: "open" }] }, entityRefs: [{ entityType: "supplier_order", entityId: "WS-48" }] },
    { id: `authority:${WORK_ID}`, stage: "authority", title: "Execution authority allowed", summary: "Authority revision 7 allowed this medium-risk operation.", status: "allowed", occurredAt: "2026-08-23T00:00:02.000Z", sourceRefs: ["authority_decisions:fixture"], evidence: [{ source: "authority_decision", ref: authority.decisionId, recordedAt: NOW, availability: "restricted", integrityHash: null }], facts: { revision: 7, reasonCode: "grant_allows" }, entityRefs: [] },
    { id: `provider:${ACTION_COMPUTER}`, stage: "provider", title: "Supplier portal observation started", summary: "The governed read-only computer task opened order WS-48.", status: "running", occurredAt: "2026-08-23T00:00:03.000Z", sourceRefs: ["computer_runs:fixture"], evidence: [{ source: "computer_run", ref: "computer-run-48", recordedAt: NOW, availability: "available", integrityHash: null }], facts: { provider: "steel", mode: "READ_ONLY" }, entityRefs: [{ entityType: "supplier_order", entityId: "WS-48" }] },
    { id: `change:${ACTION_COMPUTER}`, stage: "canonical_change", title: "Supplier order ETA observed", summary: "An exact business-event correlation recorded the observed ETA.", status: "recorded", occurredAt: "2026-08-23T00:00:04.000Z", sourceRefs: ["business_events:fixture"], evidence: [{ source: "business_event", ref: "event-48", recordedAt: NOW, availability: "available", integrityHash: null }], facts: { eta: "2026-08-26" }, entityRefs: [{ entityType: "supplier_order", entityId: "WS-48" }] },
    { id: `receipt:${ACTION_TASK}`, stage: "receipt", title: "Decision receipt finalized", summary: "The result was verified against the recorded expectation.", status: "finalized", occurredAt: "2026-08-23T00:00:05.000Z", sourceRefs: ["decision_receipts:receipt-task-48"], evidence: [{ source: "decision_receipt", ref: "receipt-task-48", recordedAt: NOW, availability: "available", integrityHash: "c".repeat(64) }], facts: { verification: "verified" }, entityRefs: [{ entityType: "supplier_order", entityId: "WS-48" }] },
  ],
  edges: [
    { id: "edge-trigger-context", from: `trigger:${WORK_ID}`, to: `decision-context:${WORK_ID}`, relation: "captured_context_for", certainty: "proven", evidenceRefs: [`works:${WORK_ID}`], explanation: "The immutable context snapshot belongs to this Work planner attempt." },
    { id: "edge-context-authority", from: `decision-context:${WORK_ID}`, to: `authority:${WORK_ID}`, relation: "governed_by", certainty: "proven", evidenceRefs: ["authority_decisions:fixture"], explanation: "The decision recorded authority revision 7." },
    { id: "edge-authority-provider", from: `authority:${WORK_ID}`, to: `provider:${ACTION_COMPUTER}`, relation: "authorized", certainty: "proven", evidenceRefs: ["computer_runs:fixture"], explanation: "The exact action ID links the authority decision to provider execution." },
    { id: "edge-provider-change", from: `provider:${ACTION_COMPUTER}`, to: `change:${ACTION_COMPUTER}`, relation: "observed", certainty: "proven", evidenceRefs: ["business_events:fixture"], explanation: "The business event carries the same durable action ID." },
    { id: "edge-change-receipt", from: `change:${ACTION_COMPUTER}`, to: `receipt:${ACTION_TASK}`, relation: "verified_by", certainty: "proven", evidenceRefs: ["decision_receipts:receipt-task-48"], explanation: "The finalized receipt retains the correlated outcome evidence." },
  ],
  moments: [
    { at: "2026-08-23T00:00:00.000Z", nodeIds: [`trigger:${WORK_ID}`], headline: "Work received", stage: "trigger" },
    { at: "2026-08-23T00:00:01.000Z", nodeIds: [`decision-context:${WORK_ID}`], headline: "Context captured", stage: "context" },
    { at: "2026-08-23T00:00:02.000Z", nodeIds: [`authority:${WORK_ID}`], headline: "Authority allowed", stage: "authority" },
    { at: "2026-08-23T00:00:03.000Z", nodeIds: [`provider:${ACTION_COMPUTER}`], headline: "Provider execution", stage: "provider" },
    { at: "2026-08-23T00:00:04.000Z", nodeIds: [`change:${ACTION_COMPUTER}`], headline: "Canonical change", stage: "canonical_change" },
    { at: "2026-08-23T00:00:05.000Z", nodeIds: [`receipt:${ACTION_TASK}`], headline: "Receipt finalized", stage: "receipt" },
  ],
  explanation: { trigger: "The owner requested a supplier ETA confirmation.", context: "FINNOR captured the selected supplier order and authority revision before planning.", plan: "The plan created a native task and a read-only computer observation.", governance: "Authority revision 7 allowed execution; no approval was required.", execution: "The supplier portal observation ran under the recorded application account.", verification: "A finalized receipt compared the expected and observed result.", outcome: "The exact business-event link records the observed ETA.", gaps: [] },
  completeness: { status: "complete", provenEdges: 5, missingEdges: 0, missing: [] },
  viewer: { role: "owner", evidenceVisibility: "full" },
  readOnlyGuarantee: { source: "durable_projection", method: "GET", mutationControlsIncluded: false, sideEffectsPossible: false },
  limits: { nodes: 1000, edges: 2000, actionEvents: 2000, computerArtifacts: 500 },
  truncated: { nodes: false, edges: false, actionEvents: false, computerArtifacts: false },
  asOf: "2026-08-23T00:00:06.000Z",
}

const workCase = {
  id: `work:${WORK_ID}`, root: { kind: "work", id: WORK_ID }, title: execution.work.objective, status: "Working", createdAt: NOW, updatedAt: NOW,
  source: { kind: "work", id: WORK_ID, channel: "text" }, instruction: { id: "instruction-48", text: execution.work.objective, source: "typed", createdAt: NOW, lastPhase: "executing" },
  durableWork: { id: WORK_ID, status: "executing", sessionId: null, channel: "text", activeContext: null, initiatedBy: ACTOR_ID, currentOwnerId: ACTOR_ID, assignedTo: ACTOR_ID, authorityContext: { role: "owner" }, finalOutcome: null, failure: null, recovery: null, handoffs: [] },
  actions: execution.nodes.map((node) => ({ id: node.id, actionType: node.actionType, status: node.sourceStatus, summary: node.summary, instructionId: "instruction-48", planId: node.planId, dependsOn: node.dependencyIds, payload: node.semanticPayload, createdAt: NOW, updatedAt: NOW })),
  approvals: [], workflows: [], receipts: [], linkedEntities: [{ entityType: target.entityType, entityId: target.entityId, via: "action.payload" }], businessEvents: [], calls: [], relatedActionIds: execution.nodes.map((node) => node.id), provenance: ["works", "domain_actions"],
}

test("Execution Theater renders durable facts, parallel branches, governed controls, and no secrets", async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    const user = { id: ACTOR_ID, aud: "authenticated", role: "authenticated", email: "fixture-owner@example.test", email_confirmed_at: NOW, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: NOW }
    if (route.request().url().includes("/token")) {
      await route.fulfill({ json: { access_token: "fixture-access-token", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture-refresh-token", user } })
      return
    }
    await route.fulfill({ json: user })
  })
  await page.route("**/api/jarvis/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/jarvis/me") { await route.fulfill({ json: { userId: ACTOR_ID, tenantId: "fixture-tenant", role: "owner" } }); return }
    if (url.pathname === "/api/jarvis/read-models/work-cases") { await route.fulfill({ json: { data: [workCase] } }); return }
    if (url.pathname === `/api/jarvis/works/${WORK_ID}/execution`) { await route.fulfill({ json: { execution } }); return }
    if (url.pathname === `/api/jarvis/works/${WORK_ID}/replay`) { await route.fulfill({ json: { replay } }); return }
    if (url.pathname === "/api/jarvis/business-world") { await route.fulfill({ json: { data: { version: 1, scene: "work", objects: [], relationships: [], truncated: false, limits: { objects: 200, relationships: 500 }, source: { kind: "canonical_postgres", tables: ["works"] }, asOf: NOW } } }); return }
    if (url.pathname === "/api/jarvis/operational-stream") { await route.fulfill({ contentType: "text/event-stream", body: "" }); return }
    if (url.pathname === "/api/jarvis/user-prefs") { await route.fulfill({ json: { prefs: { homepage: null, density: "comfortable", accent: null } } }); return }
    if (url.pathname === "/api/jarvis/receipts") { await route.fulfill({ json: { receipts: [] } }); return }
    if (url.pathname === "/api/jarvis/employees") { await route.fulfill({ json: { employees: [] } }); return }
    await route.fulfill({ json: {} })
  })

  await page.goto("/jarvis/login")
  await page.getByPlaceholder("you@example.com").fill("fixture-owner@example.test")
  await page.getByPlaceholder("••••••••").fill("fixture-password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("**/jarvis")
  await page.goto(`/jarvis/work?workCaseId=${WORK_ID}`)

  await expect(page.locator(".jarvis-execution-theater")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".jarvis-execution-node")).toHaveCount(2)
  // The compact mobile composition intentionally hides this helper label; the
  // two independent persisted nodes remain the semantic source of truth.
  await expect(page.getByText("2 independent branches")).toHaveCount(1)
  await expect(page.getByText("Supplier West").first()).toBeVisible()
  await expect(page.getByText("Avery Owner · Allowed").first()).toBeVisible()
  await expect(page.getByText("External effect: Pending")).toBeVisible()
  await expect(page.getByText("computer-run-48")).toBeVisible()
  await expect(page.getByRole("button", { name: "Cancel computer task" })).toBeVisible()
  await expect(page.getByLabel("Reason to compensate Hold Appointment")).toBeVisible()
  await expect(page.locator("body")).not.toContainText("fixture-access-token")
  await expect(page.locator("body")).not.toContainText("fixture-password")
  await expect(page.locator("body")).not.toContainText("authProfileRef")

  const timeMachine = page.locator(".jarvis-time-machine")
  await timeMachine.getByRole("button", { name: /Why did this happen/ }).click()
  await expect(timeMachine.locator(".jarvis-time-machine__body")).toBeVisible()
  await expect(timeMachine.getByText("Operational Time Machine · read only")).toBeVisible()
  await expect(timeMachine.getByText("no side effects")).toBeVisible()
  await expect(timeMachine.getByText("Moment 6 of 6")).toBeVisible()
  await expect(timeMachine.getByText("Decision receipt finalized").first()).toBeVisible()
  await timeMachine.getByRole("button", { name: "Governance" }).click()
  await expect(timeMachine.getByText("Execution authority allowed").first()).toBeVisible()
  await expect(timeMachine.getByText("Evidence restricted")).toBeVisible()
  await timeMachine.getByLabel("Replay moment").fill("1")
  await expect(timeMachine.getByText("Moment 2 of 6")).toBeVisible()
  await expect(timeMachine.getByText("Decision-time operating context").first()).toBeVisible()
  await expect(timeMachine.getByRole("button", { name: /Approve|Retry|Cancel|Compensate/i })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
