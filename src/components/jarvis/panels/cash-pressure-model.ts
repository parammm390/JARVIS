import type { InvoiceResource, WorkCaseProjection } from "@/lib/jarvis-client"

export const COLLECTION_ACTION_TYPES = ["start_invoice_to_cash_workflow", "create_invoice", "send_payment_reminder", "record_payment", "call_overdue_invoices"] as const
export const AGE_BANDS = [
  { key: "current", label: "Current" },
  { key: "1-30", label: "1–30" },
  { key: "31-60", label: "31–60" },
  { key: "61-90", label: "61–90" },
  { key: "90+", label: "90+" },
] as const

export type AgeBandKey = (typeof AGE_BANDS)[number]["key"]
export type InvoiceView = "open" | "overdue" | "paid" | "all"
export type CollectionView = "active" | "history"
export type CollectionWorkSource = "idle" | "live" | "loading" | "unavailable"

export interface AgingBandSummary {
  key: AgeBandKey
  label: string
  invoiceIds: string[]
  count: number
  totalUsd: number
}

export interface AgingSummary {
  eligible: boolean
  reason: string | null
  bands: AgingBandSummary[]
}

export interface CollectionWorkGroup {
  key: string
  cases: WorkCaseProjection[]
}

export function safeBusinessLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim()
  if (!normalized || /\b(?:undefined|null|nan)\b/i.test(normalized)) return fallback
  return normalized
}

export function invoiceAmount(invoice: InvoiceResource): number | null {
  const value = Number(invoice.amountUsd)
  return Number.isFinite(value) ? value : null
}

export function deriveAgingBand(dueDate: string | null, now = new Date()): AgeBandKey | "unknown" {
  if (!dueDate) return "unknown"
  const due = new Date(dueDate)
  if (!Number.isFinite(due.getTime())) return "unknown"
  const daysPastDue = Math.floor((now.getTime() - due.getTime()) / 86_400_000)
  if (daysPastDue <= 0) return "current"
  if (daysPastDue <= 30) return "1-30"
  if (daysPastDue <= 60) return "31-60"
  if (daysPastDue <= 90) return "61-90"
  return "90+"
}

export function buildAgingSummary(invoices: InvoiceResource[], now = new Date()): AgingSummary {
  const openInvoices = invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue")
  const bands: AgingBandSummary[] = AGE_BANDS.map((band) => ({ key: band.key, label: band.label, invoiceIds: [], count: 0, totalUsd: 0 }))
  if (openInvoices.length === 0) return { eligible: false, reason: "No open invoice records were returned for aging.", bands }
  const invalid = openInvoices.find((invoice) => deriveAgingBand(invoice.dueDate, now) === "unknown" || invoiceAmount(invoice) === null)
  if (invalid) return { eligible: false, reason: "Aging unavailable — one or more open invoice records has no usable due date or amount.", bands }
  for (const invoice of openInvoices) {
    const key = deriveAgingBand(invoice.dueDate, now)
    if (key === "unknown") continue
    const band = bands.find((candidate) => candidate.key === key)
    const amount = invoiceAmount(invoice)
    if (!band || amount === null) continue
    band.invoiceIds.push(invoice.id)
    band.count += 1
    band.totalUsd += amount
  }
  return { eligible: true, reason: null, bands }
}

export function filterCollectionWork(workCases: WorkCaseProjection[]): WorkCaseProjection[] {
  return workCases.filter((workCase) => workCase.actions.some((action) => COLLECTION_ACTION_TYPES.includes(action.actionType as (typeof COLLECTION_ACTION_TYPES)[number])))
}

export function groupCollectionWork(workCases: WorkCaseProjection[]): CollectionWorkGroup[] {
  const groups = new Map<string, WorkCaseProjection[]>()
  for (const workCase of workCases) {
    const actionFamily = [...new Set(workCase.actions.map((action) => action.actionType))].sort().join(",") || "no-action"
    const title = safeBusinessLabel(workCase.title, actionFamily).toLocaleLowerCase().replace(/\s+/g, " ")
    const key = [workCase.status, actionFamily, title].join("|")
    const group = groups.get(key) ?? []
    group.push(workCase)
    groups.set(key, group)
  }
  return Array.from(groups, ([key, cases]) => ({ key, cases }))
}

export function invoiceMatchesView(invoice: InvoiceResource, view: InvoiceView): boolean {
  if (view === "open") return invoice.status === "sent" || invoice.status === "overdue"
  if (view === "overdue") return invoice.status === "overdue"
  if (view === "paid") return invoice.status === "paid"
  return true
}

export function collectionMatchesView(workCase: WorkCaseProjection, view: CollectionView): boolean {
  const recordedOutcome = ["Completed", "Partial", "Cancelled"].includes(workCase.status)
  return view === "active" ? !recordedOutcome : recordedOutcome
}

export function collectionWorkBandLabel(source: CollectionWorkSource, count: number): string {
  if (source === "loading") return "Reading collection Work…"
  if (source === "unavailable") return "Collection Work unavailable"
  return count > 0 ? `${count} collection Work` : "No collection Work linked"
}
