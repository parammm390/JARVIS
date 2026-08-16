// Plan v3 P3.T7/T8 evidence: applyTraceEvents folds real instruction_events rows
// into a Thread — the logic that makes ② UNDERSTOOD's chips and ③ PLAN's nodes
// stream in as handleInstruction actually does the work, AND derives the
// aggregate awaiting_approval/executing transition from the trace alone (needed by
// T8's restore-after-refresh, which has no POST response to fall back on). Pure
// function over an explicit Thread + TraceEvent[] + approval-counters input (no
// DOM — same B-1 pattern as machine.ts/selectors.ts).

import { describe, expect, it } from "vitest"
import { applyTraceEvents, carryThreadContinuity, parseAnswerResult, parseSubmissionAnswer, traceEventMatchesInstructionId, type Thread } from "./store"
import { initialMachineState, transition } from "./machine"
import type { TraceEvent } from "./instruction"

const NO_DECISIONS = { approvalsThisSession: 0, rejectionsThisSession: 0 }

function baseThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    sessionId: "s1",
    instructionId: "i1",
    source: "typed",
    instructionText: "Chase everyone more than thirty days overdue",
    createdAtMs: 0,
    machine: transition(initialMachineState, { type: "SUBMITTED" }), // captured
    nodes: [],
    contextChips: [],
    traceGating: { expectedCount: null, resolvedActionIds: [], gatedActionIds: [], completedActionIds: [], failedActionIds: [] },
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

function ev(seq: number, phase: string, payload: Record<string, unknown> = {}): TraceEvent {
  return { seq, phase, payload, createdAt: new Date(seq).toISOString() }
}

function planningThread(overrides: Partial<Thread> = {}): Thread {
  let m = transition(transition(initialMachineState, { type: "SUBMITTED" }), { type: "ACK" })
  m = transition(m, { type: "TRACE_planning" })
  return baseThread({ machine: m, ...overrides })
}

describe("kernel/store — applyTraceEvents (P3.T7)", () => {
  it("'received' moves captured -> understanding (ACK), only from captured", () => {
    const t = applyTraceEvents(baseThread(), [ev(1, "received")], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("understanding")
  })

  it("'received' is a no-op once past captured (never regresses state)", () => {
    const understanding = baseThread({ machine: transition(transition(initialMachineState, { type: "SUBMITTED" }), { type: "ACK" }) })
    const t = applyTraceEvents(understanding, [ev(2, "received")], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("understanding")
  })

  it("'context_retrieved' appends real {label,source} chips, filtering malformed entries", () => {
    const t = applyTraceEvents(
      baseThread(),
      [ev(1, "context_retrieved", { chips: [{ label: "3 prior turns this session", source: "memory:short-term" }, { label: 42, source: "bad" }, "not-an-object"] })],
      NO_DECISIONS,
    )
    expect(t.contextChips).toEqual([{ label: "3 prior turns this session", source: "memory:short-term" }])
  })

  it("'context_retrieved' never duplicates an already-present chip (label+source key)", () => {
    const withChip = baseThread({ contextChips: [{ label: "recent business activity", source: "memory:episodic" }] })
    const t = applyTraceEvents(withChip, [ev(2, "context_retrieved", { chips: [{ label: "recent business activity", source: "memory:episodic" }] })], NO_DECISIONS)
    expect(t.contextChips).toHaveLength(1)
  })

  it("projects only genuine backend progress and verification events", () => {
    let t = applyTraceEvents(baseThread(), [ev(1, "step_progress", { stage: "resolving_context", sourceKind: "PROFILE" })], NO_DECISIONS)
    expect(t.progress).toEqual({ stage: "resolving_context", observedAt: new Date(1).toISOString() })

    t = applyTraceEvents(t, [ev(2, "step_progress", { stage: "querying_business", sourceKind: "CANONICAL" })], NO_DECISIONS)
    expect(t.progress).toMatchObject({ stage: "querying_business", sourceKind: "CANONICAL" })

    t = applyTraceEvents(t, [ev(3, "verified", { sourceKind: "CANONICAL" })], NO_DECISIONS)
    expect(t.progress).toMatchObject({ stage: "verified", sourceKind: "CANONICAL" })
  })

  it("'planning' moves understanding -> planning, only from understanding", () => {
    const understanding = baseThread({ machine: transition(transition(initialMachineState, { type: "SUBMITTED" }), { type: "ACK" }) })
    const t = applyTraceEvents(understanding, [ev(1, "planning")], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("planning")
  })

  it("'planning' is a no-op from captured (never skips understanding)", () => {
    const t = applyTraceEvents(baseThread(), [ev(1, "planning")], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("captured")
  })

  it("'clarification_required' moves planning -> clarifying and sets real question/missingFields/context", () => {
    const t = applyTraceEvents(
      planningThread(),
      [ev(1, "clarification_required", { question: "Which Henderson household?", missingFields: ["householdId"], context: "Two households share the name." })],
      NO_DECISIONS,
    )
    expect(t.machine.instructionState).toBe("clarifying")
    expect(t.clarification).toEqual({ question: "Which Henderson household?", missingFields: ["householdId"], context: "Two households share the name." })
  })

  it("'clarification_required' does not overwrite a clarification already set", () => {
    let m = transition(planningThread().machine, { type: "TRACE_clarification" })
    const clarifying = baseThread({ machine: m, clarification: { question: "original", missingFields: [], context: undefined } })
    const t = applyTraceEvents(clarifying, [ev(1, "clarification_required", { question: "different" })], NO_DECISIONS)
    expect(t.clarification?.question).toBe("original")
  })

  it("keeps real plan/context facts at the clarification edge but carries only context into the same-thread answer turn", () => {
    const node = { id: "a1", actionType: "prepare", amountUsd: null, targetLabel: null, policyId: null, policyVersion: null, groundedPayload: [], payload: {} }
    const existing = planningThread({ nodes: [node], contextChips: [{ label: "verified household", source: "memory:episodic" }] })
    const waiting = applyTraceEvents(existing, [ev(1, "clarification_required", { question: "Which household?", missingFields: ["householdId"] })], NO_DECISIONS)

    expect(waiting.machine.instructionState).toBe("clarifying")
    expect(waiting.nodes).toEqual([node])
    expect(waiting.contextChips).toEqual([{ label: "verified household", source: "memory:episodic" }])
    expect(carryThreadContinuity(waiting)).toEqual({ nodes: [], contextChips: [{ label: "verified household", source: "memory:episodic" }] })
    expect(carryThreadContinuity(null)).toEqual({ nodes: [], contextChips: [] })
  })

  it("'action_created' appends a thin node with id/actionType, no amount/target yet", () => {
    const t = applyTraceEvents(baseThread(), [ev(1, "action_created", { actionId: "a1", actionType: "start_invoice_to_cash_workflow" })], NO_DECISIONS)
    expect(t.nodes).toEqual([
      { id: "a1", actionType: "start_invoice_to_cash_workflow", amountUsd: null, targetLabel: null, policyId: null, policyVersion: null, groundedPayload: [], payload: {} },
    ])
  })

  it("'action_created' never appends the same actionId twice", () => {
    const withNode = baseThread({ nodes: [{ id: "a1", actionType: "start_invoice_to_cash_workflow", amountUsd: null, targetLabel: null, policyId: null, policyVersion: null, groundedPayload: [], payload: {} }] })
    const t = applyTraceEvents(withNode, [ev(2, "action_created", { actionId: "a1", actionType: "start_invoice_to_cash_workflow" })], NO_DECISIONS)
    expect(t.nodes).toHaveLength(1)
  })

  it("'action_created' retains dependency ids when the real trace payload supplies them", () => {
    const t = applyTraceEvents(
      baseThread({ nodes: [{ id: "a1", actionType: "prepare", amountUsd: null, targetLabel: null, policyId: null, policyVersion: null, groundedPayload: [], payload: {} }] }),
      [ev(2, "action_created", { actionId: "a2", actionType: "send_message", dependsOn: ["a1", "a1", 42] })],
      NO_DECISIONS,
    )
    expect(t.nodes[1]).toMatchObject({ id: "a2", dependsOn: ["a1"] })
  })

  it("'action_created' with a malformed payload (no actionId/actionType) is a real no-op — never fabricates a node", () => {
    const t = applyTraceEvents(baseThread(), [ev(1, "action_created", {})], NO_DECISIONS)
    expect(t.nodes).toHaveLength(0)
  })

  it("accepts the completed answer-result envelope defensively and keeps it out of execution", () => {
    let t = planningThread()
    t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 1 }), ev(2, "action_created", { actionId: "answer-1", actionType: "lookup_invoice_status" })], NO_DECISIONS)
    t = applyTraceEvents(
      t,
      [ev(3, "completed", { actionId: "answer-1", result: { kind: "answer", spokenSummary: "Invoice 42 is paid.", displaySummary: "Invoice 42 is paid.", facts: [{ label: "Status", value: "Paid", source: "invoice" }], evidence: [{ source: "invoice", ref: "invoice-42", kind: "CANONICAL" }] } })],
      NO_DECISIONS,
    )
    expect(t.answerResult).toEqual({
      kind: "answer",
      spokenSummary: "Invoice 42 is paid.",
      displaySummary: "Invoice 42 is paid.",
      facts: [{ label: "Status", value: "Paid", source: "invoice" }],
      evidence: [{ source: "invoice", ref: "invoice-42", kind: "CANONICAL" }],
    })
    expect(t.machine.instructionState).toBe("completed")
    expect(t.everExecuted).toBe(false)
    expect(t.approvalWatch).toBeNull()
    expect(parseAnswerResult({ result: { kind: "answer", spokenSummary: "   " } })).toBeNull()
    expect(parseAnswerResult({ result: { kind: "action", spokenSummary: "not an answer" } })).toBeNull()
  })

  it("normalizes the direct actions response answer into the same safe display shape", () => {
    expect(parseSubmissionAnswer({
      kind: "answer",
      spokenSummary: "Hi — I’m here and ready to help.",
      display: {
        title: "JARVIS is ready",
        facts: [{ label: "Status", value: "Ready", source: "assistant" }],
      },
    })).toEqual({
      kind: "answer",
      spokenSummary: "Hi — I’m here and ready to help.",
      displaySummary: "JARVIS is ready",
      facts: [{ label: "Status", value: "Ready", source: "assistant" }],
    })
  })

  it("rejects an explicitly mismatched instruction event, even when the local thread id is shared", () => {
    const stale = { ...ev(1, "action_created", { actionId: "old", actionType: "send_sms" }), instructionId: "old-instruction" }
    const t = applyTraceEvents(baseThread(), [stale], NO_DECISIONS)
    expect(t.nodes).toHaveLength(0)
    expect(traceEventMatchesInstructionId(stale, "i1")).toBe(false)
    expect(traceEventMatchesInstructionId(ev(2, "received"), "i1")).toBe(true)
  })

  it("applies a real ordered batch exactly like a live golden-journey run would deliver it (context+plan only, before any gating resolves)", () => {
    const events: TraceEvent[] = [
      ev(1, "received"),
      ev(2, "context_retrieved", { chips: [{ label: "recent business activity", source: "memory:episodic" }] }),
      ev(3, "planning"),
      ev(4, "plan_ready", { count: 2 }),
      ev(5, "action_created", { actionId: "a1", actionType: "start_invoice_to_cash_workflow" }),
      ev(6, "action_created", { actionId: "a2", actionType: "start_invoice_to_cash_workflow" }),
    ]
    const t = applyTraceEvents(baseThread(), events, NO_DECISIONS)
    expect(t.machine.instructionState).toBe("planning")
    expect(t.contextChips).toEqual([{ label: "recent business activity", source: "memory:episodic" }])
    expect(t.nodes.map((n) => n.id)).toEqual(["a1", "a2"])
  })

  it("'plan_ready' with count 0 moves planning -> failed (PLAN_EMPTY) and stamps terminalAtMs", () => {
    const t = applyTraceEvents(planningThread(), [ev(1, "plan_ready", { count: 0 })], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("failed")
    expect(t.terminalAtMs).not.toBeNull()
  })

  it("turns a planner deadline into a terminal, retryable failure without exposing the provider error", () => {
    const t = applyTraceEvents(
      planningThread(),
      [ev(4, "failed", { error: "Planner LLM call failed: LLM call deadline exceeded" })],
      NO_DECISIONS,
    )
    expect(t.machine.instructionState).toBe("failed")
    expect(t.submitError).toBe("Planning took too long. Nothing was executed; you can retry safely.")
    expect(t.submitError).not.toContain("LLM")
    expect(t.terminalAtMs).not.toBeNull()
  })

  // jarvis-v3 P5.T5 (V8) — a real live test this session
  // (e2e/jarvis-p5-followup-real.spec.ts) found the backend re-asking the
  // exact same clarifying question for a real follow-up instruction, never
  // demonstrably resolving it. For the genuinely-unhandled case (0 actions,
  // no clarification at all) this is the honest fallback: never the
  // misleading generic "failed" copy for what specifically looked like an
  // unresolved reference.
  it("'plan_ready' with count 0 for a follow-up-shaped instruction falls through to a real clarification with the literal message, not PLAN_EMPTY", () => {
    const t = applyTraceEvents(planningThread({ instructionText: "Actually, make that Thursday instead" }), [ev(1, "plan_ready", { count: 0 })], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("clarifying")
    expect(t.clarification?.question).toBe("I'm not sure which one you mean.")
    expect(t.terminalAtMs).toBeNull() // clarifying is not terminal
  })

  it("'plan_ready' with count 0 for an ORDINARY instruction still goes to PLAN_EMPTY — the reference heuristic never widens beyond real reference phrasing", () => {
    const t = applyTraceEvents(
      planningThread({ instructionText: "Book a water test for the Hendersons this week and give it to whoever's closest" }),
      [ev(1, "plan_ready", { count: 0 })],
      NO_DECISIONS,
    )
    expect(t.machine.instructionState).toBe("failed")
    expect(t.clarification).toBeNull()
  })

  it("a whole-plan failure (TRACE-level 'failed' with no actionId) moves planning -> failed", () => {
    const t = applyTraceEvents(planningThread(), [ev(1, "failed", { error: "Planner LLM call failed" })], NO_DECISIONS)
    expect(t.machine.instructionState).toBe("failed")
  })

  describe("real per-action gating -> the aggregate transition (P3.T7/T8)", () => {
    it("6 actions, all gated -> awaiting_approval once every one resolves, with approvalWatch registered", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 6 })], NO_DECISIONS)
      const gatedEvents = ["a1", "a2", "a3", "a4", "a5", "a6"].map((id, i) => ev(2 + i, "action_gated", { actionId: id }))
      t = applyTraceEvents(t, gatedEvents.slice(0, 5), NO_DECISIONS)
      expect(t.machine.instructionState).toBe("planning") // 5 of 6 resolved — not yet
      t = applyTraceEvents(t, [gatedEvents[5]!], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("awaiting_approval")
      expect(t.approvalWatch?.pendingNodeIds).toEqual(new Set(["a1", "a2", "a3", "a4", "a5", "a6"]))
      expect(t.approvalWatch?.approvalsAtStart).toBe(0)
    })

    it("2 actions, both auto-executed (ungated) -> completed without a workflow run watch", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 2 })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "executing", { actionId: "a1" }), ev(3, "completed", { actionId: "a1" }), ev(4, "executing", { actionId: "a2" }), ev(5, "completed", { actionId: "a2" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("completed")
      expect(t.approvalWatch).toBeNull()
      expect(t.runWatch).toBeNull()
      expect(t.terminalAtMs).not.toBeNull()
      expect(t.traceGating.completedActionIds).toEqual(["a1", "a2"])
      expect(t.everExecuted).toBe(true) // gates whether Thread.tsx's Execution block exists at all
    })

    it("synchronous completed/failed outcomes across trace batches -> partial once every action resolves", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 2 })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "executing", { actionId: "a1" }), ev(3, "completed", { actionId: "a1" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("executing")
      t = applyTraceEvents(t, [ev(4, "executing", { actionId: "a2" }), ev(5, "failed", { actionId: "a2", error: "no phone number" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("partial")
      expect(t.runWatch).toBeNull()
      expect(t.traceGating.failedActionIds).toEqual(["a2"])
    })

    it("mixed: 1 gated + 1 ungated-failed -> awaiting_approval (any gated action forces approval)", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 2 })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "action_gated", { actionId: "a1" }), ev(3, "executing", { actionId: "a2" }), ev(4, "failed", { actionId: "a2", error: "no phone number" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("awaiting_approval")
      expect(t.approvalWatch?.pendingNodeIds).toEqual(new Set(["a1"]))
    })

    it("does not fire the aggregate transition while a clarification is present, even if gating events arrive for it", () => {
      let t = applyTraceEvents(planningThread(), [ev(1, "clarification_required", { question: "which one?" })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "plan_ready", { count: 1 }), ev(3, "action_gated", { actionId: "clarify-1" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("clarifying")
    })

    it("never resolves the same actionId twice — a duplicate action_gated for the same id is a no-op", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 2 })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "action_gated", { actionId: "a1" }), ev(3, "action_gated", { actionId: "a1" })], NO_DECISIONS)
      expect(t.traceGating.resolvedActionIds).toEqual(["a1"])
      expect(t.machine.instructionState).toBe("planning") // only 1 of 2 real distinct actions resolved
    })

    it("approvalsAtStart/rejectionsAtStart in a fresh approvalWatch reflect the REAL counters passed in", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 1 }), ev(2, "action_gated", { actionId: "a1" })], { approvalsThisSession: 4, rejectionsThisSession: 2 })
      expect(t.approvalWatch).toEqual({
        pendingNodeIds: new Set(["a1"]),
        approvalsAtStart: 4,
        rejectionsAtStart: 2,
        enteredAtMs: expect.any(Number),
        everPendingIds: new Set(),
      })
    })
  })
})
