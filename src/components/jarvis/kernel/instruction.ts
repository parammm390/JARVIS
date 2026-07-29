"use client"

// JARVIS kernel — instruction submission (plan v3 P2.T4, closing the V8 gap).
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

import { jarvisPost } from "../lib/api"

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

export interface SubmitInstructionOpts {
  source: InstructionSource
  /** Explicit override — omit to use/mint this source's own persisted session id
   *  (the common case). A clarification answer passes the SAME id its parent
   *  thread used, since it is the next turn of the same conversation. */
  sessionId?: string
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
  const body = await jarvisPost<{ planned?: PlannedActionResponse[] }>("actions", { instruction: text, sessionId })
  return { planned: body.planned ?? [], sessionId }
}
