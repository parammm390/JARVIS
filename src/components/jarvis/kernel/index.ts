// JARVIS kernel — barrel export (plan v3 §4.1).
//
// Components outside `kernel/` import from here (or from `useSelectorInput.ts`
// directly for the sanctioned bridge) — never `useJarvis()`/`useJarvisAuth()`
// themselves (P1.T4's ESLint ratchet).

export * from "./types"
export * from "./selectors"
export * from "./useSelectorInput"
export * from "./machine"
export * from "./presence"
export * from "./transport"
export * from "./instruction"
export * from "./choreography"
export * from "./liveframe"
export * from "./execution-metrics"
export * from "./store"
