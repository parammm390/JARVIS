"use client"

// Vapi browser-mic voice session — the call-start/call-end/message wiring here is the
// SAME handler moved verbatim from the original JarvisCommandCenter.tsx (§0.5: preserve
// what works). Extended with volume-level + speech-start/end for the waveform ring and
// caption, which the original didn't need.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { sfx } from "../sound"

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "ab65d198-5573-4d95-b7f2-4fd8db6f85fc"
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "59863f35-236e-4451-9cb8-cd8df4a3c440"

export type VoiceState = "idle" | "connecting" | "live" | "speaking" | "error"
export interface TranscriptLine {
  role: "you" | "jarvis"
  text: string
}

interface DailyCallLike {
  participants: () => { local?: { tracks?: { audio?: { persistentTrack?: MediaStreamTrack; track?: MediaStreamTrack } } } }
}

interface VapiInstance {
  start: (id: string) => Promise<unknown>
  stop: () => Promise<void>
  end: () => void
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
// is working; an earlier pass here mistakenly watched that one instead.
const MIC_ACTIVITY_THRESHOLD = 0.02

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
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [lastError, setLastError] = useState<string | null>(null)
  const [micSilenceWarning, setMicSilenceWarning] = useState(false)
  const vapiRef = useRef<VapiInstance | null>(null)
  const callStartRef = useRef<number | null>(null)
  const voiceStateRef = useRef<VoiceState>("idle")
  const lastAudioAtRef = useRef<number>(0)
  const micWatchdogRef = useRef<number | null>(null)

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

  useEffect(() => {
    let mounted = true
    import("@vapi-ai/web")
      .then(({ default: Vapi }) => {
        if (!mounted) return
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
        })
        vapi.on("call-end", () => {
          setVoiceState("idle")
          callStartRef.current = null
          stopMicWatchdog()
          forceReleaseMic(vapiRef.current)
          sfx.voiceOff()
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
        })
        vapi.on("volume-level", (m?: unknown) => {
          // `volume-level` is the remote Vapi speaker. It drives the assistant
          // waveform only; it cannot establish whether the user's mic works.
          const level = typeof m === "number" ? m : 0
          setVolumeLevel(level)
        })
        vapi.on("local-volume-level", (m?: unknown) => {
          const level = typeof m === "number" ? m : 0
          if (level > MIC_ACTIVITY_THRESHOLD) {
            lastAudioAtRef.current = Date.now()
            setMicSilenceWarning(false)
          }
        })
        vapi.on("speech-start", () => setVoiceState("speaking"))
        vapi.on("speech-end", () => setVoiceState((s) => (s === "speaking" ? "live" : s)))
        vapi.on("message", (m: unknown) => {
          const msg = m as { type?: string; transcript?: string; role?: string; transcriptType?: string }
          if (msg.type === "transcript" && msg.transcript && msg.transcriptType === "final") {
            setTranscript((f) => [...f.slice(-40), { role: msg.role === "assistant" ? "jarvis" : "you", text: msg.transcript! }])
          }
        })
        vapiRef.current = vapi
      })
      .catch(() => setConfigured(false))
    return () => {
      mounted = false
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
  const toggleVoice = useCallback(async () => {
    if (voiceState === "live" || voiceState === "speaking") {
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
      // `end()` sends Vapi's explicit live-call end control before destroying
      // Daily. That closes the room as well as releasing the local track, unlike
      // relying on a later left-meeting callback alone.
      vapiRef.current?.end()
      return
    }
    setLastError(null)
    setVoiceState("connecting")
    setCallDurationSec(0)
    try {
      await vapiRef.current?.start(VAPI_ASSISTANT_ID)
    } catch (error) {
      console.error("[JARVIS] unable to start voice session", error)
      setLastError("The microphone session could not start. Please try again.")
      setVoiceState("error")
      forceReleaseMic(vapiRef.current)
    }
  }, [voiceState, stopMicWatchdog])

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      vapiRef.current?.setMuted(!m)
      return !m
    })
  }, [])

  return {
    voiceState,
    volumeLevel,
    transcript,
    callDurationSec,
    muted,
    toggleVoice,
    toggleMute,
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
