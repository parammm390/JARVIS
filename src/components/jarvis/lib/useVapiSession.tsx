"use client"

// Vapi browser-mic voice session — the call-start/call-end/message wiring here is the
// SAME handler moved verbatim from the original JarvisCommandCenter.tsx (§0.5: preserve
// what works). Extended with volume-level + speech-start/end for the waveform ring and
// caption, which the original didn't need.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { sfx, setVoiceLive } from "../sound"
import { isRealMicActivity } from "./barge-in"

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "ab65d198-5573-4d95-b7f2-4fd8db6f85fc"
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "59863f35-236e-4451-9cb8-cd8df4a3c440"
// P2.T2 (NEW-1 fix): a dedicated, transcription+TTS-only assistant for the new
// Thread's browser voice (§3.2 binding decision — browser voice never authorizes
// or executes). Deliberately undefined with NO fallback to `VAPI_ASSISTANT_ID`
// when unset — see this session's state-file BLOCKERS (B-4): creating the actual
// Vapi-side assistant resource needs a `VAPI_PRIVATE_KEY` this environment does
// not have, and is a real external-service resource creation this session is not
// positioned to perform blind. Existing `/jarvis` and `/jarvis/bridge` callers
// use the legacy assistant by omitting the override; the Thread voice rail passes
// this dedicated id explicitly and therefore fails closed when it is absent.
const rawWebAssistantId = process.env.NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID?.trim()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// NEXT_PUBLIC_* values are compiled into the browser bundle. Trim accidental
// newline/whitespace input at the boundary, but reject anything that is not a
// real UUID instead of sending a malformed assistantId to Vapi and surfacing a
// vague 400 Bad Request from the voice rail.
export const VAPI_WEB_ASSISTANT_ID = rawWebAssistantId && UUID_RE.test(rawWebAssistantId) ? rawWebAssistantId : undefined

export type VoiceState = "idle" | "connecting" | "live" | "speaking" | "error"
export interface TranscriptLine {
  role: "you" | "jarvis"
  text: string
}

export interface VapiTranscriptMessage {
  type?: string
  transcript?: string
  role?: string
  transcriptType?: string
  callId?: string | null
  call_id?: string | null
  call?: { id?: string | null } | null
}

export type TranscriptMessageUpdate =
  | { kind: "ignore" }
  | { kind: "partial"; text: string }
  | { kind: "final"; line: TranscriptLine }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return id && id !== "unknown" ? id : null
}

/** Reads the id shapes emitted by Vapi's start-success, start result, and
 * lifecycle error payloads without trusting arbitrary transcript message ids. */
export function readVapiCallId(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null
  for (const key of ["callId", "call_id"]) {
    const id = normalizeId(record[key])
    if (id) return id
  }
  const nestedCallId = readVapiCallId(record.call)
  if (nestedCallId) return nestedCallId
  const contextCallId = readVapiCallId(record.context)
  if (contextCallId) return contextCallId
  return normalizeId(record.id)
}

export function updateVapiCallIdentity(
  identity: { voiceSessionId: string | null; vapiCallId: string | null },
  value: unknown,
): { voiceSessionId: string | null; vapiCallId: string | null } {
  return {
    voiceSessionId: identity.voiceSessionId,
    vapiCallId: readVapiCallId(value) ?? identity.vapiCallId,
  }
}

function readTranscriptCallId(message: VapiTranscriptMessage): string | null {
  const direct = normalizeId(message.callId) ?? normalizeId(message.call_id)
  return direct ?? readVapiCallId(message.call)
}

/** Late Vapi payloads are harmless only when they are unscoped. Once Vapi has
 * provided a call id, a payload from another call must never reach React state. */
export function isVapiEventForCall(
  eventCallId: string | null,
  activeCallId: string | null,
  endedCallIds: ReadonlySet<string> = new Set(),
): boolean {
  if (eventCallId && endedCallIds.has(eventCallId)) return false
  if (activeCallId && eventCallId && activeCallId !== eventCallId) return false
  return true
}

/** The browser TTS/Vapi output path is live-call scoped. An optional expected
 * call id lets future async callers prove that a completion belongs to the
 * call which requested it while preserving the current `say(text)` contract. */
export function isVoiceOutputEligible({
  callActive,
  outputArmed,
  activeCallId,
  expectedCallId,
}: {
  callActive: boolean
  outputArmed: boolean
  activeCallId: string | null
  expectedCallId?: string | null
}): boolean {
  if (!callActive || !outputArmed) return false
  if (expectedCallId == null) return true
  return Boolean(activeCallId && activeCallId === expectedCallId)
}

export function transcriptMessageKey(msg: VapiTranscriptMessage, update: TranscriptMessageUpdate, activeCallId: string | null): string | null {
  if (update.kind === "ignore") return null
  const callId = readTranscriptCallId(msg) ?? activeCallId ?? "unscoped"
  const role = update.kind === "final" ? update.line.role : "you"
  const text = update.kind === "final" ? update.line.text : update.text
  return `${callId}:${update.kind}:${role}:${text}`
}

let voiceSessionSequence = 0

function createVoiceSessionId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === "function") return `voice-${randomUUID.call(globalThis.crypto)}`
  voiceSessionSequence += 1
  return `voice-${Date.now().toString(36)}-${voiceSessionSequence.toString(36)}`
}

/** Pure LF-03 seam for the SDK's transcript message contract. The hook below
 * owns React state; this function keeps the partial/final distinction
 * deterministic and makes it testable without pretending a Node test has a
 * microphone, browser permission, or a live Vapi call. */
export function interpretTranscriptMessage(msg: VapiTranscriptMessage): TranscriptMessageUpdate {
  if (!msg || (msg.type !== "transcript" && msg.type !== "transcript[transcriptType='final']")) return { kind: "ignore" }
  const text = typeof msg.transcript === "string" ? msg.transcript.trim() : ""
  if (!text) return { kind: "ignore" }
  const isFinal = msg.transcriptType === "final" || msg.type === "transcript[transcriptType='final']"
  const isPartial = msg.transcriptType === "partial" || (!msg.transcriptType && msg.type === "transcript")
  if (msg.role !== "user" && msg.role !== "assistant") return { kind: "ignore" }
  if (isFinal) {
    return {
      kind: "final",
      line: { role: msg.role === "assistant" ? "jarvis" : "you", text },
    }
  }
  if (isPartial && msg.role === "user") return { kind: "partial", text }
  return { kind: "ignore" }
}

interface DailyCallLike {
  participants: () => { local?: { tracks?: { audio?: { persistentTrack?: MediaStreamTrack; track?: MediaStreamTrack } } } }
  setLocalAudio?: (enabled: boolean) => void
  updateInputSettings?: (settings: { audio: { processor: { type: "none" } } }) => Promise<void>
}

// P2.T3 — V3 (`say`) and V5 (`control`), both verified present in
// `@vapi-ai/web@2.6.1`'s own `vapi.d.ts` (plan v3 §3.1) and, until now, unused.
type VapiSendMessage =
  | { type: "end-call" }
  | { type: "say"; message: string; interruptionsEnabled?: boolean; interruptAssistantEnabled?: boolean }
  | { type: "control"; control: "mute-assistant" | "unmute-assistant" }
  | { type: "add-message"; message: { role: "system" | "user"; content: string }; triggerResponseEnabled?: boolean }

interface VapiInstance {
  start: (id: string) => Promise<unknown>
  stop: () => Promise<void>
  end: () => void
  send: (message: VapiSendMessage) => void
  setMuted: (m: boolean) => void
  on: (e: string, cb: (m?: unknown) => void) => void
  getDailyCallObject: () => DailyCallLike | null
}

// Real, hard mic release: `vapi.stop()` calls Daily's own `call.destroy()`, which
// SHOULD stop the local audio track it opened — but the product owner reproduced,
// live and repeatedly, Chrome's own mic-in-use indicator staying lit after ending a
// session (across a fresh SDK version too), meaning that teardown isn't reliably
// reaching the actual hardware-level MediaStreamTrack for this Daily version.
// Belt-and-suspenders fix: reach into the Daily call object ourselves and call
// `.stop()` directly on the real, persistent track — `track.stop()` is idempotent
// and safe to call even if Daily's own teardown already handled it correctly.
function forceReleaseMic(vapi: VapiInstance | null): void {
  try {
    const call = vapi?.getDailyCallObject?.()
    const audio = call?.participants?.().local?.tracks?.audio
    // Daily exposes `persistentTrack` on current builds, while older builds can
    // retain the same hardware stream under `track`. Stop every distinct local
    // audio track so Chrome relinquishes the microphone in either shape.
    const tracks = new Set([audio?.persistentTrack, audio?.track].filter((track): track is MediaStreamTrack => Boolean(track)))
    for (const track of tracks) {
      if (track.readyState !== "ended") track.stop()
    }
    if (tracks.size) console.info("[JARVIS] force-stopped local mic track(s) on end")
  } catch (err) {
    console.error("[JARVIS] forceReleaseMic failed", err)
  }
}

const MIC_SILENCE_WARNING_MS = 8000
const VAPI_START_TIMEOUT_MS = 15000

function describeVoiceError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error) {
    const value = error as Record<string, unknown>
    const name = value.name
    for (const key of ["message", "error", "errorMsg", "errorDetail", "reason"]) {
      const nested = value[key]
      if (typeof nested === "string" && nested.trim()) return nested
      if (nested && typeof nested === "object") {
        const described = describeVoiceError(nested, "")
        if (described) return described
      }
    }
    if (typeof name === "string" && name.trim()) return name
  }
  return fallback
}

function presentVoiceError(error: unknown, fallback: string): string {
  const message = describeVoiceError(error, fallback)
  const normalized = message.toLowerCase()
  if (
    normalized.includes("notallowederror") ||
    normalized.includes("permission denied") ||
    normalized.includes("permission was denied") ||
    normalized.includes("not allowed") ||
    normalized.includes("blocked") ||
    normalized.includes("microphone permission")
  ) {
    return "Microphone access was blocked. Allow microphone access for this site, then retry."
  }
  if (
    normalized.includes("notfounderror") ||
    normalized.includes("no microphone") ||
    normalized.includes("no audio input") ||
    normalized.includes("device not found")
  ) {
    return "No microphone was found. Connect one and retry."
  }
  return message
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The voice session timed out while connecting.")), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function cancelBrowserTts(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel()
}
// Vapi's `local-volume-level` event (packages/@vapi-ai/web's own
// handleLocalAudioLevel) reports the REAL local microphone level — confirmed by
// reading the SDK source. `volume-level` (handleRemoteParticipantsAudioLevel) is
// the assistant's own output level and says nothing about whether the user's mic
// is working; an earlier pass here mistakenly watched that one instead. The
// activity threshold itself lives in `lib/barge-in.ts` (jarvis-v3 P5.T6 — a
// pure, unit-tested module, BLOCKER B-1), shared with the barge-in decision
// below rather than a second copy of the same number.

// Real structural bug, found on top of the mic-release fix above: this hook used
// to be called independently in BOTH JarvisCommandCenter.tsx and bridge/Bridge.tsx
// — two completely separate top-level components, each running its own copy of
// this hook, each creating its OWN separate `Vapi`/Daily call object with its OWN
// separate microphone session, with zero coordination between them. Normal
// Next.js route navigation unmounts the previous page cleanly, but ANY case where
// that doesn't happen instantly (or where both ever render at once) leaves two
// independent sessions competing for the same physical mic — a real, structural
// risk, not just a one-off bug. Converted to a single Context-provided instance
// (VapiSessionProvider, mounted once in src/app/jarvis/layout.tsx) so there is
// exactly one Vapi instance, ever, for the whole /jarvis section, matching the
// same singleton-provider pattern JarvisDataProvider/JarvisAuthProvider already
// use in this codebase.
function useVapiSessionInternal() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle")
  const [volumeLevel, setVolumeLevel] = useState(0)
  // P2.T12 — V7: the mic watchdog above already reads this (via a ref, not
  // reactive state — it only needed a threshold check). Exposed as real state
  // too now so the Orb's `hearing` presence (kernel/presence.ts §4.5 rule 3) can
  // scale its energy off the ACTUAL local mic level rather than `volumeLevel`
  // (the assistant's own remote output — a different signal; using it for
  // "hearing" would be exactly the borrowed-data mistake the plan warns
  // against).
  const [localVolumeLevel, setLocalVolumeLevel] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  // jarvis-v3 P5.T6 — V4 barge-in. Real finding, verified against the SDK's
  // own type declarations (node_modules/@vapi-ai/web/dist/vapi.d.ts): Vapi's
  // `speech-start`/`speech-end` events are the ASSISTANT's own speaking turn
  // (confirmed by this file's own pre-existing mic-watchdog comment, "'live',
  // not 'speaking' — that's Finnor's turn") — there is no separate "user
  // speech" event. The only real, live signal for "is the user's own mic
  // currently active" is `local-volume-level` crossing a real amplitude
  // threshold — the SAME constant the mic watchdog already treats as real
  // activity, not a second invented threshold. `userSpeaking` is that signal,
  // and is what §4.5's own "hearing" presence rule actually means ("user
  // speaking -> hearing") — CommandRail.tsx previously wired `speaking` off
  // `voiceState === "speaking"` (the assistant), a real, live semantic bug
  // this task also fixes at its one call site.
  const [userSpeaking, setUserSpeaking] = useState(false)
  const userSpeakingRef = useRef(false)
  // P2.T3 — V1: partial (non-final) transcripts were previously read and
  // immediately discarded (`transcriptType !== "final"` never matched the old
  // handler's condition). Only the user's own partial is meaningful to stream
  // into the rail input (§3.4 point 2) — `say()` already tells the Thread
  // verbatim what JARVIS is saying, so there is nothing to stream for its turn.
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null)
  const partialTranscriptRef = useRef<string | null>(null)
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [lastError, setLastError] = useState<string | null>(null)
  const [micSilenceWarning, setMicSilenceWarning] = useState(false)
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const [vapiCallId, setVapiCallId] = useState<string | null>(null)
  const vapiRef = useRef<VapiInstance | null>(null)
  const vapiLoadRef = useRef<Promise<VapiInstance | null> | null>(null)
  const vapiCallActiveRef = useRef(false)
  const voiceOutputArmedRef = useRef(false)
  const voiceSessionIdRef = useRef<string | null>(null)
  const activeVapiCallIdRef = useRef<string | null>(null)
  const endedCallIdsRef = useRef(new Set<string>())
  const finalTranscriptKeysRef = useRef(new Set<string>())
  const lastFinalUserTextRef = useRef<string | null>(null)
  const callStartRef = useRef<number | null>(null)
  const voiceStateRef = useRef<VoiceState>("idle")
  const lastAudioAtRef = useRef<number>(0)
  const micWatchdogRef = useRef<number | null>(null)
  // React state is asynchronous. This ref is the synchronous lock that prevents
  // a second click during "Connecting…" from starting another Daily call before
  // React has rendered the first state update.
  const sessionTransitionRef = useRef(false)
  const stopRequestedRef = useRef(false)

  const stopMicWatchdog = useCallback(() => {
    if (micWatchdogRef.current) {
      window.clearInterval(micWatchdogRef.current)
      micWatchdogRef.current = null
    }
    setMicSilenceWarning(false)
  }, [])

  const adoptVapiCallId = useCallback((value: unknown) => {
    const nextIdentity = updateVapiCallIdentity(
      { voiceSessionId: voiceSessionIdRef.current, vapiCallId: activeVapiCallIdRef.current },
      value,
    )
    const nextCallId = nextIdentity.vapiCallId
    if (!nextCallId || endedCallIdsRef.current.has(nextCallId)) return
    if (activeVapiCallIdRef.current && activeVapiCallIdRef.current !== nextCallId) return
    activeVapiCallIdRef.current = nextCallId
    setVapiCallId(nextCallId)
  }, [])

  const resetCallIdentity = useCallback(() => {
    for (const id of [voiceSessionIdRef.current, activeVapiCallIdRef.current]) {
      if (id) endedCallIdsRef.current.add(id)
    }
    voiceSessionIdRef.current = null
    activeVapiCallIdRef.current = null
    setVoiceSessionId(null)
    setVapiCallId(null)
    finalTranscriptKeysRef.current.clear()
    lastFinalUserTextRef.current = null
  }, [])

  // Real bug fix (product owner reproduced live: "shows options for running, but
  // never captures my voice"): `call-start`/"live" only means Vapi's server-side
  // session joined — it's not proof the browser mic was actually captured (Daily/
  // Chrome can join with a muted or absent local audio track and never fire an
  // error). Vapi's own `local-volume-level` event samples the real local mic
  // input, so this watches for it going quiet during OUR speaking turn ("live",
  // not "speaking" — that's Finnor's turn) instead of trusting connection state.
  const startMicWatchdog = useCallback(() => {
    stopMicWatchdog()
    lastAudioAtRef.current = Date.now()
    micWatchdogRef.current = window.setInterval(() => {
      if (Date.now() - lastAudioAtRef.current > MIC_SILENCE_WARNING_MS && voiceStateRef.current === "live") {
        setMicSilenceWarning(true)
      }
    }, 1000)
  }, [stopMicWatchdog])

  const stopActiveVoice = useCallback(async () => {
    const vapi = vapiRef.current
    stopMicWatchdog()
    vapiCallActiveRef.current = false
    voiceOutputArmedRef.current = false
    cancelBrowserTts()
    resetCallIdentity()
    forceReleaseMic(vapi)
    voiceStateRef.current = "idle"
    setVoiceState("idle")
    callStartRef.current = null
    setPartialTranscript(null)
    partialTranscriptRef.current = null
    setVolumeLevel(0)
    setLocalVolumeLevel(0)
    userSpeakingRef.current = false
    setUserSpeaking(false)
    setMutedState(false)
    sfx.voiceOff()
    setVoiceLive(false)
    try {
      vapi?.send({ type: "end-call" })
      await vapi?.stop()
    } catch (error) {
      // Stopping is best-effort after the local track has already been released.
      // Keep the user-facing state settled even if Daily has already torn down.
      console.warn("[JARVIS] voice session cleanup failed", error)
    } finally {
      forceReleaseMic(vapi)
    }
  }, [resetCallIdentity, stopMicWatchdog])

  // The Vapi browser SDK is large and only useful after an explicit voice action.
  // Loading it at layout mount penalizes every Command Center visit (including
  // users who never touch voice) and makes the boot overlay compete with the main
  // application. This retains one shared instance, but creates it on demand.
  const ensureVapi = useCallback(async (): Promise<VapiInstance | null> => {
    if (vapiRef.current) return vapiRef.current
    if (vapiLoadRef.current) return vapiLoadRef.current
    vapiLoadRef.current = import("@vapi-ai/web")
      .then(({ default: Vapi }) => {
        // Daily's Chrome 140+ microphone path requires this flag. Without it,
        // Chrome can keep the hardware track open while Daily joins without a
        // usable upstream audio track: TTS still works, but Vapi receives no
        // user audio or transcript. This is deliberately the *only* mic request;
        // do not add a separate getUserMedia preflight here.
        // `avoidEval` keeps Daily's call-machine bundle compatible with the
        // production JARVIS CSP; the policy allows Daily's script host above.
        const vapi = new Vapi(VAPI_PUBLIC_KEY, undefined, {
          alwaysIncludeMicInPermissionPrompt: true,
          avoidEval: true,
        }) as unknown as VapiInstance
        setConfigured(true)
        vapi.on("call-start-success", (event?: unknown) => {
          if (voiceStateRef.current !== "connecting" || !voiceSessionIdRef.current) return
          const eventCallId = readVapiCallId(event)
          if (!isVapiEventForCall(eventCallId, activeVapiCallIdRef.current, endedCallIdsRef.current)) return
          adoptVapiCallId(event)
        })
        vapi.on("call-start", () => {
          if (stopRequestedRef.current) {
            void stopActiveVoice()
            return
          }
          if (vapiCallActiveRef.current || voiceStateRef.current !== "connecting") return
          vapiCallActiveRef.current = true
          voiceOutputArmedRef.current = true
          setLastError(null)
          voiceStateRef.current = "live"
          setVoiceState("live")
          callStartRef.current = Date.now()
          setVolumeLevel(0)
          setLocalVolumeLevel(0)
          userSpeakingRef.current = false
          setUserSpeaking(false)
          startMicWatchdog()
          sfx.voiceOn()
          setVoiceLive(true) // F11.T1 — real call-live signal, ducks master -6dB
          // Vapi enables Daily's optional noise-cancellation processor by
          // default. On affected Chrome/Daily combinations it can retain a live
          // hardware track while delivering silence upstream. Use Daily's raw
          // browser input; Deepgram performs the voice processing server-side.
          const call = vapi.getDailyCallObject?.()
          void call?.updateInputSettings?.({ audio: { processor: { type: "none" } } }).catch((error) => {
            console.warn("[JARVIS] could not disable Daily audio processor", error)
          })
          call?.setLocalAudio?.(true)
        })
        vapi.on("call-end", () => {
          if (!vapiCallActiveRef.current) return
          vapiCallActiveRef.current = false
          voiceOutputArmedRef.current = false
          cancelBrowserTts()
          resetCallIdentity()
          voiceStateRef.current = "idle"
          setVoiceState("idle")
          callStartRef.current = null
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          sfx.voiceOff()
          setVoiceLive(false) // F11.T1 — real call-end signal, restores master gain
          setPartialTranscript(null)
          partialTranscriptRef.current = null
          setVolumeLevel(0)
          setLocalVolumeLevel(0)
          userSpeakingRef.current = false
          setUserSpeaking(false)
        })
        vapi.on("error", (err?: unknown) => {
          const eventCallId = readVapiCallId(err)
          if (!isVapiEventForCall(eventCallId, activeVapiCallIdRef.current, endedCallIdsRef.current)) return
          if (!vapiCallActiveRef.current && voiceStateRef.current !== "connecting") return
          vapiCallActiveRef.current = false
          voiceOutputArmedRef.current = false
          cancelBrowserTts()
          resetCallIdentity()
          const message = presentVoiceError(err, "The voice session hit an error and had to stop.")
          console.error("[JARVIS Vapi error]", err)
          if (!stopRequestedRef.current) {
            setLastError(message)
            voiceStateRef.current = "error"
            setVoiceState("error")
          }
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          setVoiceLive(false)
          callStartRef.current = null
          partialTranscriptRef.current = null
          setPartialTranscript(null)
          setVolumeLevel(0)
          setLocalVolumeLevel(0)
          userSpeakingRef.current = false
          setUserSpeaking(false)
        })
        vapi.on("call-start-failed", (err?: unknown) => {
          const eventCallId = readVapiCallId(err)
          if (voiceStateRef.current !== "connecting" || !isVapiEventForCall(eventCallId, activeVapiCallIdRef.current, endedCallIdsRef.current)) return
          vapiCallActiveRef.current = false
          voiceOutputArmedRef.current = false
          cancelBrowserTts()
          resetCallIdentity()
          const message = presentVoiceError(err, "The microphone session could not start.")
          console.error("[JARVIS Vapi call-start-failed]", err)
          if (!stopRequestedRef.current) {
            setLastError(message)
            voiceStateRef.current = "error"
            setVoiceState("error")
          }
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          setVoiceLive(false)
          callStartRef.current = null
          partialTranscriptRef.current = null
          setPartialTranscript(null)
          setVolumeLevel(0)
          setLocalVolumeLevel(0)
          userSpeakingRef.current = false
          setUserSpeaking(false)
        })
        vapi.on("local-audio-level-observer-error", (err?: unknown) => {
          // The SDK can flush observer errors after Daily has already torn the
          // call down. Do not resurrect an error on an idle rail; retain the
          // real connecting/active error paths.
          const eventCallId = readVapiCallId(err)
          if (!isVapiEventForCall(eventCallId, activeVapiCallIdRef.current, endedCallIdsRef.current)) return
          if (!vapiCallActiveRef.current && voiceStateRef.current !== "connecting") return
          const message = presentVoiceError(err, "The microphone level could not be read.")
          console.warn("[JARVIS local audio observer error]", err)
          setLastError(message)
          setMicSilenceWarning(true)
        })
        vapi.on("volume-level", (m?: unknown) => {
          // Daily/Vapi can flush a final level callback after call-end. Once
          // the shared session is no longer active, that stale remote level
          // must not revive a waveform in another mounted consumer.
          if (!vapiCallActiveRef.current) return
          // `volume-level` is the remote Vapi speaker. It drives the assistant
          // waveform only; it cannot establish whether the user's mic works.
          const level = typeof m === "number" && Number.isFinite(m) ? Math.min(1, Math.max(0, m)) : 0
          setVolumeLevel(level)
        })
        vapi.on("local-volume-level", (m?: unknown) => {
          // Ignore late hardware callbacks after teardown. The local mic is a
          // real source for LIVEFRAME/barge-in only while this call is active.
          if (!vapiCallActiveRef.current) return
          const level = typeof m === "number" && Number.isFinite(m) ? Math.min(1, Math.max(0, m)) : 0
          setLocalVolumeLevel(level)
          if (isRealMicActivity(level)) {
            lastAudioAtRef.current = Date.now()
            setMicSilenceWarning(false)
          }
          // jarvis-v3 P5.T6 (V4 barge-in): real, live amplitude crossing the
          // SAME activity threshold the mic watchdog already trusts — this is
          // the only real "the user is talking right now" signal this SDK
          // exposes (see this file's own header note above `userSpeaking`).
          // Updated synchronously with every local-volume-level tick (Vapi's
          // own real-time cadence, not a poll this app controls), so the
          // Orb's presence reacts as fast as the browser receives that data —
          // no artificial delay added here. Server-side VAD +
          // `interruptionsEnabled: true` (already set on every `say()` call,
          // §3.2) is the actual cancellation mechanism; this is the app's own
          // reactive read of the same real signal, not a duplicate command.
          const speakingNow = isRealMicActivity(level)
          if (speakingNow) cancelBrowserTts()
          if (speakingNow !== userSpeakingRef.current) {
            userSpeakingRef.current = speakingNow
            setUserSpeaking(speakingNow)
          }
        })
        vapi.on("speech-start", () => {
          // A queued SDK event can arrive after a manual stop/call-end. It
          // cannot re-open the visible speaking state once the real call is
          // inactive or a release is already in progress.
          if (!vapiCallActiveRef.current || stopRequestedRef.current) return
          voiceStateRef.current = "speaking"
          setVoiceState("speaking")
        })
        vapi.on("speech-end", () => {
          if (!vapiCallActiveRef.current || voiceStateRef.current !== "speaking") return
          voiceStateRef.current = "live"
          setVoiceState("live")
        })
        vapi.on("message", (m: unknown) => {
          // A final transcript is actionable input. Ignore an SDK message
          // flushed after call-end so a torn-down voice turn cannot submit or
          // redraw stale user ink in the next session.
          if (!vapiCallActiveRef.current) return
          const msg = (asRecord(m) ?? {}) as VapiTranscriptMessage
          const eventCallId = readTranscriptCallId(msg)
          if (!isVapiEventForCall(eventCallId, activeVapiCallIdRef.current, endedCallIdsRef.current)) return
          if (eventCallId && !activeVapiCallIdRef.current) adoptVapiCallId(eventCallId)
          const update = interpretTranscriptMessage(msg)
          const eventKey = transcriptMessageKey(msg, update, activeVapiCallIdRef.current ?? voiceSessionIdRef.current)
          if (update.kind === "final") {
            if (!eventKey || finalTranscriptKeysRef.current.has(eventKey)) return
            finalTranscriptKeysRef.current.add(eventKey)
            if (update.line.role === "you") lastFinalUserTextRef.current = update.line.text
            setTranscript((f) => [...f.slice(-40), update.line])
            setPartialTranscript(null)
            partialTranscriptRef.current = null
            return
          }
          // P2.T3 — V1: stream the user's own in-progress utterance; replaces on
          // every update, per §3.4 point 2 ("replacing on each update").
          if (update.kind === "partial") {
            if (partialTranscriptRef.current === update.text || lastFinalUserTextRef.current === update.text) return
            partialTranscriptRef.current = update.text
            setPartialTranscript(update.text)
          }
        })
        vapiRef.current = vapi
        return vapi
      })
      .catch(() => {
        // Leave a failed lazy import retryable; a transient chunk/network
        // failure should not permanently disable the mic control for this tab.
        vapiLoadRef.current = null
        setConfigured(false)
        return null
      })
    return vapiLoadRef.current
  }, [adoptVapiCallId, resetCallIdentity, startMicWatchdog, stopActiveVoice, stopMicWatchdog])

  useEffect(() => {
    return () => {
      stopMicWatchdog()
      stopRequestedRef.current = true
      vapiCallActiveRef.current = false
      voiceOutputArmedRef.current = false
      cancelBrowserTts()
      resetCallIdentity()
      forceReleaseMic(vapiRef.current)
      void vapiRef.current?.stop()
    }
  }, [resetCallIdentity, startMicWatchdog, stopMicWatchdog])

  useEffect(() => {
    voiceStateRef.current = voiceState
  }, [voiceState])

  useEffect(() => {
    if (voiceState === "idle" || voiceState === "connecting") return
    const t = setInterval(() => {
      if (callStartRef.current) setCallDurationSec(Math.floor((Date.now() - callStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(t)
  }, [voiceState])

  // Real regression, found and reverted: an earlier pass here added a SEPARATE
  // `getUserMedia()` preflight call, immediately stopped, before handing off to
  // `vapi.start()` — which triggers Daily/Vapi's OWN internal getUserMedia request
  // a moment later. Two back-to-back requests for the same physical mic device is
  // a real, known class of bug (device-release race on some browsers/OS audio
  // stacks) and matches exactly what the product owner reported live: mic still
  // shows as captured/active even after ending the session. Before this file had
  // any preflight at all, `vapi.start()` was the ONLY thing that ever touched
  // `getUserMedia` — restoring that single-request path. Vapi's own `error`/
  // `call-start-failed` events (already wired below) still surface a real denial;
  // we just no longer duplicate the request ourselves first.
  const startVoice = useCallback(
    // P2.T2 — `assistantIdOverride` lets `/jarvis/next` request the dedicated
    // web-only assistant (`NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`) without touching
    // `/jarvis`/`/jarvis/bridge`, which call this with no argument and get the
    // EXACT same `VAPI_ASSISTANT_ID` behaviour as before this session.
    // `null` is an explicit fail-closed sentinel for callers that require the
    // dedicated assistant; `undefined` preserves the legacy caller contract.
    async (assistantIdOverride?: string | null) => {
      // The ref is checked before React has rendered the last state transition,
      // which matters for a tap followed immediately by a long press or release.
      if (sessionTransitionRef.current || voiceStateRef.current === "connecting" || voiceStateRef.current === "live" || voiceStateRef.current === "speaking") return
      stopRequestedRef.current = false
      sessionTransitionRef.current = true
      resetCallIdentity()
      const generatedCallId = createVoiceSessionId()
      voiceSessionIdRef.current = generatedCallId
      setVoiceSessionId(generatedCallId)
      setVapiCallId(null)
      activeVapiCallIdRef.current = null
      vapiCallActiveRef.current = false
      voiceOutputArmedRef.current = false
      finalTranscriptKeysRef.current.clear()
      lastFinalUserTextRef.current = null
      setLastError(null)
      voiceStateRef.current = "connecting"
      setVoiceState("connecting")
      setCallDurationSec(0)
      cancelBrowserTts()
      try {
        const vapi = await ensureVapi()
        if (!vapi) throw new Error("Voice session is unavailable")
        const assistantId = assistantIdOverride === null ? null : assistantIdOverride ?? VAPI_ASSISTANT_ID
        if (!assistantId) throw new Error("Dedicated browser voice is not configured")
        // A hold can end before the dynamic SDK import has finished. Honour that
        // release instead of opening a call after the user has let go.
        if (stopRequestedRef.current) {
          await stopActiveVoice()
          return
        }
        const startedCall = await withTimeout(vapi.start(assistantId), VAPI_START_TIMEOUT_MS)
        if (startedCall === null && !vapiCallActiveRef.current) throw new Error("The microphone session could not start.")
        adoptVapiCallId(startedCall)
        if (stopRequestedRef.current) await stopActiveVoice()
      } catch (error) {
        if (stopRequestedRef.current) {
          await stopActiveVoice()
          return
        }
        console.error("[JARVIS] unable to start voice session", error)
        const message = presentVoiceError(error, "The microphone session could not start. Please try again.")
        stopRequestedRef.current = true
        vapiCallActiveRef.current = false
        voiceOutputArmedRef.current = false
        cancelBrowserTts()
        resetCallIdentity()
        forceReleaseMic(vapiRef.current)
        try {
          await vapiRef.current?.stop()
        } catch (stopError) {
          console.warn("[JARVIS] voice start cleanup failed", stopError)
        }
        forceReleaseMic(vapiRef.current)
        setVoiceLive(false)
        setLastError(message)
        voiceStateRef.current = "error"
        setVoiceState("error")
      } finally {
        sessionTransitionRef.current = false
        stopRequestedRef.current = false
      }
    },
    [adoptVapiCallId, ensureVapi, resetCallIdentity, stopActiveVoice],
  )

  const stopVoice = useCallback(async () => {
    // If start() is still awaiting permission or a Daily join, record the release
    // and let startVoice perform the final cleanup once its Vapi instance exists.
    // Do not call stopActiveVoice here: it can emit call-end before the pending
    // start has released its transition lock, allowing a second start to race it.
    if (sessionTransitionRef.current) {
      stopRequestedRef.current = true
      if (partialTranscriptRef.current) await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
      return
    }
    if (!vapiCallActiveRef.current && voiceStateRef.current !== "live" && voiceStateRef.current !== "speaking") return
    sessionTransitionRef.current = true
    stopRequestedRef.current = true
    try {
      // Let a final Vapi transcript flush before destroying Daily on a
      // push-to-talk release. Without this short settle window, mobile Safari
      // can drop the last syllables as the mic track is torn down.
      if (partialTranscriptRef.current) await new Promise<void>((resolve) => window.setTimeout(resolve, 220))
      await stopActiveVoice()
    } finally {
      sessionTransitionRef.current = false
      stopRequestedRef.current = false
    }
  }, [stopActiveVoice])

  const toggleVoice = useCallback(
    async (assistantIdOverride?: string | null) => {
      if (voiceStateRef.current === "live" || voiceStateRef.current === "speaking" || voiceStateRef.current === "connecting") {
        await stopVoice()
        return
      }
      await startVoice(assistantIdOverride)
    },
    [startVoice, stopVoice],
  )

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      vapiRef.current?.setMuted(!m)
      return !m
    })
  }, [])

  // P2.T3 — V3: "JARVIS speaks arbitrary text mid-session." §3.4 point 4/6: the
  // Thread's plan summary and outcome, and the literal "approve on screen"
  // refusal string — always with `interruptionsEnabled: true` (§3.4 point 5,
  // barge-in cancels any queued `say`).
  const say = useCallback((text: string, expectedCallId?: string | null) => {
    if (!text.trim() || !isVoiceOutputEligible({ callActive: vapiCallActiveRef.current, outputArmed: voiceOutputArmedRef.current, activeCallId: voiceSessionIdRef.current, expectedCallId }) || !vapiRef.current) return
    // Both flags are required by Vapi's live-control contract: the first
    // allows the user turn to interrupt queued speech, the second asks the
    // assistant to stop its current utterance when a real local-mic turn
    // arrives.
    vapiRef.current.send({ type: "say", message: text, interruptionsEnabled: true, interruptAssistantEnabled: true })
  }, [])

  // P2.T3 — V5: mute/unmute the ASSISTANT's own output (distinct from
  // `toggleMute` above, which mutes the user's mic). Named `duck`/`unduck` per
  // this task's own wording; not yet called by anything in P2 (P3/P5 wire real
  // ducking moments) — added now because both live on the same `control`
  // message surface `say` already needed.
  const duck = useCallback(() => {
    vapiRef.current?.send({ type: "control", control: "mute-assistant" })
  }, [])
  const unduck = useCallback(() => {
    vapiRef.current?.send({ type: "control", control: "unmute-assistant" })
  }, [])

  return {
    voiceState,
    // `callId` was the original provider-facing name. Keep it as an immutable
    // alias for the browser session identity; Vapi's own id is separate.
    callId: voiceSessionId,
    voiceSessionId,
    vapiCallId,
    volumeLevel,
    localVolumeLevel,
    userSpeaking,
    transcript,
    partialTranscript,
    callDurationSec,
    muted,
    startVoice,
    stopVoice,
    toggleVoice,
    toggleMute,
    say,
    duck,
    unduck,
    configured,
    lastError,
    micSilenceWarning,
  }
}

type VapiSessionValue = ReturnType<typeof useVapiSessionInternal>

const VapiSessionContext = createContext<VapiSessionValue | null>(null)

export function VapiSessionProvider({ children }: { children: ReactNode }) {
  const session = useVapiSessionInternal()
  return <VapiSessionContext.Provider value={session}>{children}</VapiSessionContext.Provider>
}

/** Consumer hook — every JARVIS surface (Command Center, Bridge, …) calls this,
 *  never `useVapiSessionInternal` directly, so they all share the exact same
 *  Vapi instance and mic session provided once by `VapiSessionProvider`. */
export function useVapiSession(): VapiSessionValue {
  const ctx = useContext(VapiSessionContext)
  if (!ctx) {
    throw new Error("useVapiSession() must be used within a <VapiSessionProvider> (see src/app/jarvis/layout.tsx)")
  }
  return ctx
}
