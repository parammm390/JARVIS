// jarvis-v3 P5.T6 (V4 barge-in) — the one genuinely pure piece of the barge-in
// decision, extracted so it is directly unit-testable (BLOCKER B-1: no jsdom,
// so `useVapiSession.tsx`'s own stateful hook cannot be rendered in a test).
// Same threshold the pre-existing mic watchdog already trusts as "real local
// mic activity" (packages/@vapi-ai/web's `local-volume-level`, confirmed
// against its own source to be the real local mic, not the assistant's
// output) — not a second, invented number.

export const MIC_ACTIVITY_THRESHOLD = 0.02

/** True the instant a real `local-volume-level` reading crosses the real
 *  activity threshold — this is the ONLY signal this SDK exposes for "the
 *  user's own mic is active right now" (verified: no separate user-speech
 *  event exists in `@vapi-ai/web`'s own type declarations). */
export function isRealMicActivity(level: number): boolean {
  return level > MIC_ACTIVITY_THRESHOLD
}
