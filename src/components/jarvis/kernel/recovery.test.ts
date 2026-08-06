import { describe, expect, it } from "vitest"
import { recoveryKindFromErrorKind, recoveryPresentation } from "./recovery"
import type { RecoveryKind } from "./types"

const ALL_RECOVERY_KINDS: RecoveryKind[] = [
  "transient", "policy_denied", "integration_unavailable", "invalid_input",
  "tool_error", "timeout", "compensated", "needs_human",
]

describe("P7.T1 recovery taxonomy", () => {
  it("renders every §6.8 failure kind with its prescribed affordance", () => {
    expect(ALL_RECOVERY_KINDS.map((kind) => [kind, recoveryPresentation(kind)])).toEqual([
      ["transient", { affordance: "Retry", copy: "That timed out. Try again?" }],
      ["policy_denied", { affordance: "Escalate", copy: "Policy blocked this." }],
      ["integration_unavailable", { affordance: "Connect", copy: "The required integration isn't connected yet." }],
      ["invalid_input", { affordance: "Correct", copy: "This action needs a corrected input." }],
      ["tool_error", { affordance: "Retry", secondaryAffordance: "View error", copy: "The tool returned an error." }],
      ["timeout", { affordance: "Retry", copy: "No response in time." }],
      ["compensated", { affordance: "View rollback", copy: "Rolled back — nothing was charged." }],
      ["needs_human", { affordance: "Assign", copy: "This one needs a person." }],
    ])
  })

  it("maps the backend's distinct error vocabulary without replacing it", () => {
    expect(recoveryKindFromErrorKind("validation")).toBe("invalid_input")
    expect(recoveryKindFromErrorKind("provider_down")).toBe("integration_unavailable")
    expect(recoveryKindFromErrorKind("terminal")).toBe("tool_error")
  })
})
