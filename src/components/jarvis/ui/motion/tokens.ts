// C2.T1 — FLOW motion tokens. Plan spec (JARVIS-MAESTRO-PLAN.md §6/C2): durations
// 150/250/400ms; springs stiff(380,34)/soft(260,28); named easings. Single source of
// truth every primitive in this directory (and anything built on top of them) reads
// from — no ad-hoc duration/spring literals scattered across FLOW components.

export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const

export const SPRING = {
  stiff: { type: "spring" as const, stiffness: 380, damping: 34 },
  soft: { type: "spring" as const, stiffness: 260, damping: 28 },
}

export const EASE = {
  // Standard Material-ish curves, named so FLOW entries can reference by intent
  // rather than repeating cubic-bezier arrays.
  standard: [0.4, 0, 0.2, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
  overshoot: [0.34, 1.56, 0.64, 1] as const,
}
