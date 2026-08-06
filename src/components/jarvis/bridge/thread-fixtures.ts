// P2 exit-gate evidence — a labelled debug-harness fixture path (plan v3 §0.2
// rule 3: fixtures are legal in test/QA contexts with a visible FIXTURE label;
// BLOCKERS B-3/B-4 record why this session has no path to a real authenticated
// session against the live tenant — no local DB, no TEST_OWNER_* credentials,
// and JARVIS_SERVICE_EMAIL/PASSWORD deliberately not repurposed for interactive
// testing, see the state file). Every number here matches the plan's own §6
// golden-journey scenario verbatim (6 invoices, $4,200, Henderson $890) — not
// invented, transcribed from the plan text this session is executing.
//
// Only reachable via ThreadBridge.tsx's dev-only `?fixture=` query param, itself
// gated on `process.env.NODE_ENV !== "production"` — this can never appear in a
// production build regardless of the query string.

import type { ContextChip, Thread, ThreadNode } from "../kernel/store"
import { initialMachineState, transition } from "../kernel/machine"
import type { InstructionState } from "../kernel/types"
import { UNRESOLVED_REFERENCE_MESSAGE, UNRESOLVED_REFERENCE_CONTEXT } from "../kernel/followup-reference"

const INSTRUCTION_TEXT = "Chase everyone more than thirty days overdue"

const GOLDEN_HOUSEHOLDS = [
  { label: "Henderson · Cedar Creek Rd", amount: 890 },
  { label: "Alvarez · Birchwood Ln", amount: 620 },
  { label: "Petersons · Maple Ridge Rd", amount: 540 },
  { label: "Ortiz · Spring Hollow Ct", amount: 710 },
  { label: "Webb · 4821 Cedar Creek Rd", amount: 830 },
  { label: "Dana Alvarez · 12 Birchwood Ln", amount: 610 },
]

function goldenNodes() {
  return GOLDEN_HOUSEHOLDS.map((h, i) => ({
    id: `fixture-node-${i}`,
    actionType: "start_invoice_to_cash_workflow",
    amountUsd: h.amount,
    targetLabel: h.label,
    policyId: "fixture-policy-invoice-to-cash",
    policyVersion: 3,
    groundedPayload: [
      { field: "invoiceId", status: "verified" as const },
      { field: "householdId", status: "verified" as const },
    ],
    payload: { invoiceId: `fixture-invoice-${i}`, channel: "sms" },
    reasoning: "Overdue invoice, more than 30 days past due",
  }))
}

function stateFor(target: InstructionState) {
  const order: InstructionState[] = ["idle", "captured", "understanding", "planning", "awaiting_approval", "executing", "verifying", "completed"]
  let m = initialMachineState
  const idx = order.indexOf(target)
  const path = order.slice(1, idx + 1)
  for (const step of path) {
    if (step === "captured") m = transition(m, { type: "SUBMITTED" })
    else if (step === "understanding") m = transition(m, { type: "ACK" })
    else if (step === "planning") m = transition(m, { type: "TRACE_planning" })
    else if (step === "awaiting_approval") m = transition(m, { type: "ACTION_pending", count: GOLDEN_HOUSEHOLDS.length })
    else if (step === "executing") m = transition(m, { type: "APPROVAL_DECIDED", approvedCount: GOLDEN_HOUSEHOLDS.length, rejectedCount: 0, totalDecided: GOLDEN_HOUSEHOLDS.length })
    else if (step === "verifying") m = transition(m, { type: "TRACE_verifying" })
    else if (step === "completed") m = transition(m, { type: "TERMINAL", ok: GOLDEN_HOUSEHOLDS.length, failed: 0, total: GOLDEN_HOUSEHOLDS.length })
  }
  return m
}

function baseThread(overrides: Partial<Thread>): Thread {
  return {
    id: "fixture-thread",
    sessionId: "fixture-session",
    instructionId: "fixture-instruction",
    source: "typed",
    instructionText: INSTRUCTION_TEXT,
    createdAtMs: 0,
    machine: initialMachineState,
    nodes: [],
    contextChips: [],
    traceGating: { expectedCount: null, resolvedActionIds: [], gatedActionIds: [] },
    clarification: null,
    submitError: null,
    approvalWatch: null,
    runWatch: null,
    terminalAtMs: null,
    everExecuted: false,
    receiptRefreshTick: 0,
    ...overrides,
  }
}

// jarvis-v3 P3.T7 evidence: the plan's own §6② illustrative chip examples,
// verbatim — legitimate HERE (a labelled FIXTURE, §0.2 rule 3) even though the
// REAL `context_retrieved` trace event (orchestration/src/index.ts) honestly
// carries different, thinner content (real memory-snapshot counts only — see
// that file's own P3.T3 comment on why "6 overdue invoices" isn't something
// `handleInstruction` actually has at that point). Two states satisfy the
// session's own screenshot requirement: mid-fill (2 of 4 chips have "arrived")
// and complete (all 4) — a real stand-in for M4 ContextGather's own streaming
// arrival, since a live timing-dependent mid-poll screenshot cannot be staged
// on demand.
const GOLDEN_CONTEXT_CHIPS: ContextChip[] = [
  { label: "6 overdue invoices", source: "cash-collections" },
  { label: "$4,200 outstanding", source: "invoices" },
  { label: "6 households", source: "households" },
  { label: "payment links: Stripe sandbox", source: "integrations" },
]

// jarvis-v3 P5.T1 — Flagship B's own two real action types, shaped exactly
// like the live plugins' real payloads (lead-to-water-test/index.ts's
// StartWaterTestWorkflowSchema, scheduling/index.ts's AssignTechSchema).
// ThreadApprovalCockpit's header is derived from each node's action type and
// payload, so neither of these actions inherits the golden journey's
// invoice/customer-texting language.
function flagshipBNodes() {
  return [
    {
      id: "fixture-node-water-test",
      actionType: "start_water_test_workflow",
      amountUsd: null,
      targetLabel: "The Hendersons",
      policyId: "fixture-policy-lead-to-water-test",
      policyVersion: 1,
      groundedPayload: [{ field: "householdId", status: "verified" as const }],
      payload: {
        householdId: "fixture-household-henderson",
        technicianId: "fixture-tech-priya",
        scheduledAt: "2026-08-05T15:00:00.000Z",
        phoneNumber: "+13195550142",
        confirmationMessage: "Your water test is scheduled for 2026-08-05. Reply or call if you need to reschedule.",
      },
      reasoning: "Instruction named a household and a time window",
    },
    {
      id: "fixture-node-assign-tech",
      actionType: "assign_technician_to_visit",
      amountUsd: null,
      targetLabel: "Priya Nair",
      policyId: "fixture-policy-scheduling",
      policyVersion: 1,
      groundedPayload: [{ field: "visitId", status: "verified" as const }],
      payload: { visitId: "48ea2724-a211-4e24-a9ba-aecdad3145f5", technicianName: "Priya Nair" },
      reasoning: "Nearest technician by drive time",
    },
  ]
}

function routeNode(id: string, date: string, technicianId: string, technicianName: string): ThreadNode {
  return {
    id,
    actionType: "route_suggestion",
    amountUsd: null,
    targetLabel: technicianName,
    policyId: "fixture-policy-route-suggestion",
    policyVersion: 1,
    groundedPayload: [{ field: "technicianId", status: "verified" }],
    payload: { technicianId, date },
    reasoning: "Review the technician's scheduled stops for the requested date",
  }
}

function schemaApprovalNodes(): ThreadNode[] {
  return [
    {
      id: "fixture-unreg-1",
      actionType: "test_unregistered_action_alpha",
      amountUsd: null,
      targetLabel: "Dana Alvarez",
      policyId: null,
      policyVersion: null,
      groundedPayload: [],
      payload: { customerName: "Dana Alvarez", amountUsd: 240, scheduledFor: "2026-08-10" },
      reasoning: "Fixture for a flat unregistered payload",
    },
    {
      id: "fixture-unreg-2",
      actionType: "test_unregistered_action_beta",
      amountUsd: null,
      targetLabel: "Ortiz · Spring Hollow Ct",
      policyId: null,
      policyVersion: null,
      groundedPayload: [],
      payload: { target: { householdId: "hh-9", label: "Ortiz · Spring Hollow Ct" }, note: "verify before sending" },
      reasoning: "Fixture for a nested-object unregistered payload",
    },
    {
      id: "fixture-unreg-3",
      actionType: "test_unregistered_action_gamma",
      amountUsd: null,
      targetLabel: null,
      policyId: null,
      policyVersion: null,
      groundedPayload: [],
      payload: { steps: ["check_inventory", "reserve_parts", "notify_technician"], urgent: true },
      reasoning: "Fixture for an array unregistered payload",
    },
    {
      id: "fixture-unreg-4",
      actionType: "test_unregistered_action_delta",
      amountUsd: null,
      targetLabel: null,
      policyId: null,
      policyVersion: null,
      groundedPayload: [],
      payload: { fieldOne: "a", fieldTwo: "b", fieldThree: "c", fieldFour: "d", fieldFive: "e", fieldSix: "f" },
      reasoning: "Fixture for a long unregistered payload",
    },
    {
      id: "fixture-unreg-5",
      actionType: "test_unregistered_action_epsilon",
      amountUsd: null,
      targetLabel: null,
      policyId: null,
      policyVersion: null,
      groundedPayload: [],
      payload: {},
      reasoning: "Fixture for an empty unregistered payload",
    },
  ]
}

export const THREAD_FIXTURES: Record<string, Thread> = {
  heard: baseThread({ machine: stateFor("captured") }),
  understood: baseThread({ machine: stateFor("understanding"), nodes: goldenNodes(), contextChips: GOLDEN_CONTEXT_CHIPS }),
  "understood-midfill": baseThread({ machine: stateFor("understanding"), contextChips: GOLDEN_CONTEXT_CHIPS.slice(0, 2) }),
  "understood-complete": baseThread({ machine: stateFor("understanding"), nodes: goldenNodes(), contextChips: GOLDEN_CONTEXT_CHIPS }),
  plan: baseThread({ machine: stateFor("planning"), nodes: goldenNodes(), contextChips: GOLDEN_CONTEXT_CHIPS }),
  clarify: baseThread({
    machine: (() => {
      let m = transition(initialMachineState, { type: "SUBMITTED" })
      m = transition(m, { type: "ACK" })
      m = transition(m, { type: "TRACE_planning" })
      m = transition(m, { type: "TRACE_clarification" })
      return m
    })(),
    instructionText: "Chase the Hendersons for their overdue invoice",
    nodes: goldenNodes(),
    clarification: {
      question: "Which Henderson household do you mean — the one on Cedar Creek Rd, or the one on Birchwood Ln?",
      missingFields: ["householdId"],
      context: "Two households share the last name \"Henderson\" in this tenant.",
    },
  }),
  approval: baseThread({ machine: stateFor("awaiting_approval"), nodes: goldenNodes() }),
  // jarvis-v3 P5.T4 — an awaiting_approval state with no baked-in nodes for
  // tests that intentionally exercise the scoped empty state.
  "empty-approval": baseThread({ machine: stateFor("awaiting_approval"), nodes: [] }),
  "schema-approval": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Review these unregistered action payloads",
    nodes: schemaApprovalNodes(),
  }),
  "route-approval": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Review Priya Nair's route for Wednesday",
    nodes: [routeNode("fixture-node-route", "2026-08-05", "fixture-tech-priya", "Priya Nair")],
  }),
  "route-empty-approval": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Review Dale Brooks' route for Thursday",
    nodes: [routeNode("fixture-node-route-empty", "2026-08-06", "fixture-tech-empty", "Dale Brooks")],
  }),
  // jarvis-v3 P5.T5 (V8) — the real, live outcome this session's own
  // e2e/jarvis-p5-followup-real.spec.ts found: a follow-up-shaped instruction
  // ("Actually, make that Thursday instead") with nothing in the real
  // response to resolve it against. Shaped exactly like what
  // kernel/store.tsx's own emptyPlanOutcome() produces (unit-tested directly
  // in kernel/apply-trace-events.test.ts) — this fixture renders the SAME
  // Thread/ThreadClarify component tree, not a separate mock.
  "unresolved-reference": baseThread({
    machine: (() => {
      let m = transition(initialMachineState, { type: "SUBMITTED" })
      m = transition(m, { type: "ACK" })
      m = transition(m, { type: "TRACE_planning" })
      m = transition(m, { type: "TRACE_clarification" })
      return m
    })(),
    instructionText: "Actually, make that Thursday instead",
    clarification: { question: UNRESOLVED_REFERENCE_MESSAGE, missingFields: ["instruction"], context: UNRESOLVED_REFERENCE_CONTEXT },
  }),
  execution: baseThread({ machine: stateFor("executing"), nodes: goldenNodes(), everExecuted: true }),
  verifying: baseThread({ machine: stateFor("verifying"), nodes: goldenNodes(), everExecuted: true }),
  receipt: baseThread({ machine: stateFor("completed"), nodes: goldenNodes(), terminalAtMs: Date.now(), everExecuted: true }),
  "flagship-b-approval": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Book a water test for the Hendersons this week and give it to whoever's closest",
    nodes: flagshipBNodes(),
  }),
  // jarvis-v3 P5.T3 — Flagship C's single-node blast shape. The real
  // recipient count lives on THIS node's own payload (bulk-notify/index.ts's
  // draft() attaches `targets` there) — ThreadApprovalCockpit's blast-radius
  // branch reads it from here, while ApprovalCockpit's own cards are driven
  // by the SEPARATE `actions/pending` interception each e2e spec supplies
  // (same two-source pattern flagship-b-approval already established). Two
  // states, not one, because the header's own count (thread.nodes) and the
  // cockpit's own card list (actions/pending) must agree on known-vs-unknown
  // within a single test — a shared node would desync one from the other.
  "flagship-c-approval-known": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Tell every customer on a softener plan that we're doing free hardness checks next month",
    nodes: [
      {
        id: "fixture-action-bulk-known",
        actionType: "bulk_notify_existing_customers",
        amountUsd: null,
        targetLabel: null,
        policyId: "fixture-policy-bulk-notify",
        policyVersion: 1,
        groundedPayload: [],
        payload: { channel: "sms", targets: Array.from({ length: 12 }, (_, i) => ({ householdId: `hh-${i}` })) },
        reasoning: "Instruction named a customer segment and an offer",
      },
    ],
  }),
  // jarvis-v3 P5.T8 — the ACTIVE (newest) thread on top of the stack;
  // THREAD_HISTORY_FIXTURES["stacked-approval"] (below) supplies the 3
  // collapsed older ones underneath it.
  "stacked-approval": baseThread({
    id: "fixture-history-active",
    machine: stateFor("awaiting_approval"),
    instructionText: "Chase everyone more than thirty days overdue",
    nodes: goldenNodes(),
  }),
  "flagship-c-approval-unknown": baseThread({
    machine: stateFor("awaiting_approval"),
    instructionText: "Tell every customer on a softener plan that we're doing free hardness checks next month",
    nodes: [
      {
        id: "fixture-action-bulk-unknown",
        actionType: "bulk_notify_existing_customers",
        amountUsd: null,
        targetLabel: null,
        policyId: "fixture-policy-bulk-notify",
        policyVersion: 1,
        groundedPayload: [],
        payload: { channel: "sms" },
        reasoning: "Instruction named a customer segment and an offer",
      },
    ],
  }),
}

// `rest` intentionally has no Thread object: it exercises the same at-rest
// ThreadBody branch used before an instruction exists, with the harness's
// visibly labelled selector fixture values.
export const FIXTURE_STATE_KEYS = ["rest", ...Object.keys(THREAD_FIXTURES)]

// jarvis-v3 P5.T8 — thread stacking. A parallel, opt-in map (most fixture
// keys have no history — an empty array, the honest default for a session
// with only one thread so far) so existing fixture screenshots from prior
// phases are byte-identical. Three real outcome shapes (done, a genuine
// empty plan, and a user cancellation) so `summarizeThreadOutcome`'s own
// real branches are all visible in one screenshot, not just asserted in the
// unit test.
function threeHistoryThreads(): Thread[] {
  return [
    baseThread({
      id: "fixture-history-done",
      instructionText: "Chase the Petersons for their overdue invoice",
      machine: stateFor("completed"),
      nodes: [goldenNodes()[2]!],
      terminalAtMs: 0,
      everExecuted: true,
    }),
    baseThread({
      id: "fixture-history-empty",
      instructionText: "Book a water test for the Alvarez household",
      machine: (() => {
        let m = transition(initialMachineState, { type: "SUBMITTED" })
        m = transition(m, { type: "ACK" })
        m = transition(m, { type: "TRACE_planning" })
        m = transition(m, { type: "PLAN_EMPTY" })
        return m
      })(),
      terminalAtMs: 0,
    }),
    baseThread({
      id: "fixture-history-cancelled",
      instructionText: "Send a follow-up message to the Ortiz household",
      // §4.4's own transition table: USER_CANCELLED is only valid from
      // `clarifying` | `awaiting_approval` — NOT from `captured` (verified
      // live while building this: the real machine correctly no-op'd an
      // earlier, wrong attempt at "captured -> USER_CANCELLED" rather than
      // silently accepting it, exactly as designed).
      machine: (() => {
        let m = transition(initialMachineState, { type: "SUBMITTED" })
        m = transition(m, { type: "ACK" })
        m = transition(m, { type: "TRACE_planning" })
        m = transition(m, { type: "ACTION_pending", count: 1 })
        m = transition(m, { type: "USER_CANCELLED" })
        return m
      })(),
      terminalAtMs: 0,
    }),
  ]
}

export const THREAD_HISTORY_FIXTURES: Record<string, Thread[]> = {
  "stacked-approval": threeHistoryThreads(),
  // Same 3 real outcome shapes, but on top of a TERMINAL active thread
  // (`receipt`) — no Approval Cockpit modal in the way, so the collapsed
  // rows are cleanly legible in a screenshot rather than dimmed under
  // depth-2's own real backdrop (§2.3 — correct behavior, just hard to read
  // in a static image).
  receipt: threeHistoryThreads(),
}
