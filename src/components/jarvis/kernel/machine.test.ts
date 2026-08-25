// Plan v3 P2.T1 evidence: "unit-test every §4.4 transition incl. illegal pairs ->
// no-op". Every row of the §4.4 table gets its own test; illegal pairs assert the
// state is unchanged AND that no exception is thrown.

import { describe, expect, it, vi } from "vitest"
import { initialMachineState, transition, type MachineState } from "./machine"
import type { InstructionState } from "./types"

function at(instructionState: InstructionState): MachineState {
  return { instructionState }
}

describe("kernel/machine — §4.4 legal transitions", () => {
  it("idle + SUBMITTED -> captured", () => {
    expect(transition(initialMachineState, { type: "SUBMITTED" })).toEqual(at("captured"))
  })

  it("captured + ACK -> understanding", () => {
    expect(transition(at("captured"), { type: "ACK" })).toEqual(at("understanding"))
  })

  it("captured + SUBMIT_FAILED -> failed", () => {
    expect(transition(at("captured"), { type: "SUBMIT_FAILED" })).toEqual(at("failed"))
  })

  it.each(["understanding", "planning"] as const)("%s + SUBMIT_FAILED -> failed", (state) => {
    expect(transition(at(state), { type: "SUBMIT_FAILED" })).toEqual(at("failed"))
  })

  it("understanding + TRACE_planning -> planning", () => {
    expect(transition(at("understanding"), { type: "TRACE_planning" })).toEqual(at("planning"))
  })

  it("planning + TRACE_clarification -> clarifying", () => {
    expect(transition(at("planning"), { type: "TRACE_clarification" })).toEqual(at("clarifying"))
  })

  it("planning + ACTION_pending >=1 -> awaiting_approval", () => {
    expect(transition(at("planning"), { type: "ACTION_pending", count: 1 })).toEqual(at("awaiting_approval"))
    expect(transition(at("planning"), { type: "ACTION_pending", count: 6 })).toEqual(at("awaiting_approval"))
  })

  it("planning + ACTION_executing, 0 gated -> executing", () => {
    expect(transition(at("planning"), { type: "ACTION_executing", gatedCount: 0 })).toEqual(at("executing"))
  })

  it("planning + ACTION_executing with gated actions is illegal (0 gated is the only legal count)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = at("planning")
    expect(transition(state, { type: "ACTION_executing", gatedCount: 2 })).toBe(state)
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it("planning + TRACE_failed -> failed", () => {
    expect(transition(at("planning"), { type: "TRACE_failed" })).toEqual(at("failed"))
  })

  it("planning + PLAN_EMPTY -> failed", () => {
    expect(transition(at("planning"), { type: "PLAN_EMPTY" })).toEqual(at("failed"))
  })

  it("clarifying + ANSWERED -> captured (same thread, new turn)", () => {
    expect(transition(at("clarifying"), { type: "ANSWERED" })).toEqual(at("captured"))
  })

  it.each([
    "captured", "understanding", "planning", "clarifying", "awaiting_approval", "executing", "verifying",
  ] as const)("%s + USER_CANCEL_REQUESTED -> stopping -> USER_CANCELLED -> cancelled", (state) => {
    const stopping = transition(at(state), { type: "USER_CANCEL_REQUESTED" })
    expect(stopping).toEqual(at("stopping"))
    expect(transition(stopping, { type: "USER_CANCELLED" })).toEqual(at("cancelled"))
  })

  it("stopping + CANCEL_FAILED restores the prior in-flight state", () => {
    expect(transition(at("stopping"), { type: "CANCEL_FAILED", returnTo: "planning" })).toEqual(at("planning"))
  })

  it("a canonical USER_CANCELLED trace terminates any in-flight state directly", () => {
    for (const state of ["captured", "understanding", "planning", "clarifying", "awaiting_approval", "executing", "verifying"] as const) {
      expect(transition(at(state), { type: "USER_CANCELLED" })).toEqual(at("cancelled"))
    }
  })

  it("awaiting_approval + APPROVAL_DECIDED, >=1 approved -> executing", () => {
    expect(
      transition(at("awaiting_approval"), { type: "APPROVAL_DECIDED", approvedCount: 1, rejectedCount: 5, totalDecided: 6 }),
    ).toEqual(at("executing"))
  })

  it("awaiting_approval + APPROVAL_DECIDED, all rejected -> cancelled", () => {
    expect(
      transition(at("awaiting_approval"), { type: "APPROVAL_DECIDED", approvedCount: 0, rejectedCount: 6, totalDecided: 6 }),
    ).toEqual(at("cancelled"))
  })

  it("executing + TRACE_verifying -> verifying", () => {
    expect(transition(at("executing"), { type: "TRACE_verifying" })).toEqual(at("verifying"))
  })

  it("executing + TERMINAL, all ok -> completed", () => {
    expect(transition(at("executing"), { type: "TERMINAL", ok: 6, failed: 0, total: 6 })).toEqual(at("completed"))
  })

  it("executing + TERMINAL, mixed -> partial", () => {
    expect(transition(at("executing"), { type: "TERMINAL", ok: 4, failed: 2, total: 6 })).toEqual(at("partial"))
  })

  it("executing + TERMINAL, none ok -> failed", () => {
    expect(transition(at("executing"), { type: "TERMINAL", ok: 0, failed: 6, total: 6 })).toEqual(at("failed"))
  })

  it("verifying + TERMINAL, all ok -> completed", () => {
    expect(transition(at("verifying"), { type: "TERMINAL", ok: 6, failed: 0, total: 6 })).toEqual(at("completed"))
  })

  it("verifying + TERMINAL, mixed -> partial", () => {
    expect(transition(at("verifying"), { type: "TERMINAL", ok: 3, failed: 3, total: 6 })).toEqual(at("partial"))
  })

  it("verifying + TERMINAL, none ok -> failed", () => {
    expect(transition(at("verifying"), { type: "TERMINAL", ok: 0, failed: 3, total: 3 })).toEqual(at("failed"))
  })

  it("executing + ACTION_needs_human_review -> awaiting_approval", () => {
    expect(transition(at("executing"), { type: "ACTION_needs_human_review" })).toEqual(at("awaiting_approval"))
  })

  it("executing + RUN_escalated -> awaiting_approval", () => {
    expect(transition(at("executing"), { type: "RUN_escalated" })).toEqual(at("awaiting_approval"))
  })

  it.each<InstructionState>([
    "idle", "captured", "understanding", "planning", "clarifying",
    "awaiting_approval", "executing", "verifying", "stopping", "completed", "partial", "failed", "cancelled",
  ])("RESET from %s -> idle, from any state", (from) => {
    expect(transition(at(from), { type: "RESET" })).toEqual(at("idle"))
  })
})

describe("kernel/machine — illegal pairs are a no-op + dev warning, never a crash", () => {
  it("idle + ACK is illegal — state unchanged, warns, does not throw", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = at("idle")
    expect(() => transition(state, { type: "ACK" })).not.toThrow()
    expect(transition(state, { type: "ACK" })).toBe(state)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no transition for event "ACK" from state "idle"'))
    spy.mockRestore()
  })

  it("terminal states ignore every non-RESET event", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const terminal of ["completed", "partial", "failed", "cancelled"] as const) {
      const state = at(terminal)
      expect(transition(state, { type: "SUBMITTED" })).toBe(state)
      expect(transition(state, { type: "TRACE_planning" })).toBe(state)
      expect(transition(state, { type: "ACTION_pending", count: 1 })).toBe(state)
    }
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("understanding + ACTION_pending is illegal (planning-only event) — no-op", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = at("understanding")
    expect(transition(state, { type: "ACTION_pending", count: 3 })).toBe(state)
    spy.mockRestore()
  })

  it("awaiting_approval + TRACE_verifying is illegal (execution-only event) — no-op", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const state = at("awaiting_approval")
    expect(transition(state, { type: "TRACE_verifying" })).toBe(state)
    spy.mockRestore()
  })

  it("a no-op is silent in production (no console.warn)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const prevEnv = process.env.NODE_ENV
    // vitest sets NODE_ENV=test by default; force production for this one assertion.
    vi.stubEnv("NODE_ENV", "production")
    transition(at("idle"), { type: "ACK" })
    expect(spy).not.toHaveBeenCalled()
    vi.stubEnv("NODE_ENV", prevEnv ?? "test")
    spy.mockRestore()
  })
})
