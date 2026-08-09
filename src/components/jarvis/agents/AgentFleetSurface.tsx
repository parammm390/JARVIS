"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, ArrowUpRight, Bot, CircleDot, CreditCard, MessageCircle, Phone, ShieldCheck, Waves, X } from "lucide-react"
import { jarvisClient, type WorkCaseProjection } from "@/lib/jarvis-client"
import type { IntegrationsStatus } from "../lib/data-core"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { OperationalSurfaceNav } from "../surfaces/OperationalSurfaceNav"
import { AGENT_ACTIVITY_UNAVAILABLE, AGENT_FLEET, agentDefinition, assistantStatusCopy, projectAgentActivity, providerStatusCopy, type AgentKey } from "./agent-fleet"
import "../jarvis-theme.css"

type InspectorTarget = { title: string; detail: string }

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "—"
}

function activityTime(value: string | null): string {
  if (!value) return "Time not recorded"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function customerLink(workCase: WorkCaseProjection): { id: string; href: string } | null {
  const household = workCase.linkedEntities.find((entity) => entity.entityType === "household")
  return household ? { id: household.entityId, href: `/jarvis/customers?householdId=${encodeURIComponent(household.entityId)}` } : null
}

function WorkActivityRow({ workCase, onInspect }: { workCase: WorkCaseProjection; onInspect: () => void }) {
  const customer = customerLink(workCase)
  return (
    <div className="jarvis-agent-fleet__activity-row">
      <button type="button" className="jarvis-agent-fleet__activity-main" onClick={onInspect}>
        <span><strong>{workCase.title}</strong><small>{workCase.status} · Work {shortId(workCase.id)}</small></span>
        <ArrowUpRight size={15} aria-hidden />
      </button>
      <div className="jarvis-agent-fleet__activity-links">
        <Link href={`/jarvis/work?workCaseId=${encodeURIComponent(workCase.id)}`}>Open Work</Link>
        {customer ? <Link href={customer.href}>Customer {shortId(customer.id)}</Link> : <span>Customer link unavailable</span>}
      </div>
    </div>
  )
}

function CallActivityRow({ workCase, call, onInspect }: { workCase: WorkCaseProjection; call: WorkCaseProjection["calls"][number]; onInspect: () => void }) {
  const customer = call.householdId
    ? { id: call.householdId, href: `/jarvis/customers?householdId=${encodeURIComponent(call.householdId)}` }
    : customerLink(workCase)
  const outcome = call.endedReason ?? "Outcome not recorded"
  return (
    <div className="jarvis-agent-fleet__activity-row">
      <button type="button" className="jarvis-agent-fleet__activity-main" onClick={onInspect}>
        <span><strong>{call.direction === "outbound" ? "Outbound call" : "Inbound call"}</strong><small>{outcome} · {activityTime(call.endedAt ?? call.startedAt)}</small></span>
        <ArrowUpRight size={15} aria-hidden />
      </button>
      <div className="jarvis-agent-fleet__activity-links">
        <Link href={`/jarvis/work?workCaseId=${encodeURIComponent(workCase.id)}`}>Work {shortId(workCase.id)}</Link>
        {customer ? <Link href={customer.href}>Customer {shortId(customer.id)}</Link> : <span>Customer link unavailable</span>}
      </div>
    </div>
  )
}

function AgentGlyph({ kind }: { kind: (typeof AGENT_FLEET)[number]["glyph"] }) {
  const Icon = kind === "orb" ? Bot : kind === "payment-collector" ? CreditCard : kind === "follow-up" ? MessageCircle : kind === "service-reminder" ? CircleDot : Phone
  return (
    <span className="jarvis-agent-fleet__glyph" data-glyph={kind} aria-hidden>
      <Icon size={17} strokeWidth={1.7} />
      <span className="jarvis-agent-fleet__glyph-ring" />
    </span>
  )
}

function sourceStatus(error: unknown): "loading" | "live" | "unavailable" {
  if (error instanceof JarvisApiError && error.status === 401) return "unavailable"
  return "unavailable"
}

function FleetLane({
  eyebrow,
  title,
  icon,
  children,
}: {
  eyebrow: string
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="jarvis-agent-fleet__lane">
      <div className="jarvis-agent-fleet__lane-heading">
        <span className="jarvis-agent-fleet__lane-icon" aria-hidden>{icon}</span>
        <span>
          <span className="jarvis-agent-fleet__eyebrow">{eyebrow}</span>
          <strong>{title}</strong>
        </span>
      </div>
      <div className="jarvis-agent-fleet__lane-body">{children}</div>
    </section>
  )
}

export default function AgentFleetSurface() {
  const { session } = useJarvisAuth()
  const [selectedKey, setSelectedKey] = useState<AgentKey>("jarvis")
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null)
  const [providerLoadState, setProviderLoadState] = useState<"idle" | "loading" | "live" | "unavailable">("idle")
  const [workCases, setWorkCases] = useState<WorkCaseProjection[]>([])
  const [workLoadState, setWorkLoadState] = useState<"idle" | "loading" | "live" | "unavailable">("idle")
  const [inspector, setInspector] = useState<InspectorTarget | null>(null)

  useEffect(() => {
    if (!session) {
      setIntegrations(null)
      setProviderLoadState("idle")
      return
    }
    let active = true
    setProviderLoadState("loading")
    void jarvisClient.integrationsStatus()
      .then((result) => {
        if (!active) return
        setIntegrations(result)
        setProviderLoadState("live")
      })
      .catch((error: unknown) => {
        if (!active) return
        setProviderLoadState(sourceStatus(error))
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      setWorkCases([])
      setWorkLoadState("idle")
      return
    }
    let active = true
    setWorkLoadState("loading")
    void jarvisClient.workCases()
      .then((result) => {
        if (!active) return
        setWorkCases(result.data)
        setWorkLoadState("live")
      })
      .catch(() => {
        if (!active) return
        setWorkCases([])
        setWorkLoadState("unavailable")
      })
    return () => {
      active = false
    }
  }, [session])

  const selected = useMemo(() => agentDefinition(selectedKey), [selectedKey])
  const activity = useMemo(() => projectAgentActivity(workCases, selectedKey), [selectedKey, workCases])
  const provider = providerStatusCopy(integrations?.vapi)
  const assistantStatus = (key: AgentKey) => assistantStatusCopy(integrations?.voiceAssistants?.find((assistant) => assistant.agentKey === key))
  const selectedAssistant = assistantStatus(selectedKey)
  const authNote = session ? null : "Sign in to inspect tenant-linked calls and Work."
  const providerDetail = providerLoadState === "loading" ? "Reading the provider-level integration source…" : provider.detail
  const workSourceNote = workLoadState === "loading"
    ? "Reading canonical Work links…"
    : workLoadState === "unavailable"
      ? "The canonical Work source is unavailable; no activity is being inferred."
      : null

  const inspectWork = (workCase: WorkCaseProjection) => {
    setInspector({
      title: workCase.title,
      detail: `Work ${workCase.id} · ${workCase.status}. This item is linked from the exact action/persona record exposed by the tenant Work projection.`,
    })
  }

  const inspectCall = (workCase: WorkCaseProjection, call: WorkCaseProjection["calls"][number]) => {
    setInspector({
      title: call.direction === "outbound" ? "Outbound call" : "Inbound call",
      detail: `Call ${call.id} · Work ${workCase.id}. ${call.endedReason ? `Provider outcome: ${call.endedReason}.` : "Outcome not recorded."} ${call.householdId ? `Customer household ${call.householdId} is linked through the call conversation.` : "No customer household is linked on the source call."}`,
    })
  }

  return (
    <main className="jarvis-agent-fleet-shell" data-jarvis-agent-fleet data-inspector-state={inspector ? "open" : "closed"}>
      <OperationalSurfaceNav active="agents" />

      <section className="jarvis-agent-fleet__intro">
        <div>
          <span className="jarvis-agent-fleet__eyebrow">AGENTS · GOVERNED FLEET</span>
          <h1>Five channels. One authority boundary.</h1>
          <p>Bounded operating channels share JARVIS truth, approval, and evidence. Select a channel to inspect what the source system can prove.</p>
        </div>
        <div className="jarvis-agent-fleet__intro-signal" data-source="manifest:v6">
          <Waves size={18} aria-hidden />
          <span><strong>Fleet manifest</strong><small>Fixed v6 channels · source-bound status</small></span>
        </div>
      </section>

      <div className="jarvis-agent-fleet__provider-strip" data-provider-status={provider.tone} data-source="api:integrations-status">
        <span className="jarvis-agent-fleet__provider-mark" aria-hidden><Activity size={16} /></span>
        <span className="jarvis-agent-fleet__provider-copy"><strong>{providerLoadState === "loading" ? "Vapi provider check in progress" : provider.label}</strong><small>{providerDetail}</small></span>
        <span className="jarvis-agent-fleet__provider-scope">Provider fact · not agent readiness</span>
      </div>

      {authNote ? <div className="jarvis-agent-fleet__auth-note" role="status"><span>{authNote}</span><Link href="/jarvis/login">Sign in <ArrowUpRight size={13} aria-hidden /></Link></div> : null}

      <div className="jarvis-agent-fleet__layout">
        <aside className="jarvis-agent-fleet__rail" aria-label="Agent fleet channels" data-agent-fleet-rail>
          <div className="jarvis-agent-fleet__rail-heading"><span>CHANNELS</span><strong>Fleet rail</strong></div>
          <div className="jarvis-agent-fleet__rail-list">
            {AGENT_FLEET.map((agent) => (
              <button
                key={agent.key}
                type="button"
                className="jarvis-agent-fleet__rail-row"
                data-selected={selected.key === agent.key ? "true" : "false"}
                data-agent-key={agent.key}
                aria-pressed={selected.key === agent.key}
                onClick={() => {
                  setSelectedKey(agent.key)
                  setInspector(null)
                }}
              >
                <AgentGlyph kind={agent.glyph} />
                <span className="jarvis-agent-fleet__rail-row-copy"><strong>{agent.label}</strong><small>{agent.key === "jarvis" ? "instruction" : "outbound channel"}</small></span>
                <span className="jarvis-agent-fleet__rail-row-state" aria-label={assistantStatus(agent.key).label}>{assistantStatus(agent.key).tone === "verified" ? "✓" : assistantStatus(agent.key).tone === "unconfigured" ? "○" : "—"}</span>
              </button>
            ))}
          </div>
          <p className="jarvis-agent-fleet__rail-note">✓ verified assistant binding · ○ not configured · — unavailable</p>
        </aside>

        <section className="jarvis-agent-fleet__stage" data-agent-fleet-stage aria-labelledby="selected-agent-title">
          <header className="jarvis-agent-fleet__stage-header">
            <div className="jarvis-agent-fleet__stage-agent">
              <AgentGlyph kind={selected.glyph} />
              <div><span className="jarvis-agent-fleet__eyebrow">SELECTED CHANNEL</span><h2 id="selected-agent-title">{selected.label}</h2></div>
            </div>
            <div className="jarvis-agent-fleet__stage-state" data-agent-status={selectedAssistant.tone} data-source="api:integrations-status.voiceAssistants">
              <span className="jarvis-agent-fleet__state-dot" aria-hidden />
              <span>{selectedAssistant.label}</span>
            </div>
          </header>

          <div className="jarvis-agent-fleet__role-band">
            <span className="jarvis-agent-fleet__eyebrow">ROLE / AUTHORITY</span>
            <p>{selected.roleCopy}</p>
            <div className="jarvis-agent-fleet__authority"><ShieldCheck size={15} aria-hidden /><span>{selected.authorityCopy}</span></div>
            <p>{selectedAssistant.detail}</p>
          </div>

          <div className="jarvis-agent-fleet__lanes">
            <FleetLane eyebrow="WORK LANE" title="Linked Work" icon={<CircleDot size={16} />}>
              {workSourceNote ? <p className="jarvis-agent-fleet__empty-title">{workSourceNote}</p> : activity.workCases.length === 0 ? <><p className="jarvis-agent-fleet__empty-title">{AGENT_ACTIVITY_UNAVAILABLE}</p><p>No Work record with an exact {selected.label} action or call edge is exposed yet.</p></> : <div className="jarvis-agent-fleet__activity-list">{activity.workCases.slice(0, 6).map((workCase) => <WorkActivityRow key={workCase.id} workCase={workCase} onInspect={() => inspectWork(workCase)} />)}</div>}
            </FleetLane>
            <FleetLane eyebrow="CALL LANE" title="Recent calls & outcomes" icon={<Phone size={16} />}>
              {workSourceNote ? <p className="jarvis-agent-fleet__empty-title">{workSourceNote}</p> : activity.calls.length === 0 ? <><p className="jarvis-agent-fleet__empty-title">{AGENT_ACTIVITY_UNAVAILABLE}</p><p>No persisted call with an exact {selected.label} channel edge is exposed yet.</p></> : <div className="jarvis-agent-fleet__activity-list">{activity.calls.slice(0, 6).map(({ workCase, call }) => <CallActivityRow key={call.id} workCase={workCase} call={call} onInspect={() => inspectCall(workCase, call)} />)}</div>}
            </FleetLane>
            <FleetLane eyebrow="EXCEPTIONS" title="Failures & handoffs" icon={<Activity size={16} />}>
              {workSourceNote ? <p className="jarvis-agent-fleet__empty-title">{workSourceNote}</p> : activity.exceptions.length === 0 ? <><p className="jarvis-agent-fleet__empty-title">No exact agent-scoped failure or handoff record is exposed yet.</p><p>Only Work statuses with an exact channel edge appear here; provider failures and handoffs are not widened by inference.</p></> : <div className="jarvis-agent-fleet__activity-list">{activity.exceptions.slice(0, 6).map((workCase) => <WorkActivityRow key={workCase.id} workCase={workCase} onInspect={() => inspectWork(workCase)} />)}</div>}
            </FleetLane>
          </div>

          <footer className="jarvis-agent-fleet__stage-footer">
            <span>Selected channel: {selected.label}</span>
            <span>Volume / queue: not exposed</span>
          </footer>
        </section>

        {inspector ? (
          <aside className="jarvis-agent-fleet__inspector" data-agent-fleet-inspector aria-label="Selected activity inspector">
            <header><div><span className="jarvis-agent-fleet__eyebrow">INSPECTOR</span><h2>{inspector.title}</h2></div><button type="button" onClick={() => setInspector(null)} aria-label="Close inspector"><X size={16} /></button></header>
            <p>{inspector.detail}</p>
          </aside>
        ) : null}
      </div>
    </main>
  )
}
