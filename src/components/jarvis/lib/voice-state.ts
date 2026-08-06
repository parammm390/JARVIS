import type { VoiceState } from "./useVapiSession"

/**
 * P2.T5 — visible voice copy is a projection over the existing Vapi/session
 * facts. It does not create a second voice lifecycle or infer microphone audio
 * from the assistant's speaking event.
 */
export type VoiceDisplayState =
  | "unavailable"
  | "permission-denied"
  | "connecting"
  | "listening"
  | "hearing"
  | "silence"
  | "speaking"
  | "retrying"
  | "stopped"
  | "error"

export interface VoiceStateCopy {
  state: VoiceDisplayState
  label: string
  detail: string
  retryable: boolean
}

export interface VoiceStateCopyInput {
  available: boolean
  voiceState: VoiceState
  userSpeaking: boolean
  micSilenceWarning: boolean
  lastError: string | null
  retrying: boolean
}

function permissionError(message: string | null): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  return normalized.includes("microphone access was blocked")
    || normalized.includes("permission denied")
    || normalized.includes("permission was denied")
    || normalized.includes("microphone permission")
}

export function deriveVoiceStateCopy(input: VoiceStateCopyInput): VoiceStateCopy {
  if (!input.available) {
    return {
      state: "unavailable",
      label: "Unavailable",
      detail: "Voice is unavailable in this deployment.",
      retryable: false,
    }
  }

  if (input.retrying) {
    return {
      state: "retrying",
      label: "Retrying",
      detail: "Retrying the microphone session…",
      retryable: false,
    }
  }

  if (permissionError(input.lastError)) {
    return {
      state: "permission-denied",
      label: "Permission denied",
      detail: "Allow microphone access for this site, then retry.",
      retryable: true,
    }
  }

  if (input.lastError || input.voiceState === "error") {
    return {
      state: "error",
      label: "Needs attention",
      detail: input.lastError ?? "The voice session stopped unexpectedly. Retry.",
      retryable: true,
    }
  }

  if (input.voiceState === "connecting") {
    return {
      state: "connecting",
      label: "Connecting",
      detail: "Connecting to the microphone…",
      retryable: false,
    }
  }

  // A real local-mic activity tick is the user's barge-in signal. It must win
  // over Vapi's assistant `speech-start` state so the visible copy changes to
  // Hearing at the same semantic edge as the Presence Core.
  if ((input.voiceState === "live" || input.voiceState === "speaking") && input.userSpeaking) {
    return {
      state: "hearing",
      label: "Hearing",
      detail: "I hear you.",
      retryable: false,
    }
  }

  if (input.voiceState === "speaking") {
    return {
      state: "speaking",
      label: "Speaking",
      detail: "JARVIS is speaking. You can interrupt.",
      retryable: false,
    }
  }

  if (input.voiceState === "live" && input.micSilenceWarning) {
    return {
      state: "silence",
      label: "Silence",
      detail: "No microphone audio detected. Check permission or mute.",
      retryable: false,
    }
  }

  if (input.voiceState === "live") {
    return {
      state: "listening",
      label: "Listening",
      detail: "Listening for your instruction.",
      retryable: false,
    }
  }

  return {
    state: "stopped",
    label: "Stopped",
    detail: "Voice is off. Tap Talk to start.",
    retryable: false,
  }
}
