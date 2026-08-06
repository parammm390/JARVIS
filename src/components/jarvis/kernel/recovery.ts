import type { RecoveryKind } from "./types"

export interface RecoveryPresentation {
  affordance: "Retry" | "Escalate" | "Connect" | "Correct" | "View rollback" | "Assign"
  secondaryAffordance?: "View error"
  copy: string
}

/** §6.8's eight prescribed recovery renderings. The missing `default` is
 * deliberate: adding a RecoveryKind requires TypeScript to make this switch
 * complete before a customer-facing recovery panel can compile. */
export function recoveryPresentation(kind: RecoveryKind): RecoveryPresentation {
  switch (kind) {
    case "transient":
      return { affordance: "Retry", copy: "That timed out. Try again?" }
    case "policy_denied":
      return { affordance: "Escalate", copy: "Policy blocked this." }
    case "integration_unavailable":
      return { affordance: "Connect", copy: "The required integration isn't connected yet." }
    case "invalid_input":
      return { affordance: "Correct", copy: "This action needs a corrected input." }
    case "tool_error":
      return { affordance: "Retry", secondaryAffordance: "View error", copy: "The tool returned an error." }
    case "timeout":
      return { affordance: "Retry", copy: "No response in time." }
    case "compensated":
      return { affordance: "View rollback", copy: "Rolled back — nothing was charged." }
    case "needs_human":
      return { affordance: "Assign", copy: "This one needs a person." }
  }
}

const RECOVERY_KINDS: ReadonlySet<string> = new Set<RecoveryKind>([
  "transient",
  "policy_denied",
  "integration_unavailable",
  "invalid_input",
  "tool_error",
  "timeout",
  "compensated",
  "needs_human",
])

/** The API currently returns its own ErrorKind vocabulary (for example
 * `validation`, `provider_down`, and `terminal`). Preserve that raw value in
 * the receipt, but choose a truthful prescribed recovery affordance here. */
export function recoveryKindFromErrorKind(errorKind: string): RecoveryKind {
  if (RECOVERY_KINDS.has(errorKind)) return errorKind as RecoveryKind
  if (errorKind === "validation") return "invalid_input"
  if (errorKind === "provider_down" || errorKind === "config" || errorKind === "auth") return "integration_unavailable"
  if (errorKind === "timeout") return "timeout"
  return "tool_error"
}
