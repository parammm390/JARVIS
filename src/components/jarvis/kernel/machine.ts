// JARVIS kernel — the instruction machine (plan v3 §4.4).
//
// A pure reducer: `transition(state, event) -> state`. No hooks, no timers, no
// I/O — everything the P1 selectors already proved is the only way to make the
// truth rules directly unit-testable while the DOM test environment is blocked
// (see ## BLOCKERS in the state file; P1's own precedent, carried forward here
// rather than re-litigated).
//
// Unlisted (state, event) pairs are a no-op + dev warning, never a crash — §4.4's
// own binding rule, and the reason `nextState` returns `null` (meaning "ignore")
// rather than throwing.

import type { InstructionEvent, InstructionState } from "./types"

export interface MachineState {
  instructionState: InstructionState
}

export const initialMachineState: MachineState = { instructionState: "idle" }

/** Pure state transition per §4.4's table. Returns `null` when the pair is not
 *  listed — the caller (`transition`) turns that into a no-op + dev warning. */
function nextState(from: InstructionState, event: InstructionEvent): InstructionState | null {
  if (event.type === "RESET") return "idle"

  switch (from) {
    case "idle":
      if (event.type === "SUBMITTED") return "captured"
      return null

    case "captured":
      if (event.type === "ACK") return "understanding"
      if (event.type === "SUBMIT_FAILED") return "failed"
      return null

    case "understanding":
      if (event.type === "TRACE_planning") return "planning"
      return null

    case "planning":
      if (event.type === "TRACE_clarification") return "clarifying"
      if (event.type === "ACTION_pending" && event.count >= 1) return "awaiting_approval"
      if (event.type === "ACTION_executing" && event.gatedCount === 0) return "executing"
      if (event.type === "TRACE_failed") return "failed"
      if (event.type === "PLAN_EMPTY") return "failed"
      return null

    case "clarifying":
      if (event.type === "ANSWERED") return "captured"
      if (event.type === "USER_CANCELLED") return "cancelled"
      return null

    case "awaiting_approval":
      if (event.type === "USER_CANCELLED") return "cancelled"
      if (event.type === "APPROVAL_DECIDED") return event.approvedCount >= 1 ? "executing" : "cancelled"
      return null

    case "executing":
      if (event.type === "TRACE_verifying") return "verifying"
      if (event.type === "TERMINAL") return terminalOutcome(event)
      if (event.type === "ACTION_needs_human_review") return "awaiting_approval"
      if (event.type === "RUN_escalated") return "awaiting_approval"
      return null

    case "verifying":
      if (event.type === "TERMINAL") return terminalOutcome(event)
      return null

    // Terminal states: only RESET moves them (handled above).
    case "completed":
    case "partial":
    case "failed":
    case "cancelled":
      return null

    default:
      return null
  }
}

function terminalOutcome(event: Extract<InstructionEvent, { type: "TERMINAL" }>): InstructionState {
  if (event.failed === 0) return "completed"
  if (event.ok === 0) return "failed"
  return "partial"
}

/** Apply one event. Illegal (unlisted) pairs are a no-op that returns the SAME
 *  state reference (so callers can cheaply skip re-render) and logs a dev-only
 *  warning — never a crash. */
export function transition(state: MachineState, event: InstructionEvent): MachineState {
  const next = nextState(state.instructionState, event)
  if (next === null) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[jarvis/kernel] machine: no transition for event "${event.type}" from state "${state.instructionState}" ` +
          `— ignored (plan v3 §4.4: unlisted pairs are a no-op, never a crash).`,
      )
    }
    return state
  }
  if (next === state.instructionState) return state
  return { instructionState: next }
}
