// D9: low-power is explicit when a user has chosen it, and automatic only when
// the browser exposes a constrained-device signal. A saved "0" is an explicit
// opt-out of the automatic fallback; absence leaves the automatic decision intact.

export const LOW_POWER_STORAGE_KEY = "finnor.jarvis.low-power.v1"

export function initialLowPowerMode(): boolean {
  const saved = window.localStorage.getItem(LOW_POWER_STORAGE_KEY)
  if (saved === "1") return true
  if (saved === "0") return false
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return (typeof deviceMemory === "number" && deviceMemory <= 2) || navigator.hardwareConcurrency <= 4
}

export function persistLowPowerMode(enabled: boolean): void {
  window.localStorage.setItem(LOW_POWER_STORAGE_KEY, enabled ? "1" : "0")
}
