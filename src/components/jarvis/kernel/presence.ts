// JARVIS kernel — presence derivation (plan v3 §4.5).
//
// "No component computes presence. `useKernel().presence` is the sole source."
// This is the one function that produces it, and it is pure — structurally kills
// v2's C-13 (the Orb reading `voiceState === "connecting"` as "planning" directly
// in Bridge.tsx). Every call site (the new Thread AND the legacy Bridge, both
// wired in P2.T12) goes through this same derivation.

import type { InstructionState, Presence } from "./types"
import type { TransportHealth } from "./transport"

export interface PresenceInput {
  transport: TransportHealth
  /** The active thread's instruction state, or `null` when there is no active
   *  instruction at all (nothing captured yet, or the prior thread's terminal
   *  decay has already elapsed). */
  activeInstructionState: InstructionState | null
  /** True for the ~4s "bloom" window right after a thread reaches a terminal
   *  state (§5.3 M15/§6⑦: "resolved (a 4 s bloom, then decay to dormant)"). The
   *  store owns the timer; this function only reads the boolean, so it stays
   *  pure and directly unit-testable without a clock. */
  terminalDecayActive: boolean
  voiceSpeaking: boolean
  micOpen: boolean
  blockedCount: number
  needsHumanReviewCount: number
}

/**
 * Maps a non-idle instruction state to its presence, per §4.5's list:
 *   captured|understanding|planning -> thinking · clarifying -> asking ·
 *   awaiting_approval -> proposing · executing -> working · verifying -> verifying ·
 *   terminal-ok -> resolved (4s decay) · terminal-fail -> wounded
 *
 * §4.5 names only two terminal buckets ("terminal-ok", "terminal-fail") against
 * four terminal InstructionStates. `completed` is unambiguously terminal-ok and
 * `failed` is unambiguously terminal-fail. Two are not named:
 *   - `partial` is grouped with terminal-fail ("wounded") rather than
 *     terminal-ok: §6⑦ is explicit that a partial receipt must "never read as a
 *     blanket done", and `resolved` is the state that reads as unqualified
 *     success — a partial outcome contains a real failure the user must notice.
 *   - `cancelled` carries no presence signal at all (returns `null`, falls
 *     through to the voice/blocked/dormant rules below) — a user-initiated stop
 *     is not an outcome to react to, it is simply the absence of one.
 * Recorded as a deviation in the state file, not silently decided.
 */
function instructionPresence(state: InstructionState, terminalDecayActive: boolean): Presence | null {
  switch (state) {
    case "captured":
    case "understanding":
    case "planning":
      return "thinking"
    case "clarifying":
      return "asking"
    case "awaiting_approval":
      return "proposing"
    case "executing":
      return "working"
    case "verifying":
      return "verifying"
    case "completed":
      return terminalDecayActive ? "resolved" : null
    case "partial":
    case "failed":
      return terminalDecayActive ? "wounded" : null
    case "cancelled":
    case "idle":
      return null
    default:
      return null
  }
}

/** Derivation order — first match wins (§4.5).
 *
 * §4.5's own text names two transport values ("offline" | "degraded"); P2 has no
 * SSE yet (P3 adds it) and `kernel/transport.ts`'s connection states are
 * `live | polling | reconnecting | offline | unavailable`. `offline` means
 * sustained general-lane unreachability; `unavailable` means the active trace
 * exhausted its bounded SSE/poll fallback. Both are states in which the Orb must
 * not imply that lifecycle facts are current. A single `reconnecting` blip does
 * not sever it. */
export function derivePresence(input: PresenceInput): Presence {
  // 1. Transport trouble outranks everything — the user must know the picture
  //    they're looking at may not be current.
  if (input.transport === "offline" || input.transport === "unavailable") return "severed"

  // 2. An active instruction's own presence, when it has one this moment.
  if (input.activeInstructionState) {
    const mapped = instructionPresence(input.activeInstructionState, input.terminalDecayActive)
    if (mapped) return mapped
  }

  // 3. Voice, when nothing instruction-shaped is claiming the Orb right now.
  if (input.voiceSpeaking) return "hearing"
  if (input.micOpen) return "listening"

  // 4. Something needs a human, and nothing above already explains the Orb.
  if (input.blockedCount > 0 || input.needsHumanReviewCount > 0) return "obstructed"

  // 5. Nothing is happening.
  return "dormant"
}
