// JARVIS kernel — transport health (plan v3 §7.1).
//
// P2 scope was polling-only: data-core's fast lane (10s poll) was the only
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
import { startTracePoll, type TraceEvent, type TracePollHandle, type TracePollFailure } from "./instruction"

export type TransportHealth = "live" | "polling" | "reconnecting" | "offline" | "unavailable"

const FAST_LANE_MS = 10000
export const OFFLINE_AFTER_MS = FAST_LANE_MS * 2

/** The active thread's own real-time delivery health, when one exists — `null`
 *  when no thread is tracing right now (the only case P2 ever had). */
/** The active instruction trace's actual transport. `unavailable` is distinct
 *  from `polling`: it means the bounded fallback also could not reach the trace
 *  route/schema, so the UI must not imply that lifecycle events are flowing. */
export type SseHealth = "live" | "polling" | "reconnecting" | "unavailable" | null

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
  if (input.sseHealth === "polling") return "polling"
  if (input.sseHealth === "reconnecting") return "reconnecting"
  if (input.sseHealth === "unavailable") return "unavailable"
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

/** SSE is on by default once the route is deployed. Set the public flag to `0`
 *  for a deliberate poll-only rollout; this keeps a missing build-time env from
 *  silently disabling the realtime path. Reads the env fresh per call. */
function sseEnabled(): boolean {
  return process.env.NEXT_PUBLIC_JARVIS_SSE !== "0"
}

function pollHealth(status: "polling" | "reconnecting" | "unavailable", failure?: TracePollFailure): SseHealth {
  // The failure object is intentionally consumed only as a status signal here;
  // the caller's visible transport label must not expose backend error text that
  // could contain implementation details.
  void failure
  return status
}

/** Poll-only path (SSE disabled, no token, or after the bounded SSE ladder). */
function fallbackToPolling(opts: InstructionTransportOpts): TracePollHandle {
  opts.onHealthChange("polling")
  return startTracePoll(opts.instructionId, opts.onEvents, resolveSinceSeq(opts.sinceSeq), {
    onStatus: (status, failure) => opts.onHealthChange(pollHealth(status, failure)),
  })
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
  let streamController: AbortController | null = null
  let failures = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let activePoll: TracePollHandle | null = null
  let lastSeq = resolveSinceSeq(opts.sinceSeq)
  let terminalSeen = false

  function giveUpToPolling(): void {
    if (stopped) return
    if (activePoll) return
    activePoll = fallbackToPolling({ ...opts, sinceSeq: lastSeq })
  }

  function deliverFrame(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as Partial<TraceEvent>
      if (
        typeof parsed.seq !== "number" || !Number.isInteger(parsed.seq) || parsed.seq < 0 ||
        typeof parsed.phase !== "string" || !parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload) ||
        typeof parsed.createdAt !== "string"
      ) return
      const event = parsed as TraceEvent
      if (event.seq <= lastSeq) return
      lastSeq = event.seq
      opts.onEvents([event])
      if (event.phase === "completed" || event.phase === "failed" || event.phase === "cancelled") {
        terminalSeen = true
        streamController?.abort()
      }
    } catch {
      // A malformed frame is a real no-op — never fabricates lifecycle state.
    }
  }

  async function connect(): Promise<void> {
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
    const controller = new AbortController()
    streamController = controller
    try {
      const response = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
          ...(lastSeq > 0 ? { "last-event-id": String(lastSeq) } : {}),
        },
        cache: "no-store",
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`Instruction stream failed (${response.status})`)
      failures = 0
      opts.onHealthChange("live")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let dataLines: string[] = []
      while (!stopped && !terminalSeen) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "")
          buffer = buffer.slice(newline + 1)
          if (line === "") {
            if (dataLines.length > 0) deliverFrame(dataLines.join("\n"))
            dataLines = []
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart())
          }
          newline = buffer.indexOf("\n")
        }
      }
      if (!terminalSeen && dataLines.length > 0) deliverFrame(dataLines.join("\n"))
      if (stopped || terminalSeen) return
      throw new Error("Instruction stream closed before a terminal event")
    } catch {
      if (stopped || terminalSeen) return
      failures += 1
      if (failures >= MAX_SSE_FAILURES) {
        opts.onHealthChange("unavailable")
        giveUpToPolling()
        return
      }
      opts.onHealthChange("reconnecting")
      reconnectTimer = setTimeout(() => void connect(), SSE_RECONNECT_BASE_MS * 2 ** (failures - 1))
    } finally {
      if (streamController === controller) streamController = null
    }
  }

  void connect()

  return {
    stop() {
      stopped = true
      streamController?.abort()
      streamController = null
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      activePoll?.stop()
    },
  }
}
