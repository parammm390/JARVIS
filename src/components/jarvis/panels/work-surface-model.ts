import type { WorkCaseProjection, WorkEntityLink } from "@/lib/jarvis-client"

export type WorkFilter = "Open" | "Needs you" | "Working" | "Waiting" | "Done" | "Partial" | "Cancelled" | "Failed"
export const WORK_CHAPTERS = ["WHY", "PLAN", "OWNER", "APPROVAL", "EXECUTION", "EVIDENCE & OUTCOME", "NEXT ACTION"] as const

export function primaryEntity(workCase: WorkCaseProjection): WorkEntityLink | null {
  return workCase.linkedEntities.find((entity) => entity.entityType === "household")
    ?? workCase.linkedEntities.find((entity) => entity.entityType === "invoice")
    ?? workCase.linkedEntities[0]
    ?? null
}

export interface WorkSurfaceQuery {
  workCaseId: string | null
  householdId: string | null
  invoiceId: string | null
  visitId: string | null
  serviceVisitId: string | null
  workOrderId: string | null
  appointmentId: string | null
  receiptId: string | null
}

export function readWorkSurfaceQuery(search: string): WorkSurfaceQuery {
  const params = new URLSearchParams(search)
  return {
    workCaseId: params.get("workCaseId"), householdId: params.get("householdId"), invoiceId: params.get("invoiceId"),
    visitId: params.get("visitId"), serviceVisitId: params.get("serviceVisitId"), workOrderId: params.get("workOrderId"),
    appointmentId: params.get("appointmentId"), receiptId: params.get("receiptId"),
  }
}

function hasEntity(workCase: WorkCaseProjection, entityTypes: string[], entityId: string | null): boolean {
  return entityId === null || workCase.linkedEntities.some((entity) => entityTypes.includes(entity.entityType) && entity.entityId === entityId)
}

export function workCaseMatchesQuery(workCase: WorkCaseProjection, query: WorkSurfaceQuery): boolean {
  // A durable Work ID is the authoritative cross-surface identity. Entity params
  // alongside it are navigation context, not extra filters that can accidentally
  // hide the exact Work after a user inspects a different customer or invoice.
  if (query.workCaseId) {
    if (workCase.id !== query.workCaseId && workCase.root.id !== query.workCaseId) return false
    return query.receiptId === null || workCase.receipts.some((receipt) => receipt.id === query.receiptId)
  }
  if (!hasEntity(workCase, ["household"], query.householdId)) return false
  if (!hasEntity(workCase, ["invoice"], query.invoiceId)) return false
  if (!hasEntity(workCase, ["visit", "service_visit"], query.visitId)) return false
  if (!hasEntity(workCase, ["visit", "service_visit"], query.serviceVisitId)) return false
  if (!hasEntity(workCase, ["work_order"], query.workOrderId)) return false
  if (!hasEntity(workCase, ["appointment"], query.appointmentId)) return false
  if (query.receiptId && !workCase.receipts.some((receipt) => receipt.id === query.receiptId)) return false
  return true
}

export function destinationForEntity(entity: WorkEntityLink, workCase: WorkCaseProjection): string | null {
  const householdId = workCase.linkedEntities.find((candidate) => candidate.entityType === "household")?.entityId
  const params = new URLSearchParams({ workCaseId: workCase.id })
  if (householdId) params.set("householdId", householdId)
  if (entity.entityType === "household") {
    params.set("householdId", entity.entityId)
    return `/jarvis/customers?${params.toString()}`
  }
  if (entity.entityType === "invoice") {
    params.set("invoiceId", entity.entityId)
    return `/jarvis/money?${params.toString()}`
  }
  if (entity.entityType === "visit" || entity.entityType === "service_visit") {
    params.set(entity.entityType === "visit" ? "visitId" : "serviceVisitId", entity.entityId)
    return `/jarvis/schedule?${params.toString()}`
  }
  if (entity.entityType === "work_order") {
    params.set("workOrderId", entity.entityId)
    return `/jarvis/schedule?${params.toString()}`
  }
  if (entity.entityType === "appointment") {
    params.set("appointmentId", entity.entityId)
    return `/jarvis/schedule?${params.toString()}`
  }
  return null
}

export function stageFor(workCase: WorkCaseProjection): string {
  if (workCase.status === "Failed" || workCase.status === "Blocked" || workCase.status === "Partial" || workCase.status === "Cancelled") return "Evidence & outcome"
  if (workCase.approvals.some((approval) => approval.status === "pending")) return "Approval"
  if (workCase.operations?.some((operation) => ["queued", "running"].includes(operation.status)) || workCase.workflows.some((workflow) => ["running", "compensating"].includes(workflow.status))) return "Execution"
  if (workCase.receipts.length > 0 || workCase.status === "Completed") return "Evidence & outcome"
  if (workCase.actions.length > 0) return "Plan"
  return "Why"
}

export function filterMatches(workCase: WorkCaseProjection, filter: WorkFilter): boolean {
  if (filter === "Open") return workCase.status !== "Completed" && workCase.status !== "Partial" && workCase.status !== "Cancelled"
  if (filter === "Done") return workCase.status === "Completed"
  return workCase.status === filter
}

export interface WorkCaseGroup { key: string; cases: WorkCaseProjection[] }

export function groupWorkCases(workCases: WorkCaseProjection[]): WorkCaseGroup[] {
  const groups = new Map<string, WorkCaseProjection[]>()
  for (const workCase of workCases) {
    const title = workCase.title.trim().toLocaleLowerCase().replace(/\s+/g, " ")
    const actionFamily = workCase.actions[0]?.actionType ?? "no-action"
    const entityType = primaryEntity(workCase)?.entityType ?? "no-entity"
    const key = [workCase.status, stageFor(workCase), actionFamily, entityType, title].join("|")
    const current = groups.get(key) ?? []
    current.push(workCase)
    groups.set(key, current)
  }
  return Array.from(groups, ([key, cases]) => ({ key, cases }))
}
