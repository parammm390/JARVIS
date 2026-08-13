"use client"

// Operational Console is deliberately a *projection* over the shared data and
// instruction stores. It owns no polling, no business state, and no authority:
// every row below is either a real record already held by data-core/kernel or an
// explicit unavailable state. This keeps the command-center density honest.

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Layers3,
  Network,
  Radio,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import { ageLabel, runCurrentStep, runProgressPct } from "../lib/data-core"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { KpiStrip } from "../panels/KpiStrip"
import { SystemConsole } from "../panels/SystemConsole"
import type { Thread } from "../kernel/store"
import type { Truth } from "../kernel/types"
import type { LiveFrameProjection } from "../kernel/liveframe"
import { deriveSceneDirector } from "../kernel/scene-director"
import { useLanePresentation, useSelectorInput } from "../kernel/useSelectorInput"
import { selectEventsToday, selectRunsInFlight, type SelectorInput } from "../kernel/selectors"
import { SURFACES, withHouseholdId } from "../surfaces/surface-routes"
import { humanize, reviewStatusCopy, reviewTitle } from "./operational-console-copy"

type OverdueInvoices = Truth<{ count: number; totalUsd: number }>

export type OperationalConsoleProps = {
  thread: Thread | null
  liveframe: LiveFrameProjection
  pendingApprovals: Truth<number>
  overdueInvoices: OverdueInvoices
  fixtureLabel?: string
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
}

function knownTruth<T>(truth: Truth<T>): T | null {
  return truth.status === "known" || truth.status === "stale" || truth.status === "partial" ? truth.value : null
}

function truthStateCopy(truth: Truth<unknown>, subject: string): string {
  if (truth.status === "unknown") return `${subject} is loading`
  if (truth.status === "denied") return "Sign in to view this"
  if (truth.status === "unavailable") return `${subject} is unavailable`
  return `${subject} has not been observed`
}

function modeCopy(liveframe: LiveFrameProjection): string {
  switch (liveframe.mode) {
    case "ready": return "Standing by"
    case "listening": return "Listening for intent"
    case "thinking": return "Checking records and preparing actions"
    case "decision": return liveframe.focus === "clarification" ? "Waiting for one detail" : "Waiting for a decision"
    case "working": return "Execution in progress"
    case "verifying": return "Verifying recorded work"
    case "resolved": return "Outcome recorded"
    case "fault": return "Needs operator attention"
  }
}

function connectionCopy(posture: LiveFrameProjection["transportPosture"]): string {
  switch (posture) {
    case "healthy": return "Connection healthy"
    case "degraded": return "Degraded connection"
    case "offline": return "Connection lost"
  }
}

function toneForMode(mode: LiveFrameProjection["mode"]): "cyan" | "violet" | "amber" | "blue" | "green" | "red" {
  switch (mode) {
    case "thinking": return "violet"
    case "decision": return "amber"
    case "working": return "blue"
    case "verifying": return "green"
    case "resolved": return "green"
    case "fault": return "red"
    default: return "cyan"
  }
}

function useOperationalStackReveal(dependencies: readonly unknown[]) {
  const scope = useRef<HTMLElement | null>(null)
  useGSAP(() => {
    if (!scope.current || typeof window === "undefined") return
    gsap.registerPlugin(ScrollTrigger)
    const media = gsap.matchMedia()
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const panels = gsap.utils.toArray<HTMLElement>(":scope > .jarvis-ops-panel", scope.current)
      if (panels.length < 2) return
      gsap.fromTo(panels, {
        autoAlpha: 0.68,
        y: (index) => 12 + index * 7,
      }, {
        autoAlpha: 1,
        y: 0,
        stagger: 0.05,
        ease: "none",
        scrollTrigger: {
          trigger: scope.current,
          start: "top 96%",
          end: "top 76%",
          scrub: 0.35,
        },
      })
    })
    return () => media.revert()
  }, { scope, dependencies: [...dependencies], revertOnUpdate: true })
  return scope
}

function useBusinessPulseReveal(quiet: boolean) {
  const scope = useRef<HTMLElement | null>(null)
  useGSAP(() => {
    if (!scope.current || typeof window === "undefined") return
    gsap.registerPlugin(ScrollTrigger)
    const media = gsap.matchMedia()
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const targets = gsap.utils.toArray<HTMLElement>(".jarvis-business-pulse__heading, .jarvis-business-pulse__metrics .j-panel", scope.current)
      gsap.fromTo(targets, { autoAlpha: 0.56, y: 10 }, {
        autoAlpha: quiet ? 0.68 : 1,
        y: 0,
        stagger: 0.045,
        ease: "none",
        scrollTrigger: {
          trigger: scope.current,
          start: "top 98%",
          end: "top 82%",
          scrub: 0.3,
        },
      })
    })
    return () => media.revert()
  }, { scope, dependencies: [quiet], revertOnUpdate: true })
  return scope
}

function safeAge(iso: string, now: number): string | null {
  return Number.isFinite(new Date(iso).getTime()) ? ageLabel(iso, now) : null
}

function RailHeading({ icon, children, trailing }: { icon: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="jarvis-ops-rail__heading">
      <span className="jarvis-ops-rail__icon" aria-hidden>{icon}</span>
      <span>{children}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  return <span className="jarvis-ops-source" data-source={source}>SOURCE</span>
}

/** A compact section index for the owner command center. These are ordinary
 * same-page links to the live regions below—not a fabricated app navigation
 * model—so every control lands on a surface that is already present and backed
 * by the shared kernel/data providers. */
export function OperationalCommandIndex({ ready = false }: { ready?: boolean }) {
  const sections = ready
    ? [
        { href: "#jarvis-command-core", label: "Command core", icon: <CircleDot className="h-4 w-4" /> },
        { href: "#jarvis-now-rail", label: "Now rail", icon: <ShieldCheck className="h-4 w-4" /> },
        { href: "#jarvis-business-pulse", label: "Business pulse", icon: <Radio className="h-4 w-4" /> },
      ]
    : [
        { href: "#jarvis-command-core", label: "Command core", icon: <CircleDot className="h-4 w-4" /> },
        { href: "#jarvis-review-queue", label: "Review queue", icon: <ShieldCheck className="h-4 w-4" /> },
        { href: "#jarvis-operator-context", label: "Operator context", icon: <Workflow className="h-4 w-4" /> },
        { href: "#jarvis-operations-field", label: "Operations field", icon: <Radio className="h-4 w-4" /> },
      ]

  return (
    <nav className="jarvis-command-index" aria-label="Command center sections">
      {sections.map((section) => (
        <a key={section.href} href={section.href} className="jarvis-command-index__link" aria-label={section.label} title={section.label}>
          {section.icon}
          <span>{section.label}</span>
        </a>
      ))}
    </nav>
  )
}

type NowRailAction = {
  id: string
  title: string
  status: string
  actionType: string
  createdAt: string
  count: number
  current: boolean
}

type NowRailRun = {
  id: string
  title: string
  detail: string
  progress: number
  updatedAt: string
}

type NowRailEvent = {
  id: string
  title: string
  detail: string
  occurredAt: string
  count: number
}

/** H0's right rail. Every group is omitted unless the shared selector/data
 * snapshot contains an observation for it. */
function NowRail({
  selector,
  thread,
  liveframe,
  pendingApprovals,
  eventsTruth,
  fixtureLabel,
  onReviewApprovals,
}: {
  selector: SelectorInput
  thread: Thread | null
  liveframe: LiveFrameProjection
  pendingApprovals: Truth<number>
  eventsTruth: Truth<number>
  fixtureLabel?: string
  onReviewApprovals?: () => void
}) {
  const approvals = knownTruth(pendingApprovals)
  const currentActionIds = new Set(thread?.nodes.map((node) => node.id) ?? [])
  const pendingActionRows = approvals !== null
    ? [...selector.pendingActions]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .sort((a, b) => Number(currentActionIds.has(b.id)) - Number(currentActionIds.has(a.id)))
    : []
  const needsYou = pendingActionRows.reduce<NowRailAction[]>((groups, action) => {
    const title = reviewTitle(action.summary, action.actionType)
    const key = `${action.status}\u0000${title}`
    const match = groups.find((group) => `${group.status}\u0000${group.title}` === key)
    if (match) {
      match.count += 1
      match.current ||= currentActionIds.has(action.id)
      return groups
    }
    groups.push({
      id: action.id,
      title,
      status: action.status,
      actionType: action.actionType,
      createdAt: action.createdAt,
      count: 1,
      current: currentActionIds.has(action.id),
    })
    return groups
  }, []).slice(0, 3)

  const runsTruth = selectRunsInFlight(selector)
  const runs = knownTruth(runsTruth)
  const inMotion: NowRailRun[] = runs !== null
    ? [...selector.runs]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 2)
        .map((run) => {
          const currentStep = runCurrentStep(run)
          return {
            id: run.id,
            title: humanize(run.workflowType),
            detail: currentStep ? humanize(currentStep.stepType) : humanize(run.status),
            progress: runProgressPct(run),
            updatedAt: run.updatedAt,
          }
        })
    : []

  const eventRows = knownTruth(eventsTruth) !== null
    ? [...selector.events].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    : []
  const changedRecently = eventRows.reduce<NowRailEvent[]>((groups, event) => {
    const title = humanize(event.eventType)
    const detail = humanize(event.entityType)
    const key = `${title}\u0000${detail}`
    const match = groups.find((group) => `${group.title}\u0000${group.detail}` === key)
    if (match) {
      match.count += 1
      return groups
    }
    groups.push({ id: event.id, title, detail, occurredAt: event.occurredAt, count: 1 })
    return groups
  }, []).slice(0, 3)

  const hasNeedsYou = needsYou.length > 0 || (approvals !== null && approvals > 0)
  const hasInMotion = inMotion.length > 0
  const hasChangedRecently = changedRecently.length > 0
  const sourceFor = (fallback: string) => fixtureLabel ? "fixture" : fallback
  const stackRef = useOperationalStackReveal([needsYou.length, inMotion.length, changedRecently.length])

  return (
    <aside ref={stackRef} id="jarvis-now-rail" className="jarvis-ops-rail jarvis-ops-rail--signals jarvis-now-rail" aria-label="Now Rail" data-jarvis-now-rail data-liveframe-mode={liveframe.mode} data-scene-rail="full" data-command-canvas-scene="ready">
      {hasNeedsYou ? (
        <section className="jarvis-ops-panel jarvis-ops-panel--focus" data-now-group="needs-you">
          <RailHeading icon={<ShieldCheck className="h-3.5 w-3.5" />} trailing={pendingActionRows.length > 0 ? <span className="jarvis-ops-rail__total" data-jarvis-fact data-source={sourceFor("api:actions-pending")}>{pendingActionRows.length} shown</span> : undefined}>Needs you</RailHeading>
          {needsYou.length > 0 ? (
            <ul className="jarvis-ops-list" data-source={sourceFor("api:actions-pending")}>
              {needsYou.map((action) => (
                <li key={action.id}>
                <button type="button" onClick={onReviewApprovals} className={`${action.current ? "jarvis-ops-list__item jarvis-ops-list__item--current" : "jarvis-ops-list__item"} w-full text-left`} data-jarvis-fact data-source={sourceFor("api:actions-pending")} title={safeAge(action.createdAt, selector.now) ? `Observed ${safeAge(action.createdAt, selector.now)} ago` : undefined} aria-label={`Review approval: ${action.title}`}>
                  <span className="jarvis-ops-list__dot" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="jarvis-ops-list__title">{action.title}{action.count > 1 ? <span className="jarvis-ops-list__repeat" aria-label={`${action.count} matching records`}>×{action.count}</span> : null}</span>
                    <span className="jarvis-ops-list__detail">{reviewStatusCopy(action.actionType, action.status)}</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--j-text-faint)]" aria-hidden />
                </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="jarvis-ops-panel__muted" data-jarvis-fact data-source={sourceFor("selectPendingApprovals")}>
              {approvals === 1 ? "1 approval needs your decision." : `${approvals} approvals need your decision.`}
            </p>
          )}
        </section>
      ) : null}

      {hasInMotion ? (
        <section className="jarvis-ops-panel" data-now-group="in-motion">
          <RailHeading icon={<Workflow className="h-3.5 w-3.5" />} trailing={<span className="jarvis-ops-rail__total" data-jarvis-fact data-source={sourceFor("api:workflow-runs")}>{runs} active</span>}>In motion</RailHeading>
          <ul className="jarvis-ops-list" data-source={sourceFor("api:workflow-runs")}>
            {inMotion.map((run) => (
              <li key={run.id} className="jarvis-ops-list__item" data-jarvis-fact data-source={sourceFor("api:workflow-runs")} title={safeAge(run.updatedAt, selector.now) ? `Updated ${safeAge(run.updatedAt, selector.now)} ago` : undefined}>
                <span className="jarvis-ops-list__dot jarvis-ops-list__dot--signal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="jarvis-ops-list__title">{run.title}</span>
                  <span className="jarvis-ops-list__detail">{run.detail} · {run.progress}% complete</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasChangedRecently ? (
        <section className="jarvis-ops-panel" data-now-group="changed-recently">
          <RailHeading icon={<Activity className="h-3.5 w-3.5" />} trailing={<SourceBadge source={sourceFor("api:activity")} />}>Changed recently</RailHeading>
          <ul className="jarvis-ops-list jarvis-ops-list--events" data-source={sourceFor("api:activity")}>
            {changedRecently.map((event) => (
              <li key={event.id} className="jarvis-ops-list__item" data-jarvis-fact data-source={sourceFor("api:activity")} title={safeAge(event.occurredAt, selector.now) ? `Observed ${safeAge(event.occurredAt, selector.now)} ago` : undefined}>
                <span className="jarvis-ops-list__dot jarvis-ops-list__dot--signal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="jarvis-ops-list__title">{event.title}{event.count > 1 ? <span className="jarvis-ops-list__repeat" aria-label={`${event.count} matching events`}>×{event.count}</span> : null}</span>
                  <span className="jarvis-ops-list__detail">{event.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasNeedsYou && !hasInMotion && !hasChangedRecently ? (
        <section className="jarvis-ops-panel jarvis-ops-panel--empty" data-now-empty>
          <RailHeading icon={<CircleDot className="h-3.5 w-3.5" />}>Now</RailHeading>
          <p className="jarvis-ops-panel__muted">
            {pendingApprovals.status === "denied" ? "Sign in to view current work." : "No current changes are observed."}
          </p>
        </section>
      ) : null}
    </aside>
  )
}

/**
 * The left rail explains the present operating posture. Empty/null sources are
 * not normalized to zero: a not-yet-observed queue/runs lane remains visibly
 * unknown instead of becoming an optimistic "all clear".
 */
export function OperationalContextRail({ thread, liveframe, pendingApprovals, overdueInvoices, fixtureLabel }: OperationalConsoleProps) {
  const selector = useSelectorInput()
  const lane = useLanePresentation()
  const runsTruth = selectRunsInFlight(selector)
  const currentRun = knownTruth(runsTruth) !== null
    ? [...selector.runs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : undefined
  const currentStep = currentRun ? runCurrentStep(currentRun) : undefined
  const approvals = knownTruth(pendingApprovals)
  const overdue = knownTruth(overdueInvoices)
  const currentStatus = modeCopy(liveframe)

  return (
    <aside id="jarvis-operator-context" className="jarvis-ops-rail jarvis-ops-rail--context" aria-label="Operational context" data-jarvis-operational-context>
      <section className="jarvis-ops-panel jarvis-ops-panel--focus jarvis-ops-panel--operations" data-liveframe-mode={liveframe.mode}>
        <RailHeading icon={<CircleDot className="h-3.5 w-3.5" />}>Today&apos;s operations</RailHeading>
        <div className="jarvis-operations-list">
          <div className="jarvis-operations-list__row" data-source="kernel.liveframe">
            <span className="jarvis-operations-list__label"><CircleDot className="h-3.5 w-3.5" aria-hidden /> Operator focus</span>
            <strong data-primary-status={currentStatus}>{currentStatus}</strong>
            {thread ? (
              <p data-jarvis-fact data-source="kernel.thread.instructionText">{thread.instructionText}</p>
            ) : null}
          </div>

          <div className="jarvis-operations-list__row" data-jarvis-approval-queue>
            <span className="jarvis-operations-list__label"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Decision queue</span>
            {approvals !== null ? (
              <strong className="j-num" data-jarvis-fact data-source="selectPendingApprovals">{approvals} {approvals === 1 ? "decision" : "decisions"}</strong>
            ) : (
              <strong>{truthStateCopy(pendingApprovals, "Decision queue")}</strong>
            )}
            {overdue !== null && overdue.count > 0 ? (
              <p className="jarvis-operations-list__notice" data-jarvis-fact data-source="selectOverdueInvoices">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {overdue.count} overdue · {formatUsd(overdue.totalUsd)}
              </p>
            ) : null}
          </div>

          <div className="jarvis-operations-list__row" data-jarvis-execution-lane>
            <span className="jarvis-operations-list__label"><Workflow className="h-3.5 w-3.5" aria-hidden /> Execution lane</span>
            {currentRun ? (
              <>
                <strong data-jarvis-fact data-source="api:workflow-runs">{humanize(currentRun.workflowType)}</strong>
                <div className="jarvis-ops-progress" aria-label={`${runProgressPct(currentRun)} percent complete`}><span style={{ width: `${runProgressPct(currentRun)}%` }} /></div>
                <p data-jarvis-fact data-source="api:workflow-runs">{currentStep ? humanize(currentStep.stepType) : humanize(currentRun.status)}</p>
              </>
            ) : (
              <strong>{knownTruth(runsTruth) !== null ? "No active workflow" : truthStateCopy(runsTruth, "Execution lane")}</strong>
            )}
          </div>

          {(lane.integrationsStatus || lane.integrationsDegraded) ? (
            <div className="jarvis-operations-list__row" data-jarvis-integration-posture>
              <span className="jarvis-operations-list__label"><Network className="h-3.5 w-3.5" aria-hidden /> Connection set</span>
              {lane.integrationsStatus ? (
                <>
                  <strong className="j-num" data-jarvis-fact data-source="api:integrations-status">{lane.integrationsStatus.summary.healthyCount} / {lane.integrationsStatus.summary.configuredCount} healthy</strong>
                  {lane.integrationsStatus.summary.unhealthyCount > 0 ? <p className="jarvis-operations-list__notice" data-jarvis-fact data-source="api:integrations-status">{lane.integrationsStatus.summary.unhealthyCount} needs attention</p> : null}
                </>
              ) : (
                <strong>Connection status is unavailable</strong>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {fixtureLabel ? <span className="sr-only">This is a labelled fixture surface.</span> : null}
    </aside>
  )
}

/** The right rail is a compact, real queue + event log. It intentionally
 * disappears section-by-section when the backing source has no observation
 * rather than filling the rail with synthetic operational theatre. */
export function OperationalSignalRail({ thread, liveframe, pendingApprovals, fixtureLabel, onReviewApprovals }: Omit<OperationalConsoleProps, "overdueInvoices"> & { onReviewApprovals?: () => void }) {
  const selector = useSelectorInput()
  const eventsTruth = selectEventsToday(selector)
  const sceneDirector = deriveSceneDirector(liveframe)
  if (sceneDirector.scene === "ready") {
    return <NowRail selector={selector} thread={thread} liveframe={liveframe} pendingApprovals={pendingApprovals} eventsTruth={eventsTruth} fixtureLabel={fixtureLabel} onReviewApprovals={onReviewApprovals} />
  }
  const approvals = knownTruth(pendingApprovals)
  const currentActionIds = new Set(thread?.nodes.map((node) => node.id) ?? [])
  const pendingActionRows = approvals !== null ? [...selector.pendingActions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .sort((a, b) => Number(currentActionIds.has(b.id)) - Number(currentActionIds.has(a.id))) : []
  // The backend can legitimately emit several records for the same question or
  // event (for example when a source upserts a record). Present them as a real
  // grouped signal instead of repeating a visually indistinguishable row. The
  // total remains exact and the newest record supplies the timestamp.
  const queued = pendingActionRows.reduce<Array<{
    id: string
    title: string
    status: string
    createdAt: string
    count: number
    current: boolean
  }>>((groups, action) => {
    const title = action.summary?.trim() || humanize(action.actionType)
    const key = `${action.status}\u0000${title}`
    const match = groups.find((group) => `${group.status}\u0000${group.title}` === key)
    if (match) {
      match.count += 1
      match.current ||= currentActionIds.has(action.id)
      return groups
    }
    groups.push({
      id: action.id,
      title,
      status: action.status,
      createdAt: action.createdAt,
      count: 1,
      current: currentActionIds.has(action.id),
    })
    return groups
  }, []).slice(0, 3)
  const eventRows = knownTruth(eventsTruth) !== null ? [...selector.events]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    : []
  const recentEvents = eventRows.reduce<Array<{
    id: string
    eventType: string
    entityType: string
    occurredAt: string
    count: number
  }>>((groups, event) => {
    const key = `${event.eventType}\u0000${event.entityType}`
    const match = groups.find((group) => `${group.eventType}\u0000${group.entityType}` === key)
    if (match) {
      match.count += 1
      return groups
    }
    groups.push({
      id: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      occurredAt: event.occurredAt,
      count: 1,
    })
    return groups
  }, []).slice(0, 4)

  return (
    <aside id="jarvis-review-queue" className="jarvis-ops-rail jarvis-ops-rail--signals" aria-label="Operational signals" data-jarvis-operational-signals data-scene-rail={sceneDirector.nowRail} data-command-canvas-scene={sceneDirector.scene}>
      <section className="jarvis-ops-panel jarvis-ops-panel--queue" data-liveframe-mode={liveframe.mode}>
        <RailHeading
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          trailing={pendingActionRows.length > 0 ? <span className="jarvis-ops-rail__total" data-jarvis-fact data-source="api:actions-pending">{pendingActionRows.length} records</span> : undefined}
        >Review queue</RailHeading>
        {queued.length > 0 ? (
          <ul className="jarvis-ops-list" data-source="api:actions-pending">
            {queued.map((action) => (
              <li key={action.id}>
              <button type="button" onClick={onReviewApprovals} className={`${action.current ? "jarvis-ops-list__item jarvis-ops-list__item--current" : "jarvis-ops-list__item"} w-full text-left`} data-jarvis-fact data-source="api:actions-pending" aria-label={`Review approval: ${action.title}`}>
                <span className="jarvis-ops-list__dot" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="jarvis-ops-list__title">{action.title}{action.count > 1 ? <span className="jarvis-ops-list__repeat" aria-label={`${action.count} matching records`}>×{action.count}</span> : null}</span>
                  <span className="jarvis-ops-list__detail">{humanize(action.status)}{safeAge(action.createdAt, selector.now) ? ` · latest ${safeAge(action.createdAt, selector.now)} ago` : ""}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--j-text-faint)]" aria-hidden />
              </button>
              </li>
            ))}
          </ul>
        ) : approvals !== null ? (
          <p className="jarvis-ops-panel__muted" data-jarvis-fact data-source="selectPendingApprovals">
            {approvals === 0
              ? "No approvals are waiting."
              : `Approval records are still loading. ${approvals} pending approval${approvals === 1 ? " is" : "s are"} reported.`}
          </p>
        ) : (
          <p className="jarvis-ops-panel__muted">{truthStateCopy(pendingApprovals, "Approval queue")}</p>
        )}
      </section>

      {recentEvents.length > 0 ? (
        <section className="jarvis-ops-panel" data-jarvis-event-feed>
          <RailHeading icon={<Activity className="h-3.5 w-3.5" />}>Recent signals <SourceBadge source="api:activity" /></RailHeading>
          <ul className="jarvis-ops-list jarvis-ops-list--events" data-source="api:activity">
            {recentEvents.map((event) => (
              <li key={event.id} className="jarvis-ops-list__item" data-jarvis-fact data-source="api:activity">
                <span className="jarvis-ops-list__dot jarvis-ops-list__dot--signal" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="jarvis-ops-list__title">{humanize(event.eventType)}{event.count > 1 ? <span className="jarvis-ops-list__repeat" aria-label={`${event.count} matching events`}>×{event.count}</span> : null}</span>
                  <span className="jarvis-ops-list__detail">{humanize(event.entityType)}{safeAge(event.occurredAt, selector.now) ? ` · latest ${safeAge(event.occurredAt, selector.now)} ago` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : eventsTruth.status === "unavailable" ? (
        <section className="jarvis-ops-panel" data-jarvis-event-feed>
          <RailHeading icon={<Activity className="h-3.5 w-3.5" />}>Recent signals</RailHeading>
          <p className="jarvis-ops-panel__muted">Signal feed is unavailable.</p>
        </section>
      ) : null}

      {fixtureLabel ? <span className="sr-only">This is a labelled fixture surface.</span> : null}
    </aside>
  )
}

/**
 * The readout makes the Orb a live intelligence surface rather than a detached
 * decorative object. All callouts are grounded in the active instruction or
 * real data lanes; no callout is rendered merely to make the composition busy.
 */
export function OrbIntelligenceReadout({ thread, liveframe, pendingApprovals, fixtureLabel, primaryStatus }: Pick<OperationalConsoleProps, "thread" | "liveframe" | "pendingApprovals" | "fixtureLabel"> & { primaryStatus: string }) {
  const selector = useSelectorInput()
  const lane = useLanePresentation()
  const runsTruth = selectRunsInFlight(selector)
  const eventsTruth = selectEventsToday(selector)
  const approvals = knownTruth(pendingApprovals)
  const runs = knownTruth(runsTruth)
  const events = knownTruth(eventsTruth)
  const currentRun = knownTruth(runsTruth) !== null
    ? [...selector.runs].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : undefined
  // Pending action records and approval totals are distinct backend facts. The
  // former can legitimately contain clarification/action records even when the
  // approval aggregate is zero, so the visual surface labels the record count
  // precisely instead of silently treating one as the other.
  const queuedActionRecords = approvals !== null ? selector.pendingActions.length : null
  const clarificationRecords = queuedActionRecords === null ? null : selector.pendingActions.filter((action) => action.actionType === "clarification_request").length
  const decisionRecords = queuedActionRecords === null || clarificationRecords === null ? null : Math.max(0, queuedActionRecords - clarificationRecords)
  const integrations = lane.integrationsStatus
  const modeTone = toneForMode(liveframe.mode)

  return (
    <div className="jarvis-orb-readout" data-orb-intelligence-surface data-liveframe-mode={liveframe.mode} data-liveframe-tone={modeTone}>
      {liveframe.mode === "ready" || liveframe.mode === "listening" ? (
        <div className="jarvis-orb-readout__state" data-source="kernel.liveframe">
          <span className="jarvis-orb-readout__eyebrow">JARVIS intelligence</span>
          <strong data-primary-status={primaryStatus} role="status">{primaryStatus}</strong>
        </div>
      ) : null}
      {runs !== null ? (
        <div className="jarvis-orb-readout__satellite jarvis-orb-readout__satellite--workflow" data-jarvis-fact data-source={fixtureLabel ? "fixture.workflowRuns" : "api:workflow-runs"}>
          <Workflow className="h-3.5 w-3.5" aria-hidden />
          <span>Workflow lanes</span>
          <strong>{runs} active</strong>
        </div>
      ) : null}
      {queuedActionRecords !== null ? (
        <div className="jarvis-orb-readout__satellite jarvis-orb-readout__satellite--actions" data-jarvis-fact data-source={fixtureLabel ? "fixture.pendingActions" : "api:actions-pending"}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          <span>Needs you</span>
          <strong>{clarificationRecords && decisionRecords ? `${clarificationRecords} context · ${decisionRecords} decisions` : clarificationRecords ? `${clarificationRecords} context request${clarificationRecords === 1 ? "" : "s"}` : decisionRecords ? `${decisionRecords} decision${decisionRecords === 1 ? "" : "s"}` : "clear"}</strong>
        </div>
      ) : null}
      {integrations ? (
        <div className="jarvis-orb-readout__satellite jarvis-orb-readout__satellite--integrations" data-jarvis-fact data-source={fixtureLabel ? "fixture.integrationsStatus" : "api:integrations-status"}>
          <Network className="h-3.5 w-3.5" aria-hidden />
          <span>Connections</span>
          <strong>{integrations.summary.healthyCount} / {integrations.summary.configuredCount} healthy</strong>
        </div>
      ) : null}
      {events !== null && events > 0 ? (
        <div className="jarvis-orb-readout__satellite jarvis-orb-readout__satellite--events" data-jarvis-fact data-source="api:activity">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          <span>Signal stream</span>
          <strong>{events} observed</strong>
        </div>
      ) : null}
      {thread ? (
        <div className="jarvis-orb-readout__intent" data-jarvis-fact data-source="kernel.thread.instructionText">
          <span>Active instruction</span>
          <p>{thread.instructionText}</p>
        </div>
      ) : null}
      <div className="jarvis-orb-readout__facts">
        {thread?.nodes.length ? (
          <span data-jarvis-fact data-source="kernel.thread.nodes"><Layers3 className="h-3.5 w-3.5" aria-hidden /> {thread.nodes.length} action{thread.nodes.length === 1 ? "" : "s"}</span>
        ) : null}
        {currentRun ? (
          <span data-jarvis-fact data-source="api:workflow-runs"><Workflow className="h-3.5 w-3.5" aria-hidden /> {humanize(currentRun.workflowType)}</span>
        ) : null}
        {approvals !== null && approvals > 0 ? (
          <span data-jarvis-fact data-source="selectPendingApprovals"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {approvals} waiting</span>
        ) : null}
      </div>
    </div>
  )
}

type IntegrationKey = "meta_ads" | "google_ads" | "quickbooks" | "vapi" | "ghl" | "stripe" | "docusign"

const INTEGRATION_PROVIDERS: Array<{ key: IntegrationKey; label: string }> = [
  { key: "ghl", label: "GoHighLevel" },
  { key: "quickbooks", label: "QuickBooks" },
  { key: "vapi", label: "Vapi voice" },
  { key: "stripe", label: "Stripe" },
  { key: "docusign", label: "DocuSign" },
  { key: "meta_ads", label: "Meta Ads" },
  { key: "google_ads", label: "Google Ads" },
]

function providerPosture(provider: { configured: boolean; healthy: boolean | null }): { label: string; tone: "healthy" | "attention" | "muted" } {
  if (!provider.configured) return { label: "Not configured", tone: "muted" }
  if (provider.healthy === true) return { label: "Healthy", tone: "healthy" }
  if (provider.healthy === false) return { label: "Attention", tone: "attention" }
  return { label: "Not verified", tone: "muted" }
}

/**
 * A compact lower instrument deck for the owner surface. It deliberately
 * composes existing, source-backed panels instead of creating a parallel
 * dashboard model: KPI values remain Truth-gated and the telemetry stream only
 * reports requests this browser has actually made.
 */
export function OperationalFloor() {
  const lane = useLanePresentation()
  const integrations = lane.integrationsStatus

  return (
    <section id="jarvis-operations-field" className="jarvis-operation-floor" aria-label="Live operating telemetry" data-jarvis-operation-floor>
      <div className="jarvis-operation-floor__heading">
        <span className="jarvis-operation-floor__title"><Radio className="h-3.5 w-3.5" aria-hidden /> Operations field</span>
        <span className="jarvis-operation-floor__note">Truth-gated tenant signals</span>
      </div>

      <div className="jarvis-operation-floor__metrics" data-jarvis-operation-metrics>
        <KpiStrip />
      </div>

      <section className="jarvis-operation-floor__integrations" data-jarvis-integration-matrix>
        <div className="jarvis-operation-floor__panel-heading">
          <span><Network className="h-3.5 w-3.5" aria-hidden /> Provider / service health</span>
          {integrations ? (
            <span className="jarvis-operation-floor__summary" data-jarvis-fact data-source="api:integrations-status">
              {integrations.summary.healthyCount} / {integrations.summary.configuredCount} healthy
            </span>
          ) : null}
        </div>
        {integrations ? (
          <ul className="jarvis-integration-matrix" data-source="api:integrations-status">
            {INTEGRATION_PROVIDERS.map((provider) => {
              const posture = providerPosture(integrations[provider.key])
              return (
                <li key={provider.key} data-jarvis-fact data-source="api:integrations-status">
                  <span className="jarvis-integration-matrix__provider">{provider.label}</span>
                  <span className="jarvis-integration-matrix__status" data-tone={posture.tone}>
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> {posture.label}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="jarvis-operation-floor__empty">
            {lane.integrationsDegraded ? "Provider health is unavailable." : "Provider health is loading."}
          </p>
        )}
      </section>

      <div className="jarvis-operation-floor__telemetry" data-jarvis-transport-telemetry>
        <SystemConsole />
      </div>
    </section>
  )
}

/** H0's compact pulse keeps the existing Truth-gated KPI facts but removes the
 * legacy five-card operations floor from the Ready hierarchy. The four-item
 * projection preserves the source strip's existing order and values. */
export function BusinessPulse({ quiet = false }: { quiet?: boolean }) {
  const pulseRef = useBusinessPulseReveal(quiet)
  return (
    <section ref={pulseRef} id="jarvis-business-pulse" className={`jarvis-business-pulse${quiet ? " jarvis-business-pulse--quiet" : ""}`} aria-label="Business Pulse" data-jarvis-business-pulse data-business-pulse-mode={quiet ? "quiet" : "full"}>
      <div className="jarvis-business-pulse__heading">
        <span className="jarvis-business-pulse__title"><Radio className="h-3.5 w-3.5" aria-hidden /> Business Pulse</span>
        <span className="jarvis-business-pulse__note">Current source-backed facts</span>
      </div>
      <div className="jarvis-business-pulse__metrics">
        <KpiStrip limit={4} compact />
      </div>
    </section>
  )
}

function latencyPath(values: number[]): string {
  if (values.length < 2) return ""
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 18 - ((value - min) / range) * 14
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function LatencySparkline({ values }: { values: number[] }) {
  const recent = values.slice(-20)
  const path = latencyPath(recent)
  if (!path) return null
  return (
    <svg className="jarvis-ops-latency" viewBox="0 0 100 20" preserveAspectRatio="none" aria-label="Measured API latency trend" data-source="api:stats">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Semantic top chrome. The human status lives beside the Orb; technical
 * connection/latency detail stays behind the supplied Diagnostics disclosure. */
export function OperationsHeader({
  liveframe,
  diagnostics,
  environment,
  showSignIn = true,
}: {
  liveframe: LiveFrameProjection
  diagnostics?: ReactNode
  /** A truthful build/preview marker belongs in the header chrome, never as a
   * floating overlay that can cover an operational control. */
  environment?: ReactNode
  /** Public preview already provides the primary sign-in CTA in the causal
   * action spine, so its header stays informational rather than duplicating it. */
  showSignIn?: boolean
}) {
  const auth = useJarvisAuth()
  const pathname = usePathname()
  const account = auth.session?.user.email ?? null
  const [contextHouseholdId, setContextHouseholdId] = useState<string | null>(null)

  useEffect(() => {
    setContextHouseholdId(new URLSearchParams(window.location.search).get("householdId"))
  }, [])

  const surfaceHref = (href: string): string => withHouseholdId(href, contextHouseholdId)

  return (
    <header className="jarvis-operations-header" data-jarvis-command-header data-liveframe-mode={liveframe.mode}>
      <div className="jarvis-operations-header__inner">
        <Link href={surfaceHref("/jarvis")} prefetch={false} className="jarvis-operations-header__brand" aria-label="JARVIS command center">
          <span className="jarvis-operations-header__mark" aria-hidden>J</span>
          <span className="min-w-0">
            <span className="jarvis-operations-header__name">JARVIS</span>
            <span className="jarvis-operations-header__sub">FINNOR operational intelligence</span>
          </span>
        </Link>
        <nav className="jarvis-operations-header__surface-nav" aria-label="Operational surfaces">
          {contextHouseholdId ? <span className="jarvis-operations-header__context" data-context-household-id={contextHouseholdId}>Context · {contextHouseholdId.slice(0, 8)}…</span> : null}
          {SURFACES.map((surface) => {
            const active = pathname === surface.href
            return (
              <Link
                key={surface.key}
                href={surfaceHref(surface.href)}
                prefetch={false}
                className="jarvis-operations-header__surface-link"
                data-jarvis-surface-link={surface.key}
                data-active={active ? "true" : "false"}
                aria-current={active ? "page" : undefined}
              >
                {surface.label}
              </Link>
            )
          })}
        </nav>

        <div className="jarvis-operations-header__actions">
          {environment ? <span className="jarvis-operations-header__environment">{environment}</span> : null}
          {diagnostics}
          {account ? (
            <span className="jarvis-operations-header__account" title={account} data-source="auth.session">{account}</span>
          ) : showSignIn ? (
            <Link className="jarvis-operations-header__signin" href="/jarvis/login">Sign in</Link>
          ) : null}
        </div>
      </div>
    </header>
  )
}

/** Kept exportable for source-level tests without asking them to couple to the
 * component's presentation structure. */
export const operationalConsole = {
  humanize,
  modeCopy,
  connectionCopy,
  latencyPath,
  reviewTitle,
  reviewStatusCopy,
}
