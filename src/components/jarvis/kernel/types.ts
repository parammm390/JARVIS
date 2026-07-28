// JARVIS kernel — canonical types (plan v3 §4.2).
//
// `Truth<T>` is the contract that makes plan v2's C-01 structurally impossible:
// a 401 rendering as a confident `$0` with a sparkline. A value cannot reach the
// screen without carrying how it is known. §5.5 fixes exactly what each status
// renders as; a number renders for `known`, `stale` and `partial` only.
//
// Do not rename anything in this file (§4).

export type TruthSource =
  | "api:stats" | "api:actions-pending" | "api:workflow-runs" | "api:read-model"
  | "api:activity" | "api:receipts" | "api:instruction" | "derived" | "fixture"

export type Truth<T> =
  | { status: "known";       value: T; source: TruthSource; atMs: number }
  | { status: "stale";       value: T; source: TruthSource; atMs: number; ageMs: number }
  | { status: "partial";     value: T; source: TruthSource; atMs: number; capped: number }
  | { status: "unknown";     reason: "loading" | "never-fetched" }
  | { status: "denied";      reason: "signed-out" | "role" }
  | { status: "unavailable"; reason: "network" | "server" | "not-configured"; sinceMs: number }
