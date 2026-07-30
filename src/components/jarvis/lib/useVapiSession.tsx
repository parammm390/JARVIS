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
// positioned to perform blind. `toggleVoice`'s own `assistantIdOverride` param
// (below) falls back to `VAPI_ASSISTANT_ID` when this is unset, so existing
// `/jarvis` and `/jarvis/bridge` callers — which never pass an override — are
// completely unaffected either way.
export const VAPI_WEB_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID

export type VoiceState = "idle" | "connecting" | "live" | "speaking" | "error"
export interface TranscriptLine {
  role: "you" | "jarvis"
  text: string
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
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [lastError, setLastError] = useState<string | null>(null)
  const [micSilenceWarning, setMicSilenceWarning] = useState(false)
  const vapiRef = useRef<VapiInstance | null>(null)
  const vapiLoadRef = useRef<Promise<VapiInstance | null> | null>(null)
  const callStartRef = useRef<number | null>(null)
  const voiceStateRef = useRef<VoiceState>("idle")
  const lastAudioAtRef = useRef<number>(0)
  const micWatchdogRef = useRef<number | null>(null)
  // React state is asynchronous. This ref is the synchronous lock that prevents
  // a second click during "Connecting…" from starting another Daily call before
  // React has rendered the first state update.
  const sessionTransitionRef = useRef(false)

  const stopMicWatchdog = useCallback(() => {
    if (micWatchdogRef.current) {
      window.clearInterval(micWatchdogRef.current)
      micWatchdogRef.current = null
    }
    setMicSilenceWarning(false)
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
        const vapi = new Vapi(VAPI_PUBLIC_KEY, undefined, {
          alwaysIncludeMicInPermissionPrompt: true,
        }) as unknown as VapiInstance
        vapi.on("call-start", () => {
          setLastError(null)
          setVoiceState("live")
          callStartRef.current = Date.now()
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
          setVoiceState("idle")
          callStartRef.current = null
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          sessionTransitionRef.current = false
          sfx.voiceOff()
          setVoiceLive(false) // F11.T1 — real call-end signal, restores master gain
          setPartialTranscript(null)
          setLocalVolumeLevel(0)
          userSpeakingRef.current = false
          setUserSpeaking(false)
        })
        vapi.on("error", (err?: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "object" && err && "message" in err
                ? String((err as { message?: unknown }).message)
                : "The voice session hit an error and had to stop."
          console.error("[JARVIS Vapi error]", err)
          setLastError(message)
          setVoiceState("idle")
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          sessionTransitionRef.current = false
        })
        vapi.on("volume-level", (m?: unknown) => {
          // `volume-level` is the remote Vapi speaker. It drives the assistant
          // waveform only; it cannot establish whether the user's mic works.
          const level = typeof m === "number" ? m : 0
          setVolumeLevel(level)
        })
        vapi.on("local-volume-level", (m?: unknown) => {
          const level = typeof m === "number" ? m : 0
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
          if (speakingNow !== userSpeakingRef.current) {
            userSpeakingRef.current = speakingNow
            setUserSpeaking(speakingNow)
          }
        })
        vapi.on("speech-start", () => setVoiceState("speaking"))
        vapi.on("speech-end", () => setVoiceState((s) => (s === "speaking" ? "live" : s)))
        vapi.on("message", (m: unknown) => {
          const msg = m as { type?: string; transcript?: string; role?: string; transcriptType?: string }
          if (msg.type !== "transcript" || !msg.transcript) return
          if (msg.transcriptType === "final") {
            setTranscript((f) => [...f.slice(-40), { role: msg.role === "assistant" ? "jarvis" : "you", text: msg.transcript! }])
            setPartialTranscript(null)
            return
          }
          // P2.T3 — V1: stream the user's own in-progress utterance; replaces on
          // every update, per §3.4 point 2 ("replacing on each update").
          if (msg.role !== "assistant") setPartialTranscript(msg.transcript)
        })
        vapiRef.current = vapi
        return vapi
      })
      .catch(() => {
        setConfigured(false)
        return null
      })
    return vapiLoadRef.current
  }, [startMicWatchdog, stopMicWatchdog])

  useEffect(() => {
    return () => {
      stopMicWatchdog()
      forceReleaseMic(vapiRef.current)
      void vapiRef.current?.stop()
    }
  }, [startMicWatchdog, stopMicWatchdog])

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
  const toggleVoice = useCallback(
    // P2.T2 — `assistantIdOverride` lets `/jarvis/next` request the dedicated
    // web-only assistant (`NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID`) without touching
    // `/jarvis`/`/jarvis/bridge`, which call this with no argument and get the
    // EXACT same `VAPI_ASSISTANT_ID` behaviour as before this session.
    async (assistantIdOverride?: string) => {
      if (voiceState === "live" || voiceState === "speaking") {
        if (sessionTransitionRef.current) return
        sessionTransitionRef.current = true
        // Don't wait solely on Vapi's own async `call-end` event to update state or
        // release the mic — if that event is ever slow/unreliable, the UI would be
        // stuck showing "live" and the hardware track would stay open. Release and
        // reset immediately; `call-end`, when it does fire, just confirms the same
        // state (both stopMicWatchdog/forceReleaseMic are safe to call twice).
        stopMicWatchdog()
        forceReleaseMic(vapiRef.current)
        setVoiceState("idle")
        callStartRef.current = null
        sfx.voiceOff()
        setVoiceLive(false) // F11.T1 — manual-stop path, same real restore
        // Notify Vapi first, then await Daily destruction. `end()` calls `stop()`
        // without awaiting it; waiting here ensures the browser-owned track has
        // actually been torn down before this handler completes.
        try {
          vapiRef.current?.send({ type: "end-call" })
          await vapiRef.current?.stop()
        } finally {
          forceReleaseMic(vapiRef.current)
          sessionTransitionRef.current = false
        }
        return
      }
      // A second click while the first async start is in flight used to create an
      // overlapping Daily session. Never start again until that promise settles.
      if (voiceState === "connecting" || sessionTransitionRef.current) return
      sessionTransitionRef.current = true
      setLastError(null)
      setVoiceState("connecting")
      setCallDurationSec(0)
      try {
        const vapi = await ensureVapi()
        if (!vapi) throw new Error("Voice session is unavailable")
        await vapi.start(assistantIdOverride ?? VAPI_ASSISTANT_ID)
      } catch (error) {
        console.error("[JARVIS] unable to start voice session", error)
        setLastError("The microphone session could not start. Please try again.")
        setVoiceState("error")
        forceReleaseMic(vapiRef.current)
      } finally {
        sessionTransitionRef.current = false
      }
    },
    [voiceState, stopMicWatchdog, ensureVapi],
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
  const say = useCallback((text: string) => {
    vapiRef.current?.send({ type: "say", message: text, interruptionsEnabled: true })
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
    volumeLevel,
    localVolumeLevel,
    userSpeaking,
    transcript,
    partialTranscript,
    callDurationSec,
    muted,
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
