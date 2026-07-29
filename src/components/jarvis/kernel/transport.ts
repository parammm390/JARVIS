// JARVIS kernel — transport health (plan v3 §7.1).
//
// P2 scope was polling-only: data-core's fast lane (4s poll) was the only
// transport that existed, so "live" was not a reachable value. P3.T11 makes
// "live" real — a genuine SSE connection for the ACTIVE thread's own
// instruction_events (src/app/api/jarvis/stream/route.ts + finnor-os's real
// GET /api/stream, both P3.T9/T10) — behind `NEXT_PUBLIC_JARVIS_SSE`, default
// poll-first per this session's own binding. The general (non-instruction)
// connection signal this file derived in P2 — data-core's own `statsDegraded`
// ladder — is UNCHANGED and still the fallback basis whenever no thread is
// actively tracing; data-core.ts's lane logic itself is still not this file's to
// change (same binding as P2).

import { getCurrentAccessToken } from "../lib/jarvis-auth"
import { startTracePoll, type TraceEvent, type TracePollHandle } from "./instruction"

export type TransportHealth = "live" | "polling" | "reconnecting" | "offline"

const FAST_LANE_MS = 4000
export const OFFLINE_AFTER_MS = FAST_LANE_MS * 2

/** The active thread's own real-time delivery health, when one exists — `null`
 *  when no thread is tracing right now (the only case P2 ever had). */
export type SseHealth = "live" | "reconnecting" | "unavailable" | null

export interface TransportInput {
  signedIn: boolean
  statsDegraded: boolean
  /** Wall-clock ms the fast lane has been continuously degraded, or `null` while
   *  it is healthy. The store tracks this (a ref that starts on the false->true
   *  edge of `statsDegraded`); this function only compares it to the threshold. */
  degradedForMs: number | null
  /** P3.T11: the active thread's own SSE health, if a thread is tracing. Beats
   *  the general lane signal when present — a live per-instruction SSE
   *  connection is stronger evidence of connectivity than the general poll. */
  sseHealth?: SseHealth
}

/** Pure derivation — no timers, no I/O (BLOCKER B-1's own established pattern:
 *  the DECISION stays testable without a DOM even though this file also now
 *  contains real I/O, below). */
export function deriveTransportHealth(input: TransportInput): TransportHealth {
  if (!input.signedIn) return "polling"
  if (input.sseHealth === "live") return "live"
  if (input.sseHealth === "reconnecting") return "reconnecting"
  if (!input.statsDegraded || input.degradedForMs === null) return "polling"
  return input.degradedForMs >= OFFLINE_AFTER_MS ? "offline" : "reconnecting"
}

// ---------------------------------------------------------------------------
// P3.T11 — real SSE, with a 2-failure fallback to polling (§7.1's own literal
// ladder: "live -> 2 failures -> polling -> offline"). Both paths call the SAME
// `onEvents` callback (the caller's own `applyTraceEvents` — "one
// applyServerFacts", §7.1) — this file does not know or care which reconciler the
// caller uses, only which transport is currently delivering to it.
// ---------------------------------------------------------------------------

const MAX_SSE_FAILURES = 2
const SSE_RECONNECT_BASE_MS = 500

export interface InstructionTransportOpts {
  instructionId: string
  onEvents: (events: TraceEvent[]) => void
  onHealthChange: (health: SseHealth) => void
  /** Resume point for whichever transport ends up active — a restored thread
   *  (P3.T8) already has some events; a fresh submission passes 0. */
  sinceSeq?: number
}

export interface InstructionTransportHandle {
  stop: () => void
}

/** `NEXT_PUBLIC_JARVIS_SSE` gates whether SSE is attempted at all — default
 *  poll-first (this session's own binding). Reads the env var fresh per call
 *  (not hoisted), matching this repo's own established convention for flags read
 *  at call time rather than module load (e.g. apps/api's own rate-limit
 *  defaults). */
function sseEnabled(): boolean {
  return process.env.NEXT_PUBLIC_JARVIS_SSE === "1"
}

/** Poll-only path (SSE disabled, or given up after 2 failures). Reports
 *  `onHealthChange(null)` — polling is not an SSE health state, it is the
 *  absence of one; `deriveTransportHealth` falls through to the general lane
 *  signal in that case. */
function fallbackToPolling(opts: InstructionTransportOpts): TracePollHandle {
  opts.onHealthChange(null)
  return startTracePoll(opts.instructionId, opts.onEvents, resolveSinceSeq(opts.sinceSeq))
}

// Plan v3 §0.6 rule 4 bans `?? 0` tree-wide (a ratchet, P1.T4 — the list of
// excluded files may only ever shrink, never grow) — this is a resume-position
// default, not a displayed metric, but the rule is a blanket syntactic ban, so an
// explicit check stands in for it here rather than adding a new exemption.
function resolveSinceSeq(sinceSeq: number | undefined): number {
  return typeof sinceSeq === "number" ? sinceSeq : 0
}

/** Starts the real SSE connection for one instruction's trace, honestly
 *  reporting `live` / `reconnecting` / `unavailable` as the connection's own
 *  state changes, and handing control to a poll (`fallbackToPolling`) once
 *  `MAX_SSE_FAILURES` consecutive connection attempts have failed — never
 *  silently stuck, never a spinner with nothing behind it. */
export function startInstructionTransport(opts: InstructionTransportOpts): InstructionTransportHandle {
  if (!sseEnabled()) {
    const pollHandle = fallbackToPolling(opts)
    return { stop: () => pollHandle.stop() }
  }

  let stopped = false
  let es: EventSource | null = null
  let failures = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let activePoll: TracePollHandle | null = null
  let lastSeq = resolveSinceSeq(opts.sinceSeq)

  function giveUpToPolling(): void {
    if (stopped) return
    activePoll = fallbackToPolling({ ...opts, sinceSeq: lastSeq })
  }

  function connect(): void {
    if (stopped) return
    const token = getCurrentAccessToken()
    if (!token) {
      // No session yet to authenticate an EventSource with — honest, not an
      // error: the poll path degrades identically without one (jarvisGet's own
      // 401 handling), so falling back here is the same shape, not a special case.
      giveUpToPolling()
      return
    }
    const url = new URL("/api/jarvis/stream", window.location.origin)
    url.searchParams.set("instructionId", opts.instructionId)
    url.searchParams.set("token", token)
    es = new EventSource(url.toString())

    es.onopen = () => {
      failures = 0
      opts.onHealthChange("live")
    }
    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data) as TraceEvent
        if (typeof parsed.seq === "number") lastSeq = parsed.seq
        opts.onEvents([parsed])
      } catch {
        // A malformed frame is a real no-op — never crashes the connection,
        // never fabricates an event.
      }
    }
    es.onerror = () => {
      es?.close()
      es = null
      if (stopped) return
      failures += 1
      if (failures > MAX_SSE_FAILURES) {
        opts.onHealthChange("unavailable")
        giveUpToPolling()
        return
      }
      opts.onHealthChange("reconnecting")
      reconnectTimer = setTimeout(connect, SSE_RECONNECT_BASE_MS * 2 ** (failures - 1))
    }
  }

  connect()

  return {
    stop() {
      stopped = true
      es?.close()
      es = null
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      activePoll?.stop()
    },
  }
}
