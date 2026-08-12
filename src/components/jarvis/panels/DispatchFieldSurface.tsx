"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleDot, MapPinned, RefreshCw, Route, Wrench } from "lucide-react"
import { DispatchMapCore, type MapData, type Stop } from "./DispatchMap"
import { MyDay } from "./MyDay"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import type { WorkCaseProjection } from "@/lib/jarvis-client"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { OperationalSurfaceNav, type HouseholdContext } from "../surfaces/OperationalSurfaceNav"
import "../jarvis-theme.css"

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return value
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function stopTime(value: string | null): string {
  if (!value) return "Time not recorded"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Time not recorded"
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)
}

export function exactWorkCaseForStop(stop: Stop, cases: WorkCaseProjection[]): WorkCaseProjection | null {
  const entityTypes = stop.sourceKind === "appointment" ? ["appointment"] : ["visit", "service_visit"]
  return cases.find((workCase) => workCase.linkedEntities.some((entity) => entityTypes.includes(entity.entityType) && entity.entityId === stop.visitId)) ?? null
}

export function workEntityIds(workCase: WorkCaseProjection | null, entityType: string): string[] {
  return workCase?.linkedEntities.filter((entity) => entity.entityType === entityType).map((entity) => entity.entityId) ?? []
}

function stopContext(stop: Stop | null): HouseholdContext | undefined {
  return stop ? { id: stop.householdId, label: stop.address } : undefined
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

function dispatchErrorCopy(error: unknown): string {
  if (error instanceof JarvisApiError && error.status === 401) return "Sign in to inspect the tenant Dispatch Field."
  if (error instanceof JarvisApiError && error.status === 403) return "Dispatch is available to owner and dispatcher accounts."
  return "The stored-coordinate dispatch projection could not be read."
}

function linksForStop(stop: Stop, workCase: WorkCaseProjection | null): Array<{ href: string; label: string }> {
  const workOrderId = workEntityIds(workCase, "work_order")[0]
  const appointmentId = workEntityIds(workCase, "appointment")[0]
  return [
    { href: `/jarvis/customers?householdId=${encodeURIComponent(stop.householdId)}`, label: `Customer · ${shortId(stop.householdId)}` },
    { href: `/jarvis/work?householdId=${encodeURIComponent(stop.householdId)}&${stop.sourceKind === "appointment" ? "appointmentId" : "visitId"}=${encodeURIComponent(stop.visitId)}`, label: `Work · ${stop.sourceKind === "appointment" ? "appointment" : "visit"} ${shortId(stop.visitId)}` },
    ...(workOrderId ? [{ href: `/jarvis/work?householdId=${encodeURIComponent(stop.householdId)}&workOrderId=${encodeURIComponent(workOrderId)}`, label: `Job · ${shortId(workOrderId)}` }] : []),
    ...(appointmentId ? [{ href: `/jarvis/work?householdId=${encodeURIComponent(stop.householdId)}&appointmentId=${encodeURIComponent(appointmentId)}`, label: `Appointment · ${shortId(appointmentId)}` }] : []),
  ]
}

function StopRow({ stop, workCase, focused = false }: { stop: Stop; workCase: WorkCaseProjection | null; focused?: boolean }) {
  const links = linksForStop(stop, workCase)
  return (
    <article className="jarvis-dispatch-stop-row" data-visit-id={stop.visitId} data-household-id={stop.householdId} data-focused={focused ? "true" : "false"}>
      <div className="jarvis-dispatch-stop-row__main">
        <span className="jarvis-dispatch-stop-row__time">{stopTime(stop.scheduledAt)}</span>
        <div>
          <strong>{stop.type.replaceAll("_", " ")}</strong>
          <span>{stop.address}</span>
        </div>
      </div>
      <div className="jarvis-dispatch-stop-row__ids">
        <span><CircleDot size={11} aria-hidden /> {stop.sourceKind === "appointment" ? "Appointment" : "Visit"} {shortId(stop.visitId)}</span>
        {workCase ? <span className="jarvis-dispatch-stop-row__linked"><Wrench size={11} aria-hidden /> Work {shortId(workCase.id)}</span> : <span className="jarvis-dispatch-stop-row__unlinked">No exact Work case linked</span>}
      </div>
      <div className="jarvis-dispatch-stop-row__links">
        {links.map((link) => <Link key={link.href} href={link.href}>{link.label}<ArrowUpRight size={11} aria-hidden /></Link>)}
      </div>
    </article>
  )
}

function UnauthenticatedSchedule() {
  return (
    <main className="jarvis-dispatch-shell" data-jarvis-dispatch-field>
      <OperationalSurfaceNav active="schedule" />
      <section className="jarvis-dispatch-empty" role="status">
        <MapPinned size={24} aria-hidden />
        <h1>Dispatch Field is unavailable</h1>
        <p>Sign in to inspect stored appointments, route evidence, and exact customer/Work links.</p>
        <Link href="/jarvis/login">Sign in</Link>
      </section>
    </main>
  )
}

export default function DispatchFieldSurface() {
  const { session, role, loading: authLoading } = useJarvisAuth()
  const [date, setDate] = useState(isoToday)
  const canReadDispatch = role === "owner" || role === "dispatcher"
  const mapProjection = useBusinessProjection(businessProjections.dispatchMap(date), { enabled: canReadDispatch })
  const workProjection = useBusinessProjection(businessProjections.workCases(), { enabled: canReadDispatch })
  const data: MapData | null = mapProjection.data
  const workCases = useMemo<WorkCaseProjection[]>(() => workProjection.data ?? [], [workProjection.data])
  const error = mapProjection.error ? dispatchErrorCopy(mapProjection.error) : null
  const loading = canReadDispatch && mapProjection.data === null && mapProjection.status !== "error"
  const [surfaceQuery] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search))
  const focus: DispatchFocusQuery = {
    householdId: surfaceQuery.get("householdId"),
    visitId: surfaceQuery.get("visitId"),
    serviceVisitId: surfaceQuery.get("serviceVisitId"),
    workOrderId: surfaceQuery.get("workOrderId"),
    appointmentId: surfaceQuery.get("appointmentId"),
  }
  const hasFocus = Object.values(focus).some(Boolean)

  const load = () => {
    void Promise.allSettled([mapProjection.refresh(), workProjection.refresh()])
  }

  const requestedHouseholdId = focus.householdId
  const contextStop = data?.stops.find((stop) => stop.householdId === requestedHouseholdId) ?? null
  const context = stopContext(contextStop) ?? (requestedHouseholdId ? { id: requestedHouseholdId, label: `Household ${shortId(requestedHouseholdId)}` } : undefined)
  const placed = useMemo(() => data?.stops.filter((stop) => stop.latitude !== null && stop.longitude !== null) ?? [], [data])
  const unplaced = useMemo(() => data?.stops.filter((stop) => stop.latitude === null || stop.longitude === null) ?? [], [data])
  const linkedStops = useMemo(() => placed.filter((stop) => exactWorkCaseForStop(stop, workCases)).length, [placed, workCases])

  if (authLoading || (!session && !role)) return <UnauthenticatedSchedule />
  if (role === "technician") {
    return (
      <main className="jarvis-dispatch-shell" data-jarvis-dispatch-field data-dispatch-role="technician">
        <OperationalSurfaceNav active="schedule" context={requestedHouseholdId ? { id: requestedHouseholdId, label: `Household ${shortId(requestedHouseholdId)}` } : undefined} />
        <section className="jarvis-dispatch-technician">
          <div className="jarvis-dispatch-hero">
            <div><span className="jarvis-dispatch-eyebrow">SCHEDULE · MY DAY</span><h1>Your field day, in order.</h1><p>Assigned work orders and visits from your linked technician record.</p></div>
            <Wrench size={21} aria-hidden />
          </div>
          <MyDay />
        </section>
      </main>
    )
  }

  return (
    <main className="jarvis-dispatch-shell" data-jarvis-dispatch-field data-dispatch-role={role ?? "unknown"}>
      <OperationalSurfaceNav active="schedule" context={context} />
      <section className="jarvis-dispatch-hero">
        <div><span className="jarvis-dispatch-eyebrow">SCHEDULE · DISPATCH FIELD</span><h1>Geography, today, exceptions.</h1><p>Stored coordinates and exact operational records; no calendar grid rebuilt here.</p></div>
        <div className="jarvis-dispatch-hero__controls"><span className="jarvis-dispatch-source" data-source-state={data ? "live" : "unavailable"}><span aria-hidden />{data ? "Source live" : "Source unavailable"}</span><label><CalendarDays size={14} aria-hidden /><span className="sr-only">Dispatch day</span><input aria-label="Dispatch day" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button type="button" onClick={() => void load()} aria-label="Refresh Dispatch Field"><RefreshCw size={15} aria-hidden /></button></div>
      </section>
      {error && <div className="jarvis-dispatch-banner" role="status"><span>{error}</span><Link href="/jarvis/login">Sign in</Link></div>}
      {data?.synthetic && <div className="jarvis-dispatch-banner jarvis-dispatch-banner--fixture" role="status">Dealer Zero · synthetic field data is visibly labeled by the source route.</div>}
      {hasFocus && <div className="jarvis-dispatch-focus" role="status">Following exact route context · {Object.entries(focus).filter(([, value]) => value).map(([key, value]) => `${key} ${shortId(value!)}`).join(" · ")}</div>}
      <section className="jarvis-dispatch-summary" aria-label="Dispatch owner summary">
        <div><span>Stops today</span><strong>{data?.stops.length ?? "—"}</strong></div>
        <div><span>Placed</span><strong>{data ? placed.length : "—"}</strong></div>
        <div><span>Unplaced</span><strong className={unplaced.length > 0 ? "is-attention" : ""}>{data ? unplaced.length : "—"}</strong></div>
        <div><span>Work-linked visits</span><strong>{data ? linkedStops : "—"}</strong></div>
        <div><span>Route evidence</span><strong>{data?.route?.kmSaved != null ? `${data.route.kmSaved} km saved` : "Not recorded"}</strong></div>
      </section>
      <section className="jarvis-dispatch-layout" aria-label="Dispatcher map and day rail">
        <div className="jarvis-dispatch-map-column">
          {loading && !data ? <div className="jarvis-dispatch-map-state" role="status"><RefreshCw className="jarvis-dispatch-spin" size={22} aria-hidden /><span>Reading stored coordinates</span><h2>Building the field view</h2><p>The map opens only after the exact dispatch source responds.</p></div>
            : data && data.stops.length === 0 ? <div className="jarvis-dispatch-map-state jarvis-dispatch-map-state--quiet"><CalendarDays size={24} aria-hidden /><span>Quiet field day</span><h2>No route is required on {date}.</h2><p>No appointments or service visits were returned, so JARVIS is withholding an empty map and route claim.</p><div><button type="button" onClick={() => setDate((current) => shiftIsoDate(current, -1))}><ChevronLeft size={15} aria-hidden />Previous day</button><button type="button" onClick={() => setDate((current) => shiftIsoDate(current, 1))}>Next day<ChevronRight size={15} aria-hidden /></button></div></div>
              : <DispatchMapCore data={data} error={error} loading={loading} onRetry={() => void load()} onAssigned={() => void load()} />}
          <div className="jarvis-dispatch-route-note"><Route size={14} aria-hidden /><span>{data?.route ? `B3 route receipt · ${data.route.naiveKm ?? "—"} km scheduled → ${data.route.optimizedKm ?? "—"} km optimized` : data && data.stops.length === 0 ? "No stops · no route receipt expected for this day." : "Route evidence will appear after a completed route workflow."}</span></div>
        </div>
        <aside className="jarvis-dispatch-day-rail" aria-label="Dispatch day rail">
          <div className="jarvis-dispatch-day-rail__heading"><div><span className="jarvis-dispatch-eyebrow">FIELD RAIL</span><h2>{date}</h2></div><span>{data ? data.stops.length : "—"}</span></div>
          {unplaced.length > 0 && <section className="jarvis-dispatch-exceptions"><div><AlertTriangle size={14} aria-hidden /><strong>Needs intervention</strong></div><p>{unplaced.length} stop{unplaced.length === 1 ? "" : "s"} have no stored coordinate and remain unplaced.</p>{unplaced.map((stop) => { const workCase = exactWorkCaseForStop(stop, workCases); return <StopRow key={stop.visitId} stop={stop} workCase={workCase} focused={hasFocus && dispatchStopMatchesFocus(stop, workCase, focus)} /> })}</section>}
          <section className="jarvis-dispatch-today"><div className="jarvis-dispatch-subheading"><span>Today&apos;s placed stops</span><span>{placed.length}</span></div>{placed.length > 0 ? placed.map((stop) => { const workCase = exactWorkCaseForStop(stop, workCases); return <StopRow key={stop.visitId} stop={stop} workCase={workCase} focused={hasFocus && dispatchStopMatchesFocus(stop, workCase, focus)} /> }) : <p className="jarvis-dispatch-empty-copy">No placed stops were returned for this day.</p>}</section>
        </aside>
      </section>
    </main>
  )
}
