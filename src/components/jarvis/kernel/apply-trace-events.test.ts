// Plan v3 P3.T7/T8 evidence: applyTraceEvents folds real instruction_events rows
// into a Thread — the logic that makes ② UNDERSTOOD's chips and ③ PLAN's nodes
// stream in as handleInstruction actually does the work, AND derives the
// aggregate awaiting_approval/executing transition from the trace alone (needed by
// T8's restore-after-refresh, which has no POST response to fall back on). Pure
// function over an explicit Thread + TraceEvent[] + approval-counters input (no
// DOM — same B-1 pattern as machine.ts/selectors.ts).

import { describe, expect, it } from "vitest"
import { applyTraceEvents, type Thread } from "./store"
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
    traceGating: { expectedCount: null, resolvedActionIds: [], gatedActionIds: [] },
    clarification: null,
    submitError: null,
    approvalWatch: null,
    runWatch: null,
    terminalAtMs: null,
    everExecuted: false,
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

  it("'action_created' with a malformed payload (no actionId/actionType) is a real no-op — never fabricates a node", () => {
    const t = applyTraceEvents(baseThread(), [ev(1, "action_created", {})], NO_DECISIONS)
    expect(t.nodes).toHaveLength(0)
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

    it("2 actions, both auto-executed (ungated) -> executing, gatedCount 0, no approvalWatch", () => {
      let t = planningThread()
      t = applyTraceEvents(t, [ev(1, "plan_ready", { count: 2 })], NO_DECISIONS)
      t = applyTraceEvents(t, [ev(2, "executing", { actionId: "a1" }), ev(3, "completed", { actionId: "a1" }), ev(4, "executing", { actionId: "a2" }), ev(5, "completed", { actionId: "a2" })], NO_DECISIONS)
      expect(t.machine.instructionState).toBe("executing")
      expect(t.approvalWatch).toBeNull()
      expect(t.runWatch).not.toBeNull()
      expect(t.everExecuted).toBe(true) // gates whether Thread.tsx's Execution block exists at all
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
