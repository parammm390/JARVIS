// JARVIS kernel — transport health (plan v3 §7.1, P2 scope: polling only).
//
// P3 adds real SSE and the 4-value connection dot (`live | polling | reconnecting
// | offline`, P3.T12) on top of this. In P2 there is no SSE at all — data-core's
// fast lane (4s poll) is the only transport that exists, so "live" is not yet a
// reachable value; the dot only ever shows the three states this file can derive
// honestly from data-core's own public state, without touching its lane logic
// (explicit binding for this session — data-core.ts's lane logic is P1's and is
// not P2's to change).
//
// data-core does not expose a consecutive-failure counter for the fast lane (only
// the current `statsDegraded` boolean and `now`), so "how long has this been
// broken" is tracked here by wall-clock elapsed-since-first-failure rather than a
// poll count — the same "elapsed vs. threshold" shape data-core's own
// `SLOW_LANE_STALE_MS` (3x cadence) already uses. The threshold below is 2x the
// fast lane's 4s cadence, echoing §7.1's "2 failures" language for the (P3) SSE
// ladder without inventing an unrelated number.

export type TransportHealth = "live" | "polling" | "reconnecting" | "offline"

const FAST_LANE_MS = 4000
export const OFFLINE_AFTER_MS = FAST_LANE_MS * 2

export interface TransportInput {
  signedIn: boolean
  statsDegraded: boolean
  /** Wall-clock ms the fast lane has been continuously degraded, or `null` while
   *  it is healthy. The store tracks this (a ref that starts on the false->true
   *  edge of `statsDegraded`); this function only compares it to the threshold. */
  degradedForMs: number | null
}

/** Pure derivation — no timers, no I/O. P2 never returns "live": that value only
 *  becomes reachable once P3's SSE transport exists. */
export function deriveTransportHealth(input: TransportInput): TransportHealth {
  if (!input.signedIn) return "polling"
  if (!input.statsDegraded || input.degradedForMs === null) return "polling"
  return input.degradedForMs >= OFFLINE_AFTER_MS ? "offline" : "reconnecting"
}
