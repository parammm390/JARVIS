"use client"

// JARVIS kernel — instruction submission (plan v3 P2.T4, closing the V8 gap) +
// the instruction lifecycle trace poll (plan v3 P3.T6, §7.1 Stage 1).
//
// `CommandBar.tsx:51` posts `{ instruction }` only — the backend's own
// `SubmitInstructionSchema` already accepts `sessionId` and `handleInstruction`
// already writes/reads short-term turn memory keyed by it (verified:
// `finnor-os/apps/api/app/api/actions/route.ts:31` passes `{ sessionId:
// body.data.sessionId }` straight through). Follow-up references ("actually make
// that Thursday") are a solved backend problem; the frontend simply never sent
// the key that unlocks it. This file is the fix, and nothing else — the Thread's
// own instruction/session concept, not a replacement for `CommandBar` (left
// unedited per this session's binding: "read, not edited").

import { jarvisGet, jarvisPost } from "../lib/api"

export type InstructionSource = "voice" | "typed"

const SESSION_STORAGE_KEYS: Record<InstructionSource, string> = {
  voice: "jarvis.session.voice",
  typed: "jarvis.session.typed",
}

let fallbackCounter = 0

function mintSessionId(source: InstructionSource): string {
  const prefix = source === "voice" ? "web" : "typed"
  return `${prefix}:${uuid()}`
}

// crypto.randomUUID() is available in every runtime this app ships to (browsers
// since 2022, Node 19+). The fallback below is NOT a randomness substitute (this
// repo's own ESLint rule bans Math.random() anywhere under src/components/jarvis
// — Phase 7 §7.8, "nothing here may fake a metric or activity effect") — it is a
// monotonic, crypto-free tiebreaker so a session id is still unique-per-tab even
// on a runtime old enough to lack crypto.randomUUID at all.
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  fallbackCounter += 1
  return `nocrypto-${Date.now()}-${fallbackCounter}`
}

/** One stable session id per browser-voice-session and per typed-session, kept in
 *  `sessionStorage` (plan v3 §3.4/P2.T4: "persisted in sessionStorage") so a
 *  follow-up instruction later in the same tab still resolves against the SAME
 *  backend short-term-memory window (30-min TTL, server-side). A page reload
 *  intentionally starts a fresh session — sessionStorage, not localStorage. */
export function getOrCreateSessionId(source: InstructionSource): string {
  if (typeof window === "undefined") return mintSessionId(source)
  const key = SESSION_STORAGE_KEYS[source]
  const existing = window.sessionStorage.getItem(key)
  if (existing) return existing
  const fresh = mintSessionId(source)
  try {
    window.sessionStorage.setItem(key, fresh)
  } catch {
    // Private-mode storage denial degrades to "no continuity this submission" —
    // never a crash; the instruction still submits with a fresh id.
  }
  return fresh
}

/** Minted-fresh, never reused — the golden journey supports one active thread at
 *  a time (§2.2), so every genuinely new instruction (not a clarification answer,
 *  not a follow-up the user explicitly wants threaded) starts a clean turn window.
 *  Exposed separately from `getOrCreateSessionId` because voice barge-in / thread
 *  stacking (P5) will want to explicitly rotate the session; P2 does not. */
export function resetSessionId(source: InstructionSource): string {
  const fresh = mintSessionId(source)
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEYS[source], fresh)
    } catch {
      // see getOrCreateSessionId
    }
  }
  return fresh
}

/** jarvis-v3 P3.T6: a FRESH id per submission (never persisted, never reused across
 *  turns — unlike sessionId) so the concurrent trace poll (`startTracePoll`, below)
 *  can target this exact call's own `instruction_events` rows. Minted by the CALLER
 *  (kernel/store.tsx) before either the trace poll or the POST itself fires, so both
 *  race against the backend from the same starting line — see this file's own
 *  header. */
export function mintInstructionId(): string {
  return uuid()
}

export interface SubmitInstructionOpts {
  source: InstructionSource
  /** Explicit override — omit to use/mint this source's own persisted session id
   *  (the common case). A clarification answer passes the SAME id its parent
   *  thread used, since it is the next turn of the same conversation. */
  sessionId?: string
  /** P3.T6: this exact submission's own trace id, minted by the caller via
   *  `mintInstructionId()` — sent to `POST /api/actions` so the concurrent trace
   *  poll and the POST's own (possibly slower) resolution describe the same real
   *  server-side work. Optional only so this file's own unit tests can omit it. */
  instructionId?: string
}

/** The shape `POST /api/actions` returns for each planned `DomainAction` — the
 *  fields the Thread's plan/clarification/execution blocks read. Kept structural
 *  (not importing the backend's own type) the same way `CommandBar.tsx`'s local
 *  `PlannedAction` already does, since this is a client module reading a JSON
 *  response, not sharing a build-time type with the API package. */
export interface PlannedActionResponse {
  id: string
  actionType: string
  payload: Record<string, unknown>
  policyId: string | null
  policyVersion?: number | null
  status: string
  createdAt: string
  groundedPayload?: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }> | null
  reasoning?: string
}

export interface SubmitInstructionResult {
  planned: PlannedActionResponse[]
  sessionId: string
}

/** The one path an instruction (typed or spoken) enters the system by (§3.2:
 *  "voice and text are one code path"). Mints/reuses this source's session id and
 *  sends it in the POST body — the single change that closes V8's frontend gap. */
export async function submitInstruction(text: string, opts: SubmitInstructionOpts): Promise<SubmitInstructionResult> {
  const sessionId = opts.sessionId ?? getOrCreateSessionId(opts.source)
  const body = await jarvisPost<{ planned?: PlannedActionResponse[] }>("actions", {
    instruction: text,
    sessionId,
    instructionId: opts.instructionId,
  })
  return { planned: body.planned ?? [], sessionId }
}

// ---------------------------------------------------------------------------
// P3.T6 — the instruction lifecycle trace poll (§7.1 Stage 1).
// ---------------------------------------------------------------------------

/** One row of `instruction_events`, as `GET /api/instructions/:id/events` returns it. */
export interface TraceEvent {
  seq: number
  phase: string
  payload: Record<string, unknown>
  createdAt: string
}

/** Phases that end the trace for this instruction — no further row will ever be
 *  written for it (mirrors the backend's own reachable set: a GATED plan's real
 *  trace stops at `action_gated`, since approval/execution happens through a wholly
 *  separate later request; only a fully-synchronous ungated action, or a genuine
 *  planning failure, ever reaches one of these three from `handleInstruction`
 *  itself — see orchestration/src/index.ts's own P3.T3 comment). */
const TERMINAL_TRACE_PHASES = new Set(["completed", "failed", "cancelled"])

/** §7.1/§8 PHASE 3 binding: 400ms interval, 120s ceiling, stops on any terminal phase. */
export const TRACE_POLL_INTERVAL_MS = 400
export const TRACE_POLL_CEILING_MS = 120_000

export interface TracePollHandle {
  stop: () => void
}

/** Polls `GET /api/instructions/:id/events?after={lastSeq}` every 400ms, calling
 *  `onEvents` with each newly-arrived batch (ascending seq, never re-delivered).
 *  Stops itself the instant a terminal-phase event arrives, or at the 120s ceiling —
 *  whichever is first. The caller (kernel/store.tsx) may also call `.stop()` earlier
 *  once the thread's own machine state has moved past where this trace can still
 *  usefully inform it (e.g. `awaiting_approval`) — stopping early is always safe,
 *  never loses an already-delivered event. A transient poll failure is not fatal —
 *  the same "try again next tick, never fabricate" honesty as data-core.ts's own
 *  lanes; it does not count toward the ceiling differently and does not stop the
 *  poll on its own. */
export function startTracePoll(
  instructionId: string,
  onEvents: (events: TraceEvent[]) => void,
  /** jarvis-v3 P3.T8: resume from a seq already seen (a restored thread's own last
   *  event) instead of re-delivering everything from 0 — the restore effect
   *  already replayed history up to this point via a direct events fetch. */
  sinceSeq = 0,
): TracePollHandle {
  let lastSeq = sinceSeq
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const startedAtMs = Date.now()

  function stop(): void {
    if (stopped) return
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return
    try {
      const res = await jarvisGet<{ events?: TraceEvent[] }>(`instructions/${instructionId}/events`, { after: String(lastSeq) })
      const events = res.events ?? []
      if (stopped) return
      if (events.length > 0) {
        lastSeq = events[events.length - 1]!.seq
        onEvents(events)
        if (events.some((e) => TERMINAL_TRACE_PHASES.has(e.phase))) {
          stop()
          return
        }
      }
    } catch {
      // Poll failed this tick — try again next tick. Never fabricates an event,
      // never crashes the submission it is only describing.
    }
    if (stopped) return
    if (Date.now() - startedAtMs >= TRACE_POLL_CEILING_MS) {
      stop()
      return
    }
    timer = setTimeout(() => void tick(), TRACE_POLL_INTERVAL_MS)
  }

  void tick()
  return { stop }
}
