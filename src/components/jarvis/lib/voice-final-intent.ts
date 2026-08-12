import type { TranscriptLine } from "./useVapiSession"

export interface VoiceFinalIntent {
  key: string
  text: string
}

/**
 * Finds the newest user final that belongs to the current voice session.
 *
 * `baselineLength` is captured when the mic session starts, so transcript
 * history from an earlier call can remain visible without becoming a new
 * instruction. The caller deliberately owns the processed key: a final heard
 * while another instruction temporarily locks the rail must stay pending and
 * be retried when that lock clears.
 */
export function nextVoiceFinalIntent(
  transcript: readonly TranscriptLine[],
  baselineLength: number,
  processedKey: string | null,
): VoiceFinalIntent | null {
  for (let index = transcript.length - 1; index >= Math.max(0, baselineLength); index -= 1) {
    const line = transcript[index]
    if (!line || line.role !== "you") continue
    const text = line.text.trim()
    if (!text) continue
    const key = `${index}:${text}`
    if (key === processedKey) return null
    return { key, text }
  }
  return null
}
