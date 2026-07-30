// Receipt recovery is deliberately pure: the receipt supplies only its durable
// run id and backend error kind, while the caller supplies the current run status
// and optimistic-lock version from the read model before any mutation is offered.

import { recoveryKindFromErrorKind, recoveryPresentation } from "../kernel/recovery"

export interface ReceiptRecoveryInput {
  workflowRunId: string | null
  failure: { errorKind: string } | null
}

export function receiptRecoveryVerb(receipt: ReceiptRecoveryInput): "retry" | "escalate" | null {
  if (!receipt.failure || !receipt.workflowRunId) return null
  const affordance = recoveryPresentation(recoveryKindFromErrorKind(receipt.failure.errorKind)).affordance
  if (affordance === "Retry") return "retry"
  if (affordance === "Escalate") return "escalate"
  return null
}

export function isLegalReceiptRecovery(verb: "retry" | "escalate", status: string): boolean {
  switch (verb) {
    case "retry": return status === "failed"
    case "escalate": return status === "running" || status === "failed"
  }
}
