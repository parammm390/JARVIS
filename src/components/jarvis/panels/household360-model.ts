import type { Household360Projection, HouseholdResource, WorkCaseProjection } from "@/lib/jarvis-client"

export const HOUSEHOLD_BANDS = ["IDENTITY", "SERVICE & EQUIPMENT", "CURRENT BUSINESS STATE"] as const

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function formatHouseholdDate(iso: string | null): string {
  if (!iso) return "Not recorded"
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return "Not recorded"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
}

export function formatHouseholdDateTime(iso: string | null): string {
  if (!iso) return "Not recorded"
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return "Not recorded"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}

export function formatHouseholdUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

export function householdDisplayName(source: HouseholdResource | Household360Projection["household"], contacts: Household360Projection["contacts"] = []): string {
  const contactInfo = source.contactInfo
  if (typeof contactInfo.name === "string" && contactInfo.name.trim()) return contactInfo.name.trim()
  const primary = contacts.find((contact) => contact.role === "primary") ?? contacts[0]
  return primary?.name ?? "Unnamed household"
}

export interface HouseholdSummary {
  equipment: string
  lastService: string | null
  nextService: string | null
  nextServiceId: string | null
  openWorkCount: number
  openBalanceUsd: number
  alert: string
}

function isOpenWorkStatus(status: WorkCaseProjection["status"]): boolean {
  return status === "Needs you" || status === "Working" || status === "Waiting" || status === "Blocked"
}

export function summarizeHousehold(
  projection: Household360Projection,
  workCases: WorkCaseProjection[] | null = null,
  now = new Date(),
): HouseholdSummary {
  const equipment = projection.equipment.length > 0
    ? projection.equipment.map((item) => `${humanize(item.type)}${item.model ? ` · ${item.model}` : ""}`).join(" · ")
    : "No equipment recorded"
  const completedVisits = projection.serviceVisits.filter((visit) => visit.completedAt).sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
  const lastService = completedVisits[0]?.completedAt ?? null
  const futureService = [
    ...projection.serviceVisits.filter((visit) => visit.scheduledAt && new Date(visit.scheduledAt).getTime() >= now.getTime()).map((visit) => ({ id: visit.id, at: visit.scheduledAt! })),
    ...projection.workOrders.filter((workOrder) => workOrder.scheduledAt && new Date(workOrder.scheduledAt).getTime() >= now.getTime()).map((workOrder) => ({ id: workOrder.id, at: workOrder.scheduledAt! })),
    ...projection.appointments.filter((appointment) => new Date(appointment.scheduledAt).getTime() >= now.getTime()).map((appointment) => ({ id: appointment.id, at: appointment.scheduledAt })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const openBalanceUsd = projection.invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue").reduce((total, invoice) => {
    const succeeded = invoice.payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amountUsd, 0)
    return total + Math.max(0, invoice.amountUsd - succeeded)
  }, 0)
  const linkedWorkCases = workCases?.filter((workCase) => workCase.linkedEntities.some((entity) => entity.entityType === "household" && entity.entityId === projection.household.id))
  const openWorkCount = linkedWorkCases
    ? linkedWorkCases.filter((workCase) => isOpenWorkStatus(workCase.status)).length
    : projection.workOrders.filter((workOrder) => workOrder.status !== "completed" && workOrder.status !== "canceled").length
  const overdueCount = projection.invoices.filter((invoice) => invoice.status === "overdue").length
  const inProgress = projection.workOrders.some((workOrder) => workOrder.status === "in_progress")
  const alert = overdueCount > 0 ? `${overdueCount} overdue invoice${overdueCount === 1 ? "" : "s"}` : inProgress ? "Work order in progress" : "No alert recorded"
  return { equipment, lastService, nextService: futureService[0]?.at ?? null, nextServiceId: futureService[0]?.id ?? null, openWorkCount, openBalanceUsd, alert }
}
