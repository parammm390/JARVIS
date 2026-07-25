// D6.T3 — deterministic client-only frecency for presentation order. This is not a
// behavioral profile or server-side ranking: it stores only a panel id, local visit
// count, and last-open timestamp in this browser. Server authorization is unchanged.
export type FrecencyEntry = { visits: number; lastOpenedAt: number }
export type FrecencyLedger = Record<string, FrecencyEntry>

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

export function scoreFrecency(entry: FrecencyEntry | undefined, now: number): number {
  if (!entry) return 0
  const age = Math.max(0, now - entry.lastOpenedAt)
  return entry.visits * Math.pow(0.5, age / HALF_LIFE_MS)
}

export function rankPanels<T extends string>(panels: readonly T[], ledger: FrecencyLedger, now: number): T[] {
  return [...panels].sort((a, b) => scoreFrecency(ledger[b], now) - scoreFrecency(ledger[a], now) || a.localeCompare(b))
}

export function recordPanelOpen(ledger: FrecencyLedger, panel: string, now: number): FrecencyLedger {
  const prior = ledger[panel]
  return { ...ledger, [panel]: { visits: (prior?.visits ?? 0) + 1, lastOpenedAt: now } }
}
