"use client"

// Vapi browser-mic voice session — the call-start/call-end/message wiring here is the
// SAME handler moved verbatim from the original JarvisCommandCenter.tsx (§0.5: preserve
// what works). Extended with volume-level + speech-start/end for the waveform ring and
// caption, which the original didn't need.

import { useCallback, useEffect, useRef, useState } from "react"
import { sfx } from "../sound"

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "ab65d198-5573-4d95-b7f2-4fd8db6f85fc"
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "59863f35-236e-4451-9cb8-cd8df4a3c440"

export type VoiceState = "idle" | "connecting" | "live" | "speaking"
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

export function useVapiSession() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle")
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [muted, setMutedState] = useState(false)
  const [configured, setConfigured] = useState(true)
  const vapiRef = useRef<VapiInstance | null>(null)
  const callStartRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    import("@vapi-ai/web")
      .then(({ default: Vapi }) => {
        if (!mounted) return
        const vapi = new Vapi(VAPI_PUBLIC_KEY) as unknown as VapiInstance
        vapi.on("call-start", () => {
          setVoiceState("live")
          callStartRef.current = Date.now()
          sfx.voiceOn()
        })
        vapi.on("call-end", () => {
          setVoiceState("idle")
          callStartRef.current = null
          sfx.voiceOff()
        })
        vapi.on("error", () => setVoiceState("idle"))
        vapi.on("volume-level", (m?: unknown) => {
          const level = typeof m === "number" ? m : 0
          setVolumeLevel(level)
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
      vapiRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    if (voiceState === "idle" || voiceState === "connecting") return
    const t = setInterval(() => {
      if (callStartRef.current) setCallDurationSec(Math.floor((Date.now() - callStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(t)
  }, [voiceState])

  const toggleVoice = useCallback(() => {
    if (voiceState === "live" || voiceState === "speaking") {
      vapiRef.current?.stop()
    } else {
      setVoiceState("connecting")
      setCallDurationSec(0)
      vapiRef.current?.start(VAPI_ASSISTANT_ID)
    }
  }, [voiceState])

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      vapiRef.current?.setMuted(!m)
      return !m
    })
  }, [])

  return { voiceState, volumeLevel, transcript, callDurationSec, muted, toggleVoice, toggleMute, configured }
}
