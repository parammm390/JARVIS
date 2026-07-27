"use client"

// F10.T2 — the HOOK only. The plan's own §5 F10 wording explicitly defers the
// tuned per-verb patterns ("approve 10ms · reject 30ms · error 10-30-10") to
// F11.T2 ("patterns land in F11") — this just wires a real, pref-gated,
// default-off `navigator.vibrate` call point so F11 has somewhere real to plug
// its patterns into, rather than F10 guessing at F11's own design.
//
// Gated on the EXISTING D6.T1 `notificationPreferences` jsonb column (a real,
// already-shipped arbitrary string->boolean record — no migration, no new
// backend field) under the key "haptics", default false/absent, mobile-only in
// effect since desktop browsers without `navigator.vibrate` simply no-op.
import { useEffect, useState } from "react"
import { jarvisGet } from "./api"

export function vibrateIfEnabled(enabled: boolean, pattern: number | number[]): void {
  if (!enabled) return
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
  navigator.vibrate(pattern)
}

// F11.T2 — the real per-verb pattern table the plan's §5 F11.T2 line specifies
// verbatim ("approve 10ms · reject 30ms · error 10-30-10"), landing here so
// every call site shares one source of truth instead of repeating magic numbers.
export const HAPTIC_PATTERNS = {
  approve: 10,
  reject: 30,
  error: [10, 30, 10],
} as const satisfies Record<string, number | number[]>

export function useHapticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    void jarvisGet<{ prefs: { notificationPreferences: Record<string, boolean> } }>("user-prefs")
      .then(({ prefs }) => { if (!cancelled) setEnabled(prefs.notificationPreferences?.haptics === true) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return enabled
}
