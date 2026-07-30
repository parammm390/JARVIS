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

import type { ContextChip, Thread } from "../kernel/store"
import { initialMachineState, transition } from "../kernel/machine"
import type { InstructionState } from "../kernel/types"

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
// ThreadApprovalCockpit's header text (below) is a golden-journey literal
// ("N customers will be texted", §6⑤) that does not generalize to these two
// action types — neither texts anyone. Left unchanged here per this
// session's own strict task ordering (P5.T3 owns generalizing the BlastRadius
// header); this fixture's own node count/total are still real and correct.
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
  execution: baseThread({ machine: stateFor("executing"), nodes: goldenNodes(), everExecuted: true }),
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

export const FIXTURE_STATE_KEYS = Object.keys(THREAD_FIXTURES)
