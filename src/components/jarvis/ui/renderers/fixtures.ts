// D3.T1 — one representative fixture per action type, each shaped from the real zod
// schema in packages/domain-plugins/<plugin>/*.ts (read file-by-file, not guessed).
// Stage-only — never fed to a live context (registry.ts's live consumers always pass
// a real payload).
//
// Real bug found + fixed via this session's own Playwright/browser hydration check
// (same technique C2/D1 established): every timestamp here MUST be a fixed literal
// string, never `Date.now()`/`new Date()` computed at module scope. This module
// loads once server-side and once client-side, at two genuinely different wall-clock
// moments — a `Date.now()`-derived value baked in at each load produces two
// different literal strings, a real React hydration mismatch (reproduced: "Text
// content did not match" on SchedulingScene's booked-slot time), not a cosmetic one.

const FIXTURE_NOW = "2026-07-24T14:00:00.000Z" // fixed anchor, never Date.now()

export const ACTION_FIXTURES: Record<string, unknown> = {
  // water-test
  schedule_water_test: {
    address: "4821 Cedar Creek Rd, Cedar Falls, IA",
    contactName: "Marcus Webb",
    contactPhone: "+13195550142",
    requestedAt: "2026-07-25T10:00:00.000Z",
    notes: "Customer mentioned scale buildup on fixtures — bring hardness test kit.",
  },
  // maintenance-agreement
  renew_maintenance_agreement: {
    householdLabel: "The Petersons",
    contactPhone: "+13195550198",
    cadence: "annual",
    message: "Your annual maintenance visit is due — reply YES to confirm the usual time.",
  },
  // crm
  create_lead: { name: "Dana Alvarez", phone: "+13195550111", address: "12 Birchwood Ln", notes: "Found us via Google, asking about softener pricing" },
  update_lead_status: { phone: "+13195550111", status: "quoted" },
  log_interaction: { phone: "+13195550111", channel: "call", direction: "inbound", content: "Asked about install timeline, quoted 2-week lead time." },
  assign_lead_to_technician: { phone: "+13195550111", technicianName: "Ray Ortiz" },
  // inventory (flagship)
  check_stock_level: { sku: "RO-MEM-100", name: "100 GPD RO Membrane" },
  flag_reorder_needed: { sku: "SED-FILT-5M", name: "5-Micron Sediment Filter", quantity: 3, reorderThreshold: 8, reorderNeeded: true },
  log_stock_used_on_visit: { sku: "CARBON-BLK-10", name: "10\" Carbon Block Filter", quantity: 2, visitId: "6c8e0d2a-1f3b-4a11-9c2e-8b7d5f0a9c11" },
  // scheduling (flagship)
  assign_technician_to_visit: { visitId: "9b1f2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d", technicianName: "Ray Ortiz" },
  check_technician_availability: {
    technicianName: "Ray Ortiz",
    date: FIXTURE_NOW.slice(0, 10),
    workingHours: { start: "08:00", end: "17:00" },
    bookedThatDay: [
      { at: FIXTURE_NOW, type: "install", address: "12 Birchwood Ln" },
      { at: "2026-07-24T17:00:00.000Z", type: "water test", address: "4821 Cedar Creek Rd" },
    ],
    openForBooking: true,
  },
  reschedule_visit: { visitId: "9b1f2c3d-4e5f-4a6b-8c7d-1e2f3a4b5c6d", newTime: "2026-07-25T16:00:00.000Z", reason: "customer requested later slot" },
  // route-optimization (flagship)
  route_suggestion: { technicianId: "6c8e0d2a-1f3b-4a11-9c2e-8b7d5f0a9c11", date: FIXTURE_NOW.slice(0, 10) },
  // quotation (generate_quote flagship; others standard)
  generate_quote: { householdLabel: "The Websters", items: ["Whole-Home Softener", "RO Drinking System"] },
  size_equipment_for_household: { hardnessGpg: 14, ironPpm: 0.3, peopleInHousehold: 4, gallonsPerPersonPerDay: 75 },
  send_proposal: { proposalId: "3f4a5b6c-7d8e-4f90-a1b2-c3d4e5f60718", channel: "email", email: "webster@example.com" },
  // accounting
  create_invoice: { customerName: "The Websters", amountUsd: 1840, memo: "Whole-home softener + install", dueDate: "2026-08-07T00:00:00.000Z" },
  send_payment_reminder: { invoiceId: "1a2b3c4d-5e6f-4708-9091-a2b3c4d5e6f7", channel: "auto" },
  record_payment: { invoiceId: "1a2b3c4d-5e6f-4708-9091-a2b3c4d5e6f7" },
  call_overdue_invoices: {},
  // marketing
  summarize_ad_performance: { windowDays: 30 },
  launch_ad_campaign: { name: "Spring Softener Push", dailyBudgetUsd: 40, objective: "leads", targetZip: "50613" },
  create_review_request: { contactName: "The Petersons", phone: "+13195550198" },
  // customer-comm
  answer_customer_question: { question: "Does the softener need salt refills every month?" },
  send_customer_message: { phone: "+13195550111", message: "Your technician is on the way, ETA 20 minutes.", channel: "sms" },
  send_follow_up: { phone: "+13195550111", context: "3 days post-install check-in" },
  // water-domain-knowledge
  answer_water_question: { topic: "hardness" },
  // proposal-batch
  send_proposal_to_recent_installs: { windowDays: 30, limit: 10, offerNote: "Referral discount for recent installs" },
  // bulk-notify (flagship)
  bulk_notify_existing_customers: {
    offerScript: "Filter replacement season is here — 15% off this month.",
    channel: "sms",
    discountPercent: 15,
    minMonthsInactive: 6,
    maxMonthsInactive: 24,
    targets: [
      { householdId: "h1", label: "The Petersons", phone: "+13195550198" },
      { householdId: "h2", label: "The Websters", phone: "+13195550111" },
      { householdId: "h3", label: "Dana Alvarez", phone: "+13195550122" },
    ],
  },
  // technician-reports
  log_visit_report: { report: "Replaced sediment filter, tested hardness at 12gpg, all good.", markCompleted: true },
  flag_visit_issue: { issue: "Customer's shutoff valve is corroded — needs replacement before next visit." },
  // service-reminders
  check_reminder_due: { equipmentType: "sediment_filter", lastServicedAt: "2026-01-05T00:00:00.000Z" },
  // compliance-documentation
  generate_compliance_summary: { householdLabel: "The Websters", waterProfile: { hardness_gpg: 14, pfoa_ppt: 2.1, fluoride_mg_l: 0.6 } },
  // web-research
  search_web: { query: "water softener install cost Cedar Falls Iowa", numResults: 5 },
  scan_competitors: { area: "Cedar Falls Iowa", focus: "pricing" },
  check_business_reviews: { businessName: "Finnor Water Systems", area: "Cedar Falls Iowa" },
  // ops-overview
  get_business_overview: { focus: "pending" },
  answer_business_question: { question: "How many invoices are overdue this month?" },
  // lead-to-water-test (flagship)
  start_water_test_workflow: {
    householdId: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70",
    scheduledAt: "2026-07-26T10:00:00.000Z",
    phoneNumber: "+13195550111",
    confirmationMessage: "Hi Dana, confirming your free water test tomorrow at 2pm — reply STOP to opt out.",
  },
  // proposal-signature
  request_proposal_signature: { proposalId: "3f4a5b6c-7d8e-4f90-a1b2-c3d4e5f60718", signerName: "The Websters", signerEmail: "webster@example.com" },
  // proposal-to-installation
  start_installation_workflow: {
    quoteId: "3f4a5b6c-7d8e-4f90-a1b2-c3d4e5f60718",
    householdId: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70",
    sku: "SOFT-48K-PRO",
    quantity: 1,
    depositAmountUsd: 350,
  },
  // invoice-to-cash (flagship)
  start_invoice_to_cash_workflow: { invoiceId: "1a2b3c4d-5e6f-4708-9091-a2b3c4d5e6f7", channel: "sms" },
  // clarification (P2.T8) — shape matches ClarificationRequestSchema exactly
  // (packages/domain-plugins/clarification/index.ts).
  clarification_request: {
    question: "Which Henderson household do you mean — the one on Cedar Creek Rd, or the one on Birchwood Ln?",
    missingFields: ["householdId"],
    context: "Two households share the last name \"Henderson\" in this tenant.",
  },
  // universal-actions — canonical references only, never raw tenant/endpoint data.
  send_message: { recipient: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, channel: "internal", body: "Please review the service exception before noon." },
  place_call: { recipient: { partyType: "household", partyId: "22222222-2222-4222-8222-222222222222" }, objective: "Confirm tomorrow's installation window", script: "Calling to confirm your installation window tomorrow." },
  request_acknowledgement: { recipient: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, request: "Acknowledge the dispatch handoff", deadline: "2026-07-25T18:00:00.000Z" },
  notify_group: { teamRef: { partyType: "team", partyId: "33333333-3333-4333-8333-333333333333" }, channel: "internal", body: "Storm routing plan is ready for review." },
  create_task: { subjectRef: { entityType: "work", entityId: "44444444-4444-4444-8444-444444444444" }, title: "Verify replacement valve stock", priority: "high" },
  assign_task: { taskRef: { taskId: "55555555-5555-4555-8555-555555555555" }, assigneeRef: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" } },
  update_task: { taskRef: { taskId: "55555555-5555-4555-8555-555555555555" }, status: "done" },
  handoff_work: { workRef: { workId: "44444444-4444-4444-8444-444444444444" }, targetEmployeeRef: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, note: "Dispatcher owns the next step." },
  delegate_objective: { workRef: { workId: "44444444-4444-4444-8444-444444444444" }, targetRef: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, objective: "Resolve the service exception", acknowledgementDeadline: "2026-07-25T18:00:00.000Z", completionDeadline: "2026-07-26T18:00:00.000Z" },
  escalate_work: { delegationRef: { delegationId: "66666666-6666-4666-8666-666666666666" }, targetRef: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, reason: "Acknowledgement deadline passed", evidenceRefs: [] },
  cancel_delegation: { delegationRef: { delegationId: "66666666-6666-4666-8666-666666666666" }, reason: "Customer rescheduled the underlying work" },
  schedule_internal_event: { title: "Dispatch review", startsAt: "2026-07-25T14:00:00.000Z", endsAt: "2026-07-25T14:30:00.000Z", participants: [{ partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }] },
  reschedule_internal_event: { internalEventRef: { internalEventId: "77777777-7777-4777-8777-777777777777" }, startsAt: "2026-07-25T15:00:00.000Z", endsAt: "2026-07-25T15:30:00.000Z", reason: "Field call ran long" },
  share_document: { documentRef: { documentId: "88888888-8888-4888-8888-888888888888" }, recipient: { partyType: "employee", partyId: "11111111-1111-4111-8111-111111111111" }, accessLevel: "view" },
  // manual-step — an explicit, non-side-effecting operator handoff.
  manual_step_suggestion: {
    originalActionType: "send_customer_message",
    originalPayload: { householdId: "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70" },
    unavailableCapabilities: ["communications"],
    reason: "The communications provider is not configured.",
  },
  // computer-task — read-only representative payload; the governed auth-profile
  // reference is intentionally not credential material.
  computer_task: {
    application: "supplier_portal",
    authProfileRef: "supplier-west",
    task: "Find the confirmed ETA for supplier order WS-48.",
    target: { kind: "supplier_order", identifier: "WS-48" },
    mode: "READ_ONLY",
    successCriteria: ["A confirmed ETA is visible for WS-48"],
  },
}

/** Not an action type (see VoiceCallScene.tsx's header) — a `calls` table row
 *  fixture, kept alongside the generated action fixtures for the Stage's flagship section. */
export const CALL_FIXTURE = {
  direction: "inbound" as const,
  fromNumber: "+13195550187",
  toNumber: "+18885550100",
  transcript: "Agent: Thanks for calling Finnor, how can I help?\nCaller: My water heater's making a rattling noise, wondering if that's related to hardness.\nAgent: That's a common sign of scale buildup — I can get a free water test scheduled this week.",
  recordingUrl: null,
  startedAt: "2026-07-24T13:55:00.000Z",
  endedAt: "2026-07-24T13:57:00.000Z",
  endedReason: "customer-ended-call",
}
