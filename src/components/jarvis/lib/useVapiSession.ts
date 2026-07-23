"use client"

// Vapi browser-mic voice session — the call-start/call-end/message wiring here is the
// SAME handler moved verbatim from the original JarvisCommandCenter.tsx (§0.5: preserve
// what works). Extended with volume-level + speech-start/end for the waveform ring and
// caption, which the original didn't need.

import { useCallback, useEffect, useRef, useState } from "react"
import { sfx } from "../sound"

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "ab65d198-5573-4d95-b7f2-4fd8db6f85fc"
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "59863f35-236e-4451-9cb8-cd8df4a3c440"

export type VoiceState = "idle" | "connecting" | "live" | "speaking" | "error"
export interface TranscriptLine {
  role: "you" | "jarvis"
  text: string
}

interface VapiInstance {
  start: (id: string) => void
  stop: () => void
  setMuted: (m: boolean) => void
  on: (e: string, cb: (m?: unknown) => void) => void
}

const MIC_SILENCE_WARNING_MS = 8000
// Vapi's own `volume-level` events report near-zero when nothing audible is
// arriving — reusing that instead of building a separate audio analyser, since the
// SDK already samples the real mic input for us.
const MIC_ACTIVITY_THRESHOLD = 0.02

export function useVapiSession() {
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
  // error). Vapi's own `volume-level` event already samples real mic input, so this
  // watches for it going quiet during OUR speaking turn ("live", not "speaking" —
  // that's Finnor's turn) instead of trusting the connection state alone.
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
        const vapi = new Vapi(VAPI_PUBLIC_KEY) as unknown as VapiInstance
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
        })
        vapi.on("volume-level", (m?: unknown) => {
          const level = typeof m === "number" ? m : 0
          setVolumeLevel(level)
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
      vapiRef.current?.stop()
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

  // Real preflight, replacing the previous zero-verification path (`toggleVoice`
  // used to call `vapi.start()` directly with no mic check at all): actually
  // requests the mic so a prior browser denial surfaces as a real, visible error
  // instead of silently starting a "live" session with nothing captured.
  const toggleVoice = useCallback(async () => {
    if (voiceState === "live" || voiceState === "speaking") {
      vapiRef.current?.stop()
      return
    }
    setLastError(null)
    setVoiceState("connecting")
    setCallDurationSec(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop()) // just verifying — Vapi/Daily opens its own track
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ""
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access was denied. Please allow microphone access for this site in your browser settings, then try again."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No microphone was found. Please connect a microphone and try again."
            : "Microphone access is blocked. Please allow mic access and try again."
      setLastError(message)
      setVoiceState("error")
      return
    }
    vapiRef.current?.start(VAPI_ASSISTANT_ID)
  }, [voiceState])

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
