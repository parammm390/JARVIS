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
}

export const FIXTURE_STATE_KEYS = Object.keys(THREAD_FIXTURES)
