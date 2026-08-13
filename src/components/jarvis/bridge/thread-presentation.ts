import type { InstructionState } from "../kernel/types"

export interface ThreadFocusHandoffInput {
  focusIsInteractive: boolean
  focusIsInsideCollapsingBody: boolean
  commandRailOwnsFocus: boolean
  clarificationOwnsFocus: boolean
}

/** Keep a person-operated control in charge, except when its Thread body is
 * about to become hidden. Passive focus follows the new causal block. */
export function shouldHandoffThreadFocus({
  focusIsInteractive,
  focusIsInsideCollapsingBody,
  commandRailOwnsFocus,
  clarificationOwnsFocus,
}: ThreadFocusHandoffInput): boolean {
  if (commandRailOwnsFocus || clarificationOwnsFocus) return false
  return !focusIsInteractive || focusIsInsideCollapsingBody
}

export function threadRowElementId(threadId: string): string {
  return `thread-row-${threadId}`
}

/** Never claims "Done" for a thread abandoned mid-flight. */
export function summarizeThreadOutcome(state: InstructionState): string {
  switch (state) {
    case "completed": return "Done"
    case "partial": return "Partial"
    case "failed": return "Failed"
    case "cancelled": return "Cancelled"
    default: return "Left in progress"
  }
}
