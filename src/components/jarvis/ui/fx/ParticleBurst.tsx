"use client"

// C3.T1 — "particle micro-burst engine (~100-line canvas; powers FLOW-08 +
// completions)". Grepped before building (hard rule #29 — reuse before build) and
// found this already exists, already real, already wired to production: `panels/
// ParticleField.tsx` (68 lines, hand-rolled canvas, ambient starfield + burst
// sparks) + `lib/EventFX.tsx`'s `burstAt(x,y)` queue, which `WorkflowTheater.tsx`
// already calls on every real step completion (line 199) — i.e. this was already
// "powering completions" before this session touched anything. Re-exported here
// (not moved — moving working, production-wired code for pure directory tidiness
// is exactly the kind of unnecessary churn hard rule #5 warns against) so ui/fx/ is
// the one discoverable place for C3's fx roster. This session's real, new work is
// wiring `burstAt` into the FLOW-08 Stage demo (FlowCatalog.tsx) so it triggers the
// SAME production engine instead of the small motion-div stand-in that shipped in
// C2 — see FlowCatalog.tsx's BurstFailDemo for that change.

export { ParticleField } from "../../panels/ParticleField"
export { burstAt, consumeBursts } from "../../lib/EventFX"
