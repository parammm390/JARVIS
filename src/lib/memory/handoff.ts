"use client"

// Session bridge between the call demo and the lifecycle demo: after a live
// quoting call, the record continues into the two-year view with the same
// dealer setup and captured customer context.

export type LifecycleHandoff = {
  householdId: string | null
  dealerName: string
  zip: string
  tier: string
  services: string[]
  onWell: boolean
  customerName: string
  concern: string
}

const KEY = "finnor_lifecycle_handoff"

export function writeLifecycleHandoff(handoff: LifecycleHandoff) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(handoff))
  } catch {
    // Session storage unavailable: the lifecycle page simply starts cold.
  }
}

export function readLifecycleHandoff(): LifecycleHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LifecycleHandoff
    if (!parsed || typeof parsed !== "object" || typeof parsed.zip !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export function clearLifecycleHandoff() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
