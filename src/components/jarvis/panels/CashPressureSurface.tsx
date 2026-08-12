"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, ChevronDown, CircleAlert, CreditCard, FileCheck2, RefreshCw, ShieldCheck, WalletCards } from "lucide-react"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { type Household360Projection, type InvoiceResource, type WorkCaseProjection } from "@/lib/jarvis-client"
import type { CashCollections } from "../lib/data-core"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { OperationalSurfaceNav, type HouseholdContext } from "../surfaces/OperationalSurfaceNav"
import "../jarvis-theme.css"

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

function invoiceAmount(invoice: InvoiceResource): number | null {
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
  return view === "active" ? workCase.status !== "Completed" : workCase.status === "Completed"
}

function workInvoiceId(workCase: WorkCaseProjection): string | null {
  return workCase.linkedEntities.find((entity) => entity.entityType === "invoice")?.entityId ?? null
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not recorded"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "Due date not recorded"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Due date not recorded"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
}

function sourceError(error: unknown): string {
  if (error instanceof JarvisApiError && error.status === 401) return "Sign in to inspect tenant cash pressure."
  return "The invoice ledger could not be read."
}

function invoiceContext(invoice: InvoiceResource, detail: Household360Projection | null): HouseholdContext {
  return { id: invoice.householdId, label: safeBusinessLabel(detail?.household.address, `Household ${shortId(invoice.householdId)}`) }
}

function collectionWorkTitle(workCase: WorkCaseProjection): string {
  const fallback = workCase.actions.map((action) => action.actionType.replaceAll("_", " ")).join(" · ") || "Collection work"
  return safeBusinessLabel(workCase.title, fallback)
}

function collectionsForBand(band: AgingBandSummary, collectionWork: WorkCaseProjection[]): WorkCaseProjection[] {
  const ids = new Set(band.invoiceIds)
  return collectionWork.filter((workCase) => {
    const invoiceId = workInvoiceId(workCase)
    return invoiceId ? ids.has(invoiceId) : false
  })
}

function workCaseHref(workCase: WorkCaseProjection): string {
  const params = new URLSearchParams({ workCaseId: workCase.id })
  const invoiceId = workInvoiceId(workCase)
  const householdId = workCase.linkedEntities.find((entity) => entity.entityType === "household")?.entityId
  if (invoiceId) params.set("invoiceId", invoiceId)
  if (householdId) params.set("householdId", householdId)
  return `/jarvis/work?${params.toString()}`
}

export default function CashPressureSurface() {
  const { session, loading: authLoading } = useJarvisAuth()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [invoiceView, setInvoiceView] = useState<InvoiceView>("open")
  const [collectionView, setCollectionView] = useState<CollectionView>("active")
  const [surfaceQuery] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search))
  const requestedInvoiceId = surfaceQuery.get("invoiceId")
  const requestedHouseholdId = surfaceQuery.get("householdId")
  const invoiceProjection = useBusinessProjection(businessProjections.invoices(), { enabled: Boolean(session) })
  const cashProjection = useBusinessProjection(businessProjections.cashCollections(), { enabled: Boolean(session) })
  const workProjection = useBusinessProjection(businessProjections.workCases(), { enabled: Boolean(session) })
  const invoices = useMemo<InvoiceResource[]>(() => invoiceProjection.data ?? [], [invoiceProjection.data])
  const cash: CashCollections | null = cashProjection.data
  const workCases = useMemo<WorkCaseProjection[]>(() => workProjection.data ?? [], [workProjection.data])
  const source = authLoading || (session && invoiceProjection.data === null && invoiceProjection.status !== "error")
    ? "loading"
    : !session || (invoiceProjection.error instanceof JarvisApiError && invoiceProjection.error.status === 401)
      ? "denied"
      : invoiceProjection.error && invoiceProjection.data === null
        ? "unavailable"
        : "live"
  const error = source === "denied" ? "Sign in to inspect tenant money." : source === "unavailable" ? sourceError(invoiceProjection.error) : null
  const load = () => { void Promise.allSettled([invoiceProjection.refresh(), cashProjection.refresh(), workProjection.refresh()]) }

  const sortedInvoices = useMemo(() => [...invoices].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, sent: 1, draft: 2, paid: 3, void: 4 }
    return (order[a.status] ?? 5) - (order[b.status] ?? 5) || new Date(a.dueDate ?? a.createdAt).getTime() - new Date(b.dueDate ?? b.createdAt).getTime()
  }), [invoices])
  const aging = useMemo(() => buildAgingSummary(invoices), [invoices])
  const collectionWork = useMemo(() => filterCollectionWork(workCases), [workCases])
  const visibleInvoices = useMemo(() => sortedInvoices.filter((invoice) => invoiceMatchesView(invoice, invoiceView)), [invoiceView, sortedInvoices])
  const visibleCollectionWork = useMemo(() => collectionWork.filter((workCase) => collectionMatchesView(workCase, collectionView)), [collectionView, collectionWork])
  const visibleCollectionGroups = useMemo(() => groupCollectionWork(visibleCollectionWork), [visibleCollectionWork])
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedId) ?? null
  const householdProjection = useBusinessProjection(businessProjections.household360(selectedInvoice?.householdId ?? "unselected"), { enabled: Boolean(session && selectedInvoice) })
  const householdDetail: Household360Projection | null = householdProjection.data
  const detailError = householdProjection.error ? sourceError(householdProjection.error) : null
  const loadingDetail = Boolean(selectedInvoice && householdProjection.data === null && householdProjection.status !== "error")
  const selectedWork = selectedInvoice ? collectionWork.filter((workCase) => workInvoiceId(workCase) === selectedInvoice.id) : []
  const context = selectedInvoice
    ? invoiceContext(selectedInvoice, householdDetail)
    : requestedHouseholdId
      ? { id: requestedHouseholdId, label: `Household ${shortId(requestedHouseholdId)}` }
      : undefined
  const openTotal = invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue").reduce((sum, invoice) => {
    const amount = invoiceAmount(invoice)
    return sum + (amount === null ? 0 : amount)
  }, 0)

  const selectInvoice = useCallback((invoice: InvoiceResource) => {
    setSelectedId(invoice.id)
    window.history.replaceState(null, "", `/jarvis/money?invoiceId=${encodeURIComponent(invoice.id)}&householdId=${encodeURIComponent(invoice.householdId)}`)
  }, [])

  useEffect(() => {
    if (selectedId || sortedInvoices.length === 0) return
    const requestedInvoice = requestedInvoiceId ? sortedInvoices.find((invoice) => invoice.id === requestedInvoiceId) : null
    if (requestedInvoice) {
      if (!invoiceMatchesView(requestedInvoice, invoiceView)) setInvoiceView("all")
      selectInvoice(requestedInvoice)
      return
    }
    const initialInvoice = visibleInvoices[0]
    if (initialInvoice) selectInvoice(initialInvoice)
  }, [invoiceView, requestedInvoiceId, selectInvoice, selectedId, sortedInvoices, visibleInvoices])

  useEffect(() => {
    if (!selectedId || visibleInvoices.some((invoice) => invoice.id === selectedId)) return
    const nextInvoice = visibleInvoices[0]
    if (nextInvoice) {
      selectInvoice(nextInvoice)
      return
    }
    setSelectedId(null)
    window.history.replaceState(null, "", "/jarvis/money")
  }, [selectInvoice, selectedId, visibleInvoices])

  if (authLoading || !session) {
    return (
      <main className="jarvis-money-shell" data-jarvis-cash-pressure>
        <OperationalSurfaceNav active="money" />
        <section className="jarvis-money-empty" role="status"><WalletCards size={24} aria-hidden /><h1>Cash Pressure is unavailable</h1><p>Sign in to inspect invoice due dates, amounts, collections Work, and evidence links.</p><Link href="/jarvis/login">Sign in</Link></section>
      </main>
    )
  }

  return (
    <main className="jarvis-money-shell" data-jarvis-cash-pressure>
      <OperationalSurfaceNav active="money" context={context} />
      <section className="jarvis-money-hero">
        <div><span className="jarvis-money-eyebrow">MONEY · CASH PRESSURE FIELD</span><h1>Where cash is stuck.</h1><p>Due-date and amount truth first. Collections Work shows what JARVIS is doing about it.</p></div>
        <div className="jarvis-money-hero__controls"><span className="jarvis-money-source" data-source-state={source}><span aria-hidden />{source === "live" ? "Source live" : source === "loading" ? "Reading ledger" : "Source unavailable"}</span><button type="button" onClick={() => void load()} aria-label="Refresh cash pressure"><RefreshCw size={15} aria-hidden /></button></div>
      </section>
      {error && <div className="jarvis-money-banner" role="status"><span>{error}</span><Link href="/jarvis/login">Sign in</Link></div>}

      <section className="jarvis-money-summary" aria-label="Cash pressure summary">
        <div><span>Open pressure</span><strong>{invoices.length > 0 ? formatMoney(openTotal) : "Not recorded"}</strong><small>sent + overdue invoice amounts</small></div>
        <div><span>Collected to date</span><strong>{cash ? formatMoney(cash.totalCollected) : "Not recorded"}</strong><small>successful payment records</small></div>
        <div><span>Overdue</span><strong className={aging.bands.find((band) => band.key === "1-30")?.count || aging.bands.find((band) => band.key === "31-60")?.count || aging.bands.find((band) => band.key === "61-90")?.count || aging.bands.find((band) => band.key === "90+")?.count ? "is-attention" : ""}>{aging.eligible ? formatMoney(aging.bands.filter((band) => band.key !== "current").reduce((sum, band) => sum + band.totalUsd, 0)) : "Not recorded"}</strong><small>{cash ? `${cash.paymentLinksAwaitingPayment} payment links in workflow` : "summary unavailable"}</small></div>
        <div><span>Collections Work</span><strong>{source === "live" ? collectionWork.length : "Not recorded"}</strong><small>exact invoice-to-cash action family</small></div>
      </section>

      <section className="jarvis-money-layout" aria-label="Cash pressure and invoices">
        <div className="jarvis-money-pressure-column">
          <section className="jarvis-money-pressure" aria-label="Cash pressure aging">
            <div className="jarvis-money-section-heading"><div><span className="jarvis-money-eyebrow">CASH PRESSURE</span><h2>{aging.eligible ? "Aging field" : "Honest invoice fallback"}</h2></div><span>{aging.eligible ? "due date + amount bound" : "aging withheld"}</span></div>
            {aging.eligible ? <div className="jarvis-money-aging-bands">{aging.bands.map((band) => {
              const maxTotal = Math.max(...aging.bands.map((candidate) => candidate.totalUsd), 1)
              const active = collectionsForBand(band, collectionWork)
              return <div className="jarvis-money-aging-band" key={band.key} data-aging-band={band.key}><div className="jarvis-money-aging-band__label"><strong>{band.label}</strong><span>{band.count} invoice{band.count === 1 ? "" : "s"}</span></div><strong className="jarvis-money-aging-band__amount">{formatMoney(band.totalUsd)}</strong><div className="jarvis-money-aging-band__bar"><span style={{ width: `${Math.max(0, Math.min(100, (band.totalUsd / maxTotal) * 100))}%` }} /></div><span className="jarvis-money-aging-band__work">{active.length > 0 ? `${active.length} collection Work` : "No collection Work linked"}</span></div>
            })}</div> : <div className="jarvis-money-fallback"><CircleAlert size={17} aria-hidden /><p>{aging.reason ?? "Invoice due-date truth is not sufficient for aging."}</p><span>The ledger below keeps each invoice&apos;s exact amount, status, and due-date availability without synthesizing bands.</span></div>}
          </section>

          <section className="jarvis-money-collections" aria-label="Collections Work">
            <div className="jarvis-money-section-heading"><div><span className="jarvis-money-eyebrow">COLLECTIONS WORK</span><h2>{collectionView === "active" ? "Active interventions" : "Recorded outcomes"}</h2></div><span>{visibleCollectionWork.length} records · {visibleCollectionGroups.length} groups</span></div>
            <div className="jarvis-money-view-switch" role="tablist" aria-label="Collections Work view"><button type="button" role="tab" aria-selected={collectionView === "active"} data-selected={collectionView === "active" ? "true" : undefined} onClick={() => setCollectionView("active")}>Active <span>{collectionWork.filter((workCase) => collectionMatchesView(workCase, "active")).length}</span></button><button type="button" role="tab" aria-selected={collectionView === "history"} data-selected={collectionView === "history" ? "true" : undefined} onClick={() => setCollectionView("history")}>History <span>{collectionWork.filter((workCase) => collectionMatchesView(workCase, "history")).length}</span></button></div>
            <div className="jarvis-money-work-list">{visibleCollectionGroups.length > 0 ? visibleCollectionGroups.map((group) => {
              const primary = group.cases[0]!
              if (group.cases.length === 1) return <Link key={group.key} className="jarvis-money-work-row" href={workCaseHref(primary)}><span className="jarvis-money-work-row__status">{primary.status}</span><span><strong>{collectionWorkTitle(primary)}</strong><small>{primary.actions.map((action) => action.actionType.replaceAll("_", " ")).join(" · ")}</small></span><span>{workInvoiceId(primary) ? `Invoice · ${shortId(workInvoiceId(primary)!)}` : "Invoice ID not recorded"}<ArrowUpRight size={13} aria-hidden /></span></Link>
              return <details key={group.key} className="jarvis-money-work-group"><summary className="jarvis-money-work-row"><span className="jarvis-money-work-row__status">{primary.status}</span><span><strong>{collectionWorkTitle(primary)}</strong><small>{primary.actions.map((action) => action.actionType.replaceAll("_", " ")).join(" · ")}</small></span><span>{group.cases.length} exact records<ChevronDown size={13} aria-hidden /></span></summary><div className="jarvis-money-work-group__records">{group.cases.map((workCase) => <Link key={workCase.id} href={workCaseHref(workCase)}><span>{workInvoiceId(workCase) ? `Invoice · ${shortId(workInvoiceId(workCase)!)}` : `Work · ${shortId(workCase.id)}`}</span><span>Open exact record <ArrowUpRight size={13} aria-hidden /></span></Link>)}</div></details>
            }) : <p className="jarvis-money-empty-copy">{collectionView === "active" && collectionWork.length > 0 ? "No collection intervention is active. Recorded outcomes remain available in History." : "No invoice-to-cash Work cases were returned for this view."}</p>}</div>
          </section>
        </div>

        <aside className="jarvis-money-invoices" aria-label="Invoice ledger">
          <div className="jarvis-money-section-heading"><div><span className="jarvis-money-eyebrow">INVOICES</span><h2>Decision ledger</h2></div><span>{visibleInvoices.length} of {invoices.length}</span></div>
          <div className="jarvis-money-view-switch" role="tablist" aria-label="Invoice ledger view">{(["open", "overdue", "paid", "all"] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={invoiceView === view} data-selected={invoiceView === view ? "true" : undefined} onClick={() => setInvoiceView(view)}>{view[0]!.toUpperCase() + view.slice(1)} <span>{sortedInvoices.filter((invoice) => invoiceMatchesView(invoice, view)).length}</span></button>)}</div>
          <div className="jarvis-money-invoice-list">{visibleInvoices.length > 0 ? visibleInvoices.map((invoice) => <button key={invoice.id} type="button" className="jarvis-money-invoice-row" data-selected={invoice.id === selectedId ? "true" : "false"} onClick={() => selectInvoice(invoice)}><span><strong>{formatMoney(invoiceAmount(invoice))}</strong><small>{safeBusinessLabel(invoice.memo, "Memo not recorded")}</small></span><span className="jarvis-money-invoice-row__due">{formatDate(invoice.dueDate)}</span><span className={`jarvis-money-invoice-status jarvis-money-invoice-status--${invoice.status}`}>{invoice.status}</span></button>) : <p className="jarvis-money-empty-copy">No invoice records match this view.</p>}</div>
          {selectedInvoice && <section className="jarvis-money-invoice-detail" aria-label="Selected invoice detail" data-invoice-id={selectedInvoice.id}>
            <div className="jarvis-money-section-heading"><div><span className="jarvis-money-eyebrow">SELECTED INVOICE</span><h2>{formatMoney(invoiceAmount(selectedInvoice))} · {selectedInvoice.status}</h2></div><span>{shortId(selectedInvoice.id)}</span></div>
            <div className="jarvis-money-detail-grid">
              <div><span>Customer ID</span><strong>{shortId(selectedInvoice.householdId)}</strong><Link href={`/jarvis/customers?householdId=${encodeURIComponent(selectedInvoice.householdId)}`}>Open Household 360 <ArrowUpRight size={13} aria-hidden /></Link></div>
              <div><span>Due</span><strong>{formatDate(selectedInvoice.dueDate)}</strong><small>Created {formatDate(selectedInvoice.createdAt)}</small></div>
              <div><span>Related Work</span>{selectedWork.length > 0 ? selectedWork.map((workCase) => <Link key={workCase.id} href={workCaseHref(workCase)}>{collectionWorkTitle(workCase)} · {shortId(workCase.id)} <ArrowUpRight size={13} aria-hidden /></Link>) : <small>No exact invoice-linked Work case recorded.</small>}</div>
              <div><span>Evidence</span>{selectedWork.flatMap((workCase) => workCase.receipts).length > 0 ? selectedWork.flatMap((workCase) => workCase.receipts).map((receipt) => {
                const owningCase = selectedWork.find((workCase) => workCase.receipts.some((candidate) => candidate.id === receipt.id))
                return <Link key={receipt.id} href={owningCase ? `${workCaseHref(owningCase)}&receiptId=${encodeURIComponent(receipt.id)}` : `/jarvis/work?receiptId=${encodeURIComponent(receipt.id)}`}><FileCheck2 size={13} aria-hidden />Receipt · {shortId(receipt.id)} <ArrowUpRight size={13} aria-hidden /></Link>
              }) : <small>No receipt is recorded for this invoice-linked Work.</small>}</div>
            </div>
            {loadingDetail && <p className="jarvis-money-detail-note">Reading exact payment and communication records for this household…</p>}
            {detailError && <p className="jarvis-money-detail-note jarvis-money-detail-note--warning">{detailError}</p>}
            {householdDetail && <div className="jarvis-money-payment-facts"><div><ShieldCheck size={14} aria-hidden /><span>{householdDetail.invoices.find((invoice) => invoice.id === selectedInvoice.id)?.payments.length ?? "No"} payment event records</span></div><div><CreditCard size={14} aria-hidden /><span>{householdDetail.conversations.length} conversation records · {householdDetail.legacyCommunications.length} legacy communication records</span></div><span>Payment recording remains behind the existing instruction and authority path.</span></div>}
          </section>}
        </aside>
      </section>
    </main>
  )
}
