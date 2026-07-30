import type { RunState, StepState } from "./types"

export interface WorkflowStatusPresentation {
  label: string
  tone: "neutral" | "live" | "success" | "failure" | "recovery" | "paused" | "cancelled" | "escalated"
}

/** All backend run states render a distinct presentation. No `default`: a schema
 * addition must fail compilation until it receives an explicit customer-visible
 * state. */
export function runStatusPresentation(status: RunState): WorkflowStatusPresentation {
  switch (status) {
    case "running": return { label: "running", tone: "live" }
    case "completed": return { label: "completed", tone: "success" }
    case "failed": return { label: "failed", tone: "failure" }
    case "compensating": return { label: "Rolling back", tone: "recovery" }
    case "compensated": return { label: "Rolled back", tone: "recovery" }
    case "paused": return { label: "paused", tone: "paused" }
    case "cancelled": return { label: "cancelled", tone: "cancelled" }
    case "escalated": return { label: "escalated", tone: "escalated" }
  }
  const exhaustive: never = status
  return exhaustive
}

/** All six persisted step states are also rendered explicitly. */
export function stepStatusPresentation(status: StepState): WorkflowStatusPresentation {
  switch (status) {
    case "pending": return { label: "pending", tone: "neutral" }
    case "leased": return { label: "running", tone: "live" }
    case "completed": return { label: "completed", tone: "success" }
    case "failed": return { label: "failed", tone: "failure" }
    case "compensating": return { label: "Rolling back", tone: "recovery" }
    case "compensated": return { label: "Rolled back", tone: "recovery" }
  }
  const exhaustive: never = status
  return exhaustive
}
