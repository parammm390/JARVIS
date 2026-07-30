// jarvis-v3 P5.T5 (V8 follow-up references) — a real, live test this session
// (e2e/jarvis-p5-followup-real.spec.ts, 2 real submissions against the real
// deployed backend, same tenant, same sessionId) found that the backend's
// own planner, faced with a genuine follow-up ("Actually, make that Thursday
// instead"), asked the EXACT SAME clarifying question it asked for the FIRST
// turn ("What is the phone number or household ID of the Hendersons?") —
// no visible sign the reference resolved against session memory. That case
// is already handled honestly: a real backend clarification renders its own
// real, unedited question (§6④'s own binding), which is correct whether or
// not the reference resolved. The genuinely UNHANDLED case — verified absent
// from the frontend before this task (grepped) — is when the planner comes
// back with NOTHING at all (a real, genuine 0-action, no-clarification
// plan) for an instruction that reads like a reference to something earlier.
// The existing generic empty-plan copy ("I couldn't turn that into anything
// I can do") implies the whole instruction was unintelligible; for a
// reference specifically, the honest, narrower thing to say is that the
// reference itself didn't resolve — never silently guessing a match.

const REFERENCE_PATTERNS: RegExp[] = [
  /\bthat one\b/i,
  /\bthe (first|second|third|last|other) one\b/i,
  /\b(it|that|this)\b.{0,25}\b(instead|again|too|as well)\b/i,
  /^\s*(actually|also|instead)[,\s]/i,
  /\bsame (thing|as|for)\b/i,
  /\bthe one (i|we|you)(?:'ve| have)? (mentioned|said|talked about|meant)\b/i,
  /\bdo (it|that) again\b/i,
]

/** Pure, real-word heuristic over the INSTRUCTION's own text — never the
 *  backend's response (there is no reliable backend signal to key off; the
 *  backend's own real clarification path already handles a resolvable
 *  reference correctly). Intentionally conservative: a missed reference
 *  just falls through to the existing generic empty-plan copy, which was
 *  already the ONLY behavior before this task — this function can only ever
 *  add a MORE honest message for a narrower real case, never regress the
 *  general one. */
export function looksLikeFollowUpReference(instructionText: string): boolean {
  return REFERENCE_PATTERNS.some((p) => p.test(instructionText))
}

/** Literal, per this session's own binding — never paraphrased. */
export const UNRESOLVED_REFERENCE_MESSAGE = "I'm not sure which one you mean."

export const UNRESOLVED_REFERENCE_CONTEXT =
  "This looked like a reference to something earlier in this session, but nothing came back to resolve it against. Say plainly what you'd like me to do."
