"use client"

// F10.T1 — FLOW-100 QuietHours. Pure logic first (unit-testable, Stage-demoable
// without a session), then a thin hook that reads the REAL D6.T1 `user-prefs`
// fields (`quietHoursStart`/`quietHoursEnd`, "HH:MM" 24h strings, paired or both
// null per the backend's own zod constraint — never fabricated). No new backend
// route: this reuses the same `GET user-prefs` `SoundPreferenceToggle` already
// calls in `bridge/Bridge.tsx`.

import { useEffect, useState } from "react"
import { jarvisGet } from "./api"

/** "HH:MM" → minutes since midnight. Assumes the backend's own regex-validated
 *  format (`^[0-2][0-9]:[0-5][0-9]$`, `< 24:00`) — never re-validated here. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** Real window math, including the honest overnight-wrap case (e.g. 22:00→06:00). */
export function isQuietNow(start: string | null, end: string | null, now: Date): boolean {
  if (!start || !end) return false
  const s = toMinutes(start)
  const e = toMinutes(end)
  const n = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  return s < e ? n >= s && n < e : n >= s || n < e
}

export interface QuietHoursState {
  quiet: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

const NOT_QUIET: QuietHoursState = { quiet: false, quietHoursStart: null, quietHoursEnd: null }

/** Fetches the real prefs once, then re-derives `quiet` off the real device clock
 *  every 60s — a plain interval recomputing a stored boundary, the same pattern
 *  `getDaypart`'s 5-minute interval already uses in `bridge/Bridge.tsx`, not a new
 *  standing rAF/CSS-infinite loop (hard rule F4's ≤2-ambient-loop budget is about
 *  visual loops, not JS timers recomputing a style value). */
export function useQuietHours(): QuietHoursState {
  const [bounds, setBounds] = useState<{ start: string | null; end: string | null } | null>(null)
  const [state, setState] = useState<QuietHoursState>(NOT_QUIET)

  useEffect(() => {
    let cancelled = false
    void jarvisGet<{ prefs: { quietHoursStart: string | null; quietHoursEnd: string | null } }>("user-prefs")
      .then(({ prefs }) => { if (!cancelled) setBounds({ start: prefs.quietHoursStart, end: prefs.quietHoursEnd }) })
      .catch(() => { if (!cancelled) setBounds({ start: null, end: null }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!bounds) return
    const recompute = () => setState({ quiet: isQuietNow(bounds.start, bounds.end, new Date()), quietHoursStart: bounds.start, quietHoursEnd: bounds.end })
    recompute()
    const id = window.setInterval(recompute, 60_000)
    return () => window.clearInterval(id)
  }, [bounds])

  return state
}
