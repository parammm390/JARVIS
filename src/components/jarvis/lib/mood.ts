// Derives the console's ambient "mood" from real state only (no invented signal).

export type Mood = "idle" | "voice" | "standalone"

export function deriveMood(args: { voiceLive: boolean; degraded: boolean }): Mood {
  if (args.degraded) return "standalone"
  if (args.voiceLive) return "voice"
  return "idle"
}
