import type { WorkCaseProjection } from "@/lib/jarvis-client"
import type { Stop } from "./DispatchMap"

export type DispatchSourceState = "loading" | "live" | "unavailable"

export function dispatchSourceState(input: { data: unknown; loading: boolean; error: string | null }): DispatchSourceState {
  if (input.data !== null && input.data !== undefined) return "live"
  if (input.loading) return "loading"
  return "unavailable"
}

export function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return value
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function exactWorkCaseForStop(stop: Stop, cases: WorkCaseProjection[]): WorkCaseProjection | null {
  const entityTypes = stop.sourceKind === "appointment" ? ["appointment"] : ["visit", "service_visit"]
  return cases.find((workCase) => workCase.linkedEntities.some((entity) => entityTypes.includes(entity.entityType) && entity.entityId === stop.visitId)) ?? null
}

export function workEntityIds(workCase: WorkCaseProjection | null, entityType: string): string[] {
  return workCase?.linkedEntities.filter((entity) => entity.entityType === entityType).map((entity) => entity.entityId) ?? []
}

export interface DispatchFocusQuery {
  householdId: string | null
  visitId: string | null
  serviceVisitId: string | null
  workOrderId: string | null
  appointmentId: string | null
}

export function dispatchStopMatchesFocus(stop: Stop, workCase: WorkCaseProjection | null, focus: DispatchFocusQuery): boolean {
  if (focus.householdId && stop.householdId !== focus.householdId) return false
  if (focus.visitId && stop.visitId !== focus.visitId) return false
  if (focus.serviceVisitId && (stop.sourceKind !== "service_visit" || stop.visitId !== focus.serviceVisitId)) return false
  if (focus.workOrderId && !workEntityIds(workCase, "work_order").includes(focus.workOrderId)) return false
  if (focus.appointmentId && !workEntityIds(workCase, "appointment").includes(focus.appointmentId)) return false
  return true
}
