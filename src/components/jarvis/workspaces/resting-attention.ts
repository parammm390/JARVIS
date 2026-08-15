import type { WorkCaseProjection } from "@/lib/jarvis-client"

export type RestingAttentionKind = "recovery" | "approval" | "schedule" | "money" | "customer" | "work"
export type RestingAttentionTone = "critical" | "decision" | "time"

export interface RestingAttentionItem {
  workCase: WorkCaseProjection
  kind: RestingAttentionKind
  tone: RestingAttentionTone
  score: number
  eyebrow: string
  reason: string
  nextAction: string
  expectedChange: string
  authority: string
  evidence: string
  source: string
  href: string
}

function firstRecordedText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of ["message", "reason", "error", "code", "recovery", "nextStep"]) {
    const text = record[key]
    if (typeof text === "string" && text.trim()) return text.trim()
  }
  return null
}

function recoveryAction(value: string | null): string | null {
  if (!value) return null
  if (value === "continue") return "Continue this same Work"
  if (value === "retry") return "Retry from the recorded failure boundary"
  if (value === "manual_review") return "Open manual review"
  return value
}

function hasEntity(workCase: WorkCaseProjection, ...types: string[]): boolean {
  return workCase.linkedEntities.some((entity) => types.includes(entity.entityType))
}

function hrefFor(workCase: WorkCaseProjection): string {
  const params = new URLSearchParams({ workCaseId: workCase.id })
  const links: Array<[string, string[]]> = [
    ["householdId", ["household"]],
    ["invoiceId", ["invoice"]],
    ["visitId", ["visit"]],
    ["serviceVisitId", ["service_visit"]],
    ["workOrderId", ["work_order"]],
    ["appointmentId", ["appointment"]],
  ]
  for (const [parameter, entityTypes] of links) {
    const entity = workCase.linkedEntities.find((candidate) => entityTypes.includes(candidate.entityType))
    if (entity) params.set(parameter, entity.entityId)
  }
  return `/jarvis/work?${params.toString()}`
}

function evidenceFor(workCase: WorkCaseProjection): string {
  const evidence: string[] = []
  if (workCase.receipts.length > 0) evidence.push(`${workCase.receipts.length} receipt${workCase.receipts.length === 1 ? "" : "s"}`)
  if (workCase.businessEvents.length > 0) evidence.push(`${workCase.businessEvents.length} business event${workCase.businessEvents.length === 1 ? "" : "s"}`)
  if (workCase.operations?.length) evidence.push(`${workCase.operations.length} durable operation${workCase.operations.length === 1 ? "" : "s"}`)
  if (workCase.workflows.length > 0) evidence.push(`${workCase.workflows.length} workflow${workCase.workflows.length === 1 ? "" : "s"}`)
  return evidence.join(" · ") || "Canonical Work root; no closing receipt yet"
}

function sourceFor(workCase: WorkCaseProjection): string {
  const provenance = workCase.provenance.filter(Boolean).slice(0, 3)
  if (provenance.length > 0) return provenance.join(" · ")
  return `${workCase.source.kind}${workCase.source.channel ? ` · ${workCase.source.channel}` : ""}`
}

function authorityFor(workCase: WorkCaseProjection, pendingApprovalCount: number): string {
  if (pendingApprovalCount > 0) return "An eligible approver must decide before the recorded actions can proceed."
  const ownerId = workCase.durableWork?.assignedTo ?? workCase.durableWork?.currentOwnerId
  if (ownerId) return `The current Work owner (${ownerId.slice(0, 8)}…) holds the next operating boundary.`
  return "The recorded Work policy and current employee authority determine the permitted next action."
}

function buildItem(workCase: WorkCaseProjection, nowMs: number): RestingAttentionItem | null {
  if (workCase.status === "Completed") return null

  const failedReceipt = workCase.receipts.find((receipt) => receipt.failure !== null)
  const failedOperation = workCase.operations?.find((operation) => operation.status === "failed" || operation.counts.failed > 0 || operation.counts.retry > 0)
  const durableFailure = workCase.durableWork?.failure ?? null
  const recovery = workCase.durableWork?.recovery ?? null
  const objective = workCase.objectiveLoop
  const pendingApprovalCount = workCase.approvals.filter((approval) => approval.status === "pending").length
  const failed = workCase.status === "Failed"
    || workCase.status === "Blocked"
    || failedReceipt !== undefined
    || durableFailure !== null
    || objective?.state === "failed"
    || objective?.state === "blocked"
    || failedOperation !== undefined
  const approval = pendingApprovalCount > 0 || objective?.state === "awaiting_approval"
  const scheduledContinuationDue = objective?.state === "waiting"
    && objective.nextRunAt !== null
    && new Date(objective.nextRunAt).getTime() <= nowMs
  const needsEmployee = workCase.status === "Needs you"

  if (!failed && !approval && !scheduledContinuationDue && !needsEmployee) return null

  const isSchedule = hasEntity(workCase, "appointment", "visit", "service_visit", "work_order")
  const isMoney = hasEntity(workCase, "invoice", "payment", "collection")
  const isCustomer = hasEntity(workCase, "household")
  const failureText = firstRecordedText(failedReceipt?.failure)
    ?? firstRecordedText(failedOperation?.failure)
    ?? firstRecordedText(durableFailure)
    ?? objective?.reason
  const recoveryText = firstRecordedText(recovery)
  const operationCounts = failedOperation?.counts

  if (failed) {
    const reason = failureText
      ?? (operationCounts ? `${operationCounts.failed} target${operationCounts.failed === 1 ? "" : "s"} failed and ${operationCounts.retry} remain eligible for retry.` : null)
      ?? "Canonical Work is blocked or failed and has no verified successful outcome."
    return {
      workCase,
      kind: "recovery",
      tone: "critical",
      score: 1_000 + (workCase.status === "Blocked" ? 30 : 20) + (recovery ? 10 : 0),
      eyebrow: recovery ? "Recovery available" : "Failure needs recovery",
      reason,
      nextAction: recoveryAction(recoveryText) ?? recoveryAction(objective?.nextStep ?? null) ?? "Inspect the failure and choose a recorded recovery path",
      expectedChange: "This Work remains open until execution is retried, compensated, or closed by verified evidence.",
      authority: authorityFor(workCase, pendingApprovalCount),
      evidence: evidenceFor(workCase),
      source: sourceFor(workCase),
      href: hrefFor(workCase),
    }
  }

  if (approval) {
    return {
      workCase,
      kind: "approval",
      tone: "decision",
      score: 900 + Math.min(20, pendingApprovalCount),
      eyebrow: "Approval waiting",
      reason: `${Math.max(1, pendingApprovalCount)} recorded approval${Math.max(1, pendingApprovalCount) === 1 ? "" : "s"} must be decided before execution can continue.`,
      nextAction: "Review the exact consequence and approve or reject",
      expectedChange: "A decision will release or reject the recorded actions; execution is not assumed in advance.",
      authority: authorityFor(workCase, pendingApprovalCount),
      evidence: evidenceFor(workCase),
      source: sourceFor(workCase),
      href: hrefFor(workCase),
    }
  }

  const kind: RestingAttentionKind = isSchedule ? "schedule" : isMoney ? "money" : isCustomer ? "customer" : "work"
  const eyebrow = isSchedule ? "Schedule pressure" : isMoney ? "Cash pressure" : isCustomer ? "Customer work needs you" : "Work needs you"
  return {
    workCase,
    kind,
    tone: scheduledContinuationDue ? "time" : "decision",
    score: scheduledContinuationDue ? 840 : 800,
    eyebrow,
    reason: objective?.reason ?? (scheduledContinuationDue ? "A recorded continuation time has passed and the objective still has no terminal outcome." : "The canonical Work projection assigns the next boundary to an employee."),
    nextAction: objective?.nextStep ?? "Open the exact Work and take the next permitted action",
    expectedChange: "The same durable Work will carry the next action, execution state, and eventual receipt.",
    authority: authorityFor(workCase, pendingApprovalCount),
    evidence: evidenceFor(workCase),
    source: sourceFor(workCase),
    href: hrefFor(workCase),
  }
}

export function projectRestingAttention(workCases: WorkCaseProjection[], nowMs = Date.now(), limit = 3): RestingAttentionItem[] {
  return workCases
    .map((workCase) => buildItem(workCase, nowMs))
    .filter((item): item is RestingAttentionItem => item !== null)
    .sort((left, right) => right.score - left.score || new Date(right.workCase.updatedAt).getTime() - new Date(left.workCase.updatedAt).getTime())
    .slice(0, limit)
}
