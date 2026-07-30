// jarvis-v3 P5.T7 — D3 pilot (§3.3-D3 verified no ordering guarantee between
// a `say` and an in-flight HTTP action; §8 P5.T7: "best-effort... if
// ordering is wrong in testing, cut it and record the cut"). This
// environment cannot test live audio ordering (no microphone/live call,
// established P2/P3) — the one genuinely testable decision is WHETHER to
// fire, extracted here so it is real, unit-tested logic (BLOCKER B-1: the
// effect that calls this from bridge/ThreadBridge.tsx cannot itself be
// rendered in this environment).
//
// Deliberately content-free (never "step 2 of 3" or a specific count) —
// the one design choice that makes "best-effort, never a guarantee" honest:
// with no ordering guarantee, a specific claim could be stale by the time it
// plays, but a generic "still working" cannot lie regardless of timing.

export const D3_LONG_EXECUTION_MS = 8000
export const D3_NARRATION_TEXT = "Still working on this — I'll let you know when it's done."

/** Fire once per thread — only while that SAME thread is still `executing`
 *  (a thread that finished before the delay elapsed needs no narration at
 *  all; a thread that already got its one narration never gets a second). */
export function shouldFireD3Narration(
  threadId: string | undefined,
  instructionState: string | undefined,
  alreadyNarratedThreadId: string | null,
): boolean {
  if (!threadId || instructionState !== "executing") return false
  return alreadyNarratedThreadId !== threadId
}
