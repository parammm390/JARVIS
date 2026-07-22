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
}

/** Not an action type (see VoiceCallScene.tsx's header) — a `calls` table row
 *  fixture, kept alongside the other 41 for the Stage's flagship section. */
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
