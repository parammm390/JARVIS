"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, ArrowUpRight, CalendarDays, CircleAlert, CreditCard, House, MapPin, RefreshCw, Search, Wrench } from "lucide-react"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { type Household360Projection, type HouseholdResource, type WorkCaseProjection } from "@/lib/jarvis-client"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { OperationalSurfaceNav, withOperationalContext, type HouseholdContext } from "../surfaces/OperationalSurfaceNav"
import { HOUSEHOLD_BANDS, formatHouseholdDate, formatHouseholdDateTime, formatHouseholdUsd, householdDisplayName, summarizeHousehold } from "./household360-model"
import "../jarvis-theme.css"

type SourceState = "loading" | "live" | "denied" | "unavailable"

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function rowName(row: HouseholdResource): string {
  return householdDisplayName(row)
}

function rowContext(row: HouseholdResource, projection: Household360Projection | null): HouseholdContext {
  return { id: row.id, label: householdDisplayName(projection?.household ?? row, projection?.contacts ?? []) }
}

function sourceCopy(source: SourceState): string {
  if (source === "live") return "Source live"
  if (source === "loading") return "Reading households"
  if (source === "denied") return "Source unavailable"
  return "Source unavailable"
}

function errorCopy(error: unknown): string {
  if (error instanceof JarvisApiError && error.status === 401) return "Sign in to inspect the tenant Household 360."
  return "The household projection could not be read."
}

function serviceEquipmentTimeline(projection: Household360Projection): Array<{ id: string; at: string; label: string; source: string; detail?: string }> {
  const equipmentRows = projection.equipment
    .filter((item) => item.installDate)
    .map((item) => ({ id: item.id, at: item.installDate!, label: `Installed · ${humanize(item.type)}${item.model ? ` · ${item.model}` : ""}`, source: "equipment" }))
  const visits = projection.serviceVisits
    .flatMap((visit) => {
      const at = visit.completedAt ?? visit.scheduledAt
      return at ? [{ id: visit.id, at, label: `${visit.completedAt ? "Service completed" : "Service scheduled"} · ${humanize(visit.type)}`, source: "service visit", detail: visit.notes?.slice(0, 140) }] : []
    })
  const events = projection.timeline.map((event) => ({ id: event.entityId, at: event.occurredAt, label: humanize(event.eventType), source: event.entityType }))
  return [...equipmentRows, ...visits, ...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20)
}

function callOutcome(call: Household360Projection["calls"][number]): string {
  const outcome = call.raw.outcome
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return call.endedReason ?? "Outcome not recorded"
  const value = (outcome as Record<string, unknown>).outcome
  return typeof value === "string" ? humanize(value) : call.endedReason ?? "Outcome not recorded"
}

export default function Household360Surface() {
  const { session, loading: authLoading } = useJarvisAuth()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [surfaceSearch, setSurfaceSearch] = useState("")
  const householdIndex = useBusinessProjection(businessProjections.households(), { enabled: Boolean(session) })
  const workProjection = useBusinessProjection(businessProjections.workCases(), { enabled: Boolean(session) })
  const detailProjection = useBusinessProjection(businessProjections.household360(selectedId ?? "unselected"), { enabled: Boolean(session && selectedId) })
  const rows = useMemo<HouseholdResource[]>(() => householdIndex.data ?? [], [householdIndex.data])
  const workCases: WorkCaseProjection[] | null = workProjection.data
  const surfaceQuery = useMemo(() => new URLSearchParams(surfaceSearch), [surfaceSearch])
  const requestedWorkCaseId = surfaceQuery.get("workCaseId")
  const source: SourceState = authLoading || (session && householdIndex.data === null && householdIndex.status !== "error")
    ? "loading"
    : !session || (householdIndex.error instanceof JarvisApiError && householdIndex.error.status === 401)
      ? "denied"
      : householdIndex.error && householdIndex.data === null
        ? "unavailable"
        : "live"
  const listError = source === "denied" ? "Sign in to inspect the tenant Household 360." : source === "unavailable" ? errorCopy(householdIndex.error) : null
  const loadingDetail = Boolean(selectedId && detailProjection.data === null && detailProjection.status !== "error")
  const detailError = detailProjection.error ? errorCopy(detailProjection.error) : null

  const loadIndex = () => {
    void Promise.allSettled([householdIndex.refresh(), workProjection.refresh()])
  }

  useEffect(() => {
    const syncSurfaceSearch = () => setSurfaceSearch(window.location.search)
    syncSurfaceSearch()
    window.addEventListener("popstate", syncSurfaceSearch)
    return () => window.removeEventListener("popstate", syncSurfaceSearch)
  }, [])

  useEffect(() => {
    if (requestedWorkCaseId && workProjection.data === null) return
    const requestedCase = requestedWorkCaseId ? workCases?.find((workCase) => workCase.id === requestedWorkCaseId || workCase.root.id === requestedWorkCaseId) : null
    const requestedId = surfaceQuery.get("householdId") ?? requestedCase?.linkedEntities.find((entity) => entity.entityType === "household")?.entityId ?? null
    if (requestedId && rows.some((row) => row.id === requestedId)) {
      setSelectedId(requestedId)
      return
    }
    if (requestedWorkCaseId) {
      setSelectedId(null)
      return
    }
    setSelectedId((current) => {
      if (current && rows.some((row) => row.id === current)) return current
      return rows.find((row) => row.marketingConsent)?.id ?? rows[0]?.id ?? null
    })
  }, [requestedWorkCaseId, rows, surfaceQuery, workCases, workProjection.data])

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null
  const selectedProjection = selectedId ? detailProjection.data : null
  const context = selectedRow ? rowContext(selectedRow, selectedProjection) : undefined
  const selectedSummary = selectedProjection ? summarizeHousehold(selectedProjection, workCases) : null
  const indexRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return rows
    return rows.filter((row) => [rowName(row), row.address, row.id].join(" ").toLocaleLowerCase().includes(query))
  }, [rows, search])

  function selectHousehold(id: string) {
    setSelectedId(id)
    const next = withOperationalContext("/jarvis/customers", { id, label: "" }, requestedWorkCaseId)
    window.history.replaceState(null, "", next)
    setSurfaceSearch(new URL(next, window.location.origin).search)
  }

  return (
    <main className="jarvis-household-shell" data-jarvis-household-360>
      <OperationalSurfaceNav active="customers" context={context} workCaseId={requestedWorkCaseId} />
      <section className="jarvis-household-intro">
        <div>
          <p className="jarvis-household-eyebrow">CUSTOMERS · HOUSEHOLD 360</p>
          <h1>One household, one operational record.</h1>
          <p className="jarvis-household-intro__copy">Identity, equipment, service history, work, and money held to the exact household ID.</p>
        </div>
        <div className="jarvis-household-intro__right">
          <span className="jarvis-household-source" data-source-state={source}><span aria-hidden />{sourceCopy(source)}</span>
          <button className="jarvis-household-refresh" type="button" onClick={() => void loadIndex()} aria-label="Refresh households">
            <RefreshCw size={15} aria-hidden />
          </button>
        </div>
      </section>

      <div className="jarvis-household-banner" role={listError ? "status" : undefined}>
        {listError ? <><span>{listError}</span><Link href="/jarvis/login">Sign in</Link></> : <><span>Exact household links only · no name-based merging</span><span>{rows.length} household{rows.length === 1 ? "" : "s"} observed</span></>}
      </div>

      <section className="jarvis-household-layout" aria-label="Household 360 workspace">
        <div className="jarvis-household-index-region">
          <div className="jarvis-household-section-heading">
            <div><span className="jarvis-household-eyebrow">INDEX</span><h2>Households</h2></div>
            <span className="jarvis-household-count">{indexRows.length} / {rows.length}</span>
          </div>
          <label className="jarvis-household-search"><Search size={15} aria-hidden /><span className="sr-only">Search households</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, address, or exact ID" /></label>
          <div className="jarvis-household-index-table" aria-label="Household operational index" tabIndex={0}>
            <div>
              <div className="jarvis-household-index-head">
                <span>Household</span><span>Consent</span><span>Location</span><span>Exact record</span>
              </div>
            </div>
            <div>
              {indexRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="jarvis-household-index-row"
                    data-selected={selectedId === row.id ? "true" : "false"}
                    data-household-id={row.id}
                    onClick={() => selectHousehold(row.id)}
                  >
                    <span className="jarvis-household-index-primary"><strong>{rowName(row)}</strong><small><MapPin size={11} aria-hidden />{row.address}</small><em>{shortId(row.id)}</em></span>
                    <span className={row.marketingConsent ? "jarvis-household-consent-state is-recorded" : "jarvis-household-consent-state"}>{row.marketingConsent ? "Recorded" : "Not recorded"}</span>
                    <span className={row.latitude !== null && row.longitude !== null ? "jarvis-household-location-state is-placed" : "jarvis-household-location-state"}>{row.latitude !== null && row.longitude !== null ? "Mapped" : "Unplaced"}</span>
                    <span className="jarvis-household-record-action"><strong>{shortId(row.id)}</strong><small>Open 360 <ArrowUpRight size={11} aria-hidden /></small></span>
                  </button>
              ))}
            </div>
            {source === "loading" && <div className="jarvis-household-empty">Reading exact household records…</div>}
            {source !== "loading" && indexRows.length === 0 && <div className="jarvis-household-empty">{rows.length === 0 ? "No household records were returned. The surface did not invent an index row." : "No household matches this search."}</div>}
          </div>
        </div>

        <div className="jarvis-household-detail-region">
          {!selectedId && <div className="jarvis-household-detail-empty"><House size={22} aria-hidden /><h2>Select a household</h2><p>The continuous 360 record opens here after an exact household ID is selected.</p></div>}
          {selectedId && loadingDetail && <div className="jarvis-household-detail-empty"><RefreshCw size={19} className="jarvis-household-spin" aria-hidden /><h2>Reading Household 360</h2><p>Following the exact household ID through the existing read model.</p></div>}
          {selectedId && detailError && !loadingDetail && <div className="jarvis-household-error" role="alert"><CircleAlert size={18} aria-hidden /><span>{detailError}</span></div>}
          {selectedProjection && selectedSummary && !loadingDetail && (
            <div className="jarvis-household-detail" data-household-detail-id={selectedProjection.household.id}>
              <section className="jarvis-household-band jarvis-household-identity-band">
                <div className="jarvis-household-band-heading"><span className="jarvis-household-eyebrow">{HOUSEHOLD_BANDS[0]}</span><span className="jarvis-household-record-id">Household ID · {selectedProjection.household.id}</span></div>
                <div className="jarvis-household-identity-grid">
                  <div><h2>{householdDisplayName(selectedProjection.household, selectedProjection.contacts)}</h2><p><MapPin size={13} aria-hidden />{selectedProjection.household.address}</p></div>
                  <div className="jarvis-household-consent" data-consent={selectedProjection.household.marketingConsent ? "true" : "false"}>{selectedProjection.household.marketingConsent ? "Marketing consent recorded" : "No marketing consent recorded"}</div>
                </div>
                <div className="jarvis-household-contact-line">
                  {selectedProjection.contacts.length > 0 ? selectedProjection.contacts.map((contact) => <span key={contact.id}><strong>{contact.name}</strong>{contact.role ? ` · ${contact.role}` : ""}{contact.methods.length > 0 ? ` · ${contact.methods.map((method) => method.value).join(" · ")}` : ""}</span>) : <span>No contact records recorded.</span>}
                </div>
                <div className="jarvis-household-id-line">Created {formatHouseholdDate(selectedProjection.household.createdAt)} · exact source path `/read-models/household-360?householdId={selectedProjection.household.id}`</div>
              </section>

              <section className="jarvis-household-band">
                <div className="jarvis-household-band-heading"><span className="jarvis-household-eyebrow">{HOUSEHOLD_BANDS[1]}</span><span className="jarvis-household-band-note">Equipment attaches to the service timeline</span></div>
                <div className="jarvis-household-equipment-strip">
                  {selectedProjection.equipment.length > 0 ? selectedProjection.equipment.map((item) => <span key={item.id}><Wrench size={13} aria-hidden /><strong>{humanize(item.type)}</strong>{item.model ? ` · ${item.model}` : ""}<small>{item.source} · {formatHouseholdDate(item.installDate)}</small></span>) : <span className="jarvis-household-muted">No equipment records recorded.</span>}
                </div>
                <div className="jarvis-household-timeline" aria-label="Service and equipment timeline">
                  {serviceEquipmentTimeline(selectedProjection).map((event, index) => <div className="jarvis-household-timeline-row" key={`${event.id}-${event.at}-${index}`}><span className="jarvis-household-timeline-marker" aria-hidden /><span><strong>{event.label}</strong><small>{event.source} · {shortId(event.id)}{event.detail ? ` · ${event.detail}` : ""}</small></span><time dateTime={event.at}>{formatHouseholdDateTime(event.at)}</time></div>)}
                  {serviceEquipmentTimeline(selectedProjection).length === 0 && <p className="jarvis-household-muted">No service, install, or business-event timeline records recorded.</p>}
                </div>
              </section>

              <section className="jarvis-household-band">
                <div className="jarvis-household-band-heading"><span className="jarvis-household-eyebrow">{HOUSEHOLD_BANDS[2]}</span><span className="jarvis-household-band-note">Current facts only · no inferred health score</span></div>
                <div className="jarvis-household-state-grid">
                  <div><span>Open Work</span><strong>{selectedSummary.openWorkCount}</strong><small>{workCases ? "linked Work cases" : "open work orders"}</small></div>
                  <div><span>Next service</span><strong>{formatHouseholdDate(selectedSummary.nextService)}</strong><small>{selectedSummary.nextServiceId ? `source · ${shortId(selectedSummary.nextServiceId)}` : "No scheduled service"}</small></div>
                  <div><span>Open balance</span><strong>{formatHouseholdUsd(selectedSummary.openBalanceUsd)}</strong><small>{selectedProjection.invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue").length} open invoice records</small></div>
                  <div data-alert={selectedSummary.alert === "No alert recorded" ? "none" : "attention"}><span>Alert</span><strong>{selectedSummary.alert}</strong><small>derived from exact status records</small></div>
                </div>
                <div className="jarvis-household-evidence-grid" aria-label="Exact customer history">
                  <section>
                    <div className="jarvis-household-evidence-heading"><span>MONEY HISTORY</span><small>Created, due, and paid are kept separate</small></div>
                    {selectedProjection.invoices.length > 0 ? [...selectedProjection.invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((invoice) => (
                      <div className="jarvis-household-evidence-row" key={invoice.id}>
                        <span><strong>{formatHouseholdUsd(invoice.amountUsd)} · {humanize(invoice.status)}</strong><small>Created {formatHouseholdDateTime(invoice.createdAt)} · Due {formatHouseholdDateTime(invoice.dueDate)}{invoice.memo ? ` · ${invoice.memo}` : ""}</small></span>
                        <span>{invoice.payments.length > 0 ? `Paid ${formatHouseholdDateTime(invoice.payments[0]!.receivedAt)}` : "No payment event"}</span>
                      </div>
                    )) : <p className="jarvis-household-muted">No invoice history recorded.</p>}
                  </section>
                  <section>
                    <div className="jarvis-household-evidence-heading"><span>CALLS & EXPERIENCE</span><small>Provider outcome and exact interaction time</small></div>
                    {selectedProjection.calls.length > 0 ? selectedProjection.calls.slice(0, 6).map((call) => (
                      <div className="jarvis-household-evidence-row" key={call.id}>
                        <span><strong>{humanize(call.direction)} · {callOutcome(call)}</strong><small>{call.transcript ? call.transcript.replace(/\s+/g, " ").slice(0, 150) : "No transcript recorded"}</small></span>
                        <time dateTime={call.startedAt ?? undefined}>{formatHouseholdDateTime(call.startedAt)}</time>
                      </div>
                    )) : selectedProjection.legacyCommunications.length > 0 ? [...selectedProjection.legacyCommunications].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6).map((communication) => (
                      <div className="jarvis-household-evidence-row" key={communication.id}>
                        <span><strong>{humanize(communication.direction)} · {humanize(communication.channel)}</strong><small>{communication.content.slice(0, 150)}</small></span>
                        <time dateTime={communication.timestamp}>{formatHouseholdDateTime(communication.timestamp)}</time>
                      </div>
                    )) : <p className="jarvis-household-muted">No calls or communication history recorded.</p>}
                  </section>
                </div>
                <div className="jarvis-household-business-links" aria-label="Household operational destinations">
                  <Link href={withOperationalContext("/jarvis/work", { id: selectedProjection.household.id, label: "" }, requestedWorkCaseId)}><Wrench size={14} aria-hidden />Work<ArrowUpRight size={13} aria-hidden /></Link>
                  <Link href={withOperationalContext("/jarvis/schedule", { id: selectedProjection.household.id, label: "" }, requestedWorkCaseId)}><CalendarDays size={14} aria-hidden />Schedule<ArrowUpRight size={13} aria-hidden /></Link>
                  <Link href={withOperationalContext("/jarvis/money", { id: selectedProjection.household.id, label: "" }, requestedWorkCaseId)}><CreditCard size={14} aria-hidden />Money<ArrowUpRight size={13} aria-hidden /></Link>
                </div>
                <div className="jarvis-household-recent-line"><Activity size={14} aria-hidden /><span>{selectedProjection.calls.length} call record{selectedProjection.calls.length === 1 ? "" : "s"} · {selectedProjection.conversations.length} conversation record{selectedProjection.conversations.length === 1 ? "" : "s"} · {selectedProjection.documents.length} document record{selectedProjection.documents.length === 1 ? "" : "s"} · {selectedProjection.legacyCommunications.length} legacy communication record{selectedProjection.legacyCommunications.length === 1 ? "" : "s"}</span></div>
              </section>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
