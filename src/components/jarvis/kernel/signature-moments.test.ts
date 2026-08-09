import { describe, expect, it } from "vitest"
import { policyClampVariants, signatureMomentRingVariants } from "./choreography"
import { SIGNATURE_MOMENT_IDS, SIGNATURE_MOMENTS, signatureMomentForEdge } from "./signature-moments"

describe("P1.T4 Command Canvas signature moments", () => {
  it("keeps the seven v6 moments and exact motion grammar ranges", () => {
    expect(SIGNATURE_MOMENT_IDS).toEqual(["wake", "gather", "draw", "clamp", "ignite", "settle", "recover"])
    expect(Object.values(SIGNATURE_MOMENTS).map((spec) => spec.durationMs)).toEqual([
      [320, 420],
      [220, 320],
      [240, 340],
      [180, 260],
      [260, 360],
      [320, 440],
      [260, 420],
    ])
    expect(SIGNATURE_MOMENTS.clamp.easing).toEqual([0.34, 1.56, 0.64, 1])
    expect(SIGNATURE_MOMENTS.draw.source).toContain("instruction_events.action_created")
  })

  it.each([
    [{ kind: "presence", previous: "ready", current: "listening" }, "wake"],
    [{ kind: "context-retrieved", enteringCount: 1 }, "gather"],
    [{ kind: "action-created", enteringCount: 2 }, "draw"],
    [{ kind: "approval-required", state: "awaiting_approval" }, "clamp"],
    [{ kind: "workflow-step", previous: "pending", current: "leased" }, "ignite"],
    [{ kind: "authoritative-outcome", previous: "verifying", current: "completed" }, "settle"],
    [{ kind: "recovery", previousTransport: "degraded", currentTransport: "healthy" }, "recover"],
    [{ kind: "recovery", previousStep: "failed", currentStep: "leased" }, "recover"],
  ] as const)("maps only the source edge %j to %s", (edge, expected) => {
    expect(signatureMomentForEdge(edge)).toBe(expected)
  })

  it("does not turn ordinary state or restored snapshots into replay", () => {
    expect(signatureMomentForEdge({ kind: "presence", previous: "ready", current: "thinking" })).toBeNull()
    expect(signatureMomentForEdge({ kind: "context-retrieved", enteringCount: 0 })).toBeNull()
    expect(signatureMomentForEdge({ kind: "action-created", enteringCount: 1, restored: true })).toBeNull()
    expect(signatureMomentForEdge({ kind: "approval-required", state: "awaiting_approval", restored: true })).toBeNull()
    expect(signatureMomentForEdge({ kind: "workflow-step", previous: "pending", current: "leased", restored: true })).toBeNull()
    expect(signatureMomentForEdge({ kind: "authoritative-outcome", previous: "verifying", current: "completed", restored: true })).toBeNull()
    expect(signatureMomentForEdge({ kind: "recovery", previousTransport: "offline", currentTransport: "healthy", restored: true })).toBeNull()
  })

  it("requires a legal recovery edge", () => {
    expect(signatureMomentForEdge({ kind: "recovery", previousStep: "failed", currentStep: "pending" })).toBeNull()
    expect(signatureMomentForEdge({ kind: "recovery", previousTransport: "healthy", currentTransport: "healthy" })).toBeNull()
  })

  it("asserts the one-shot cue and reduced-motion contracts", () => {
    const wake = signatureMomentRingVariants("wake", false)
    expect(wake.animate).toMatchObject({
      scale: [0.78, 1.05, 1.28],
      transition: { duration: 0.37, ease: [0.22, 1, 0.36, 1] },
    })
    expect(signatureMomentRingVariants("wake", true).animate).toMatchObject({
      opacity: 0.72,
      scale: 1,
      transition: { duration: 0 },
    })

    const clamp = policyClampVariants(false, true, false)
    const restoredClamp = policyClampVariants(false, true, true)
    expect(clamp.initial).toEqual({ x: -4 })
    expect(clamp.transition).toMatchObject({ duration: 0.3 })
    expect(restoredClamp.initial).toEqual({ x: 0 })
    expect(restoredClamp.transition).toEqual({ duration: 0 })
  })
})
