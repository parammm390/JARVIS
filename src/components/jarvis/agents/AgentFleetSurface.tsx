"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, ArrowUpRight, Bot, CircleDot, CreditCard, Droplets, Handshake, MapPinned, Megaphone, PackageCheck, Phone, Radar, ShieldCheck, UsersRound, Waves, X } from "lucide-react"
import { jarvisClient, type WorkCaseProjection } from "@/lib/jarvis-client"
import type { IntegrationsStatus } from "../lib/data-core"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { OperationalSurfaceNav } from "../surfaces/OperationalSurfaceNav"
import { OPERATING_AGENTS, REGISTERED_AGENT_ACTION_COUNT, assistantStatusCopy, operatingAgentDefinition, projectOperatingAgentActivity, providerStatusCopy, type AgentKey, type OperatingAgentKey } from "./agent-fleet"
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

function AgentGlyph({ kind }: { kind: (typeof OPERATING_AGENTS)[number]["glyph"] }) {
  const Icon = kind === "command" ? Bot
    : kind === "customer" ? UsersRound
      : kind === "growth" ? Megaphone
        : kind === "cash" ? CreditCard
          : kind === "field" ? MapPinned
            : kind === "sales" ? Handshake
              : kind === "stock" ? PackageCheck
                : kind === "water" ? Droplets
                  : Radar
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
  const [selectedKey, setSelectedKey] = useState<OperatingAgentKey>("command-authority")
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

  const selected = useMemo(() => operatingAgentDefinition(selectedKey), [selectedKey])
  const activityByAgent = useMemo(() => new Map(OPERATING_AGENTS.map((agent) => [agent.key, projectOperatingAgentActivity(workCases, agent.key)] as const)), [workCases])
  const activity = activityByAgent.get(selectedKey)!
  const provider = providerStatusCopy(integrations?.vapi)
  const assistantStatus = (key: AgentKey) => assistantStatusCopy(integrations?.voiceAssistants?.find((assistant) => assistant.agentKey === key))
  const selectedAssistants = selected.voiceAgentKeys.map((key) => ({ key, status: assistantStatus(key) }))
  const activeWork = activity.workCases.filter((workCase) => workCase.status !== "Completed")
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
          <span className="jarvis-agent-fleet__eyebrow">AGENTS · OPERATING CONTROL PLANE</span>
          <h1>Nine named agents. Forty-four exact actions.</h1>
          <p>A curated operating layer over the existing backend—not one tile per workflow and not a phone-provider directory. Select an agent to inspect its mandate, action authority, Work, and handoffs.</p>
        </div>
        <div className="jarvis-agent-fleet__intro-signal" data-source="registered-action-contracts">
          <Waves size={18} aria-hidden />
          <span><strong>{REGISTERED_AGENT_ACTION_COUNT} registered actions</strong><small>24 backend plugins · 9 governed agents</small></span>
        </div>
      </section>

      <div className="jarvis-agent-fleet__provider-strip" data-provider-status={provider.tone} data-source="api:integrations-status">
        <span className="jarvis-agent-fleet__provider-mark" aria-hidden><Activity size={16} /></span>
        <span className="jarvis-agent-fleet__provider-copy"><strong>{providerLoadState === "loading" ? "Vapi provider check in progress" : provider.label}</strong><small>{providerDetail}</small></span>
        <span className="jarvis-agent-fleet__provider-scope">Provider fact · not agent readiness</span>
      </div>

      {authNote ? <div className="jarvis-agent-fleet__auth-note" role="status"><span>{authNote}</span><Link href="/jarvis/login">Sign in <ArrowUpRight size={13} aria-hidden /></Link></div> : null}

      <div className="jarvis-agent-fleet__layout">
        <aside className="jarvis-agent-fleet__rail" aria-label="Operating agents" data-agent-fleet-rail>
          <div className="jarvis-agent-fleet__rail-heading"><span>OPERATING AGENTS</span><strong>Control rail</strong></div>
          <div className="jarvis-agent-fleet__rail-list">
            {OPERATING_AGENTS.map((agent) => {
              const observed = activityByAgent.get(agent.key)!
              const open = observed.workCases.filter((workCase) => workCase.status !== "Completed").length
              const stateLabel = observed.exceptions.length > 0 ? `${observed.exceptions.length} exceptions` : open > 0 ? `${open} open Work cases` : observed.workCases.length > 0 ? `${observed.workCases.length} observed outcomes` : "No observed Work"
              return (
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
                  <span className="jarvis-agent-fleet__rail-row-copy"><strong>{agent.label}</strong><small>{agent.actionTypes.length} actions · {stateLabel}</small></span>
                  <span className="jarvis-agent-fleet__rail-row-state" aria-label={stateLabel}>{observed.exceptions.length > 0 ? "!" : open > 0 ? "●" : observed.workCases.length > 0 ? "✓" : "○"}</span>
                </button>
              )
            })}
          </div>
          <p className="jarvis-agent-fleet__rail-note">● open Work · ✓ observed outcome · ! exception · ○ no observed Work</p>
        </aside>

        <section className="jarvis-agent-fleet__stage" data-agent-fleet-stage aria-labelledby="selected-agent-title">
          <header className="jarvis-agent-fleet__stage-header">
            <div className="jarvis-agent-fleet__stage-agent">
              <AgentGlyph kind={selected.glyph} />
              <div><span className="jarvis-agent-fleet__eyebrow">SELECTED OPERATING AGENT</span><h2 id="selected-agent-title">{selected.label}</h2></div>
            </div>
            <div className="jarvis-agent-fleet__stage-state" data-agent-status={activity.exceptions.length > 0 ? "unavailable" : activeWork.length > 0 ? "verified" : "unconfigured"} data-source="api:work-cases">
              <span className="jarvis-agent-fleet__state-dot" aria-hidden />
              <span>{activity.exceptions.length > 0 ? `${activity.exceptions.length} exception${activity.exceptions.length === 1 ? "" : "s"}` : activeWork.length > 0 ? `${activeWork.length} open Work case${activeWork.length === 1 ? "" : "s"}` : activity.workCases.length > 0 ? `${activity.workCases.length} recorded outcome${activity.workCases.length === 1 ? "" : "s"}` : "No observed Work"}</span>
            </div>
          </header>

          <div className="jarvis-agent-fleet__role-band">
            <span className="jarvis-agent-fleet__eyebrow">ROLE / AUTHORITY</span>
            <p>{selected.mandate}</p>
            <div className="jarvis-agent-fleet__authority"><ShieldCheck size={15} aria-hidden /><span>{selected.authorityCopy}</span></div>
          </div>

          <div className="jarvis-agent-fleet__lanes">
            <FleetLane eyebrow="OPERATING LANE" title="Observed Work" icon={<CircleDot size={16} />}>
              {workSourceNote ? <p className="jarvis-agent-fleet__empty-title">{workSourceNote}</p> : activity.workCases.length === 0 ? <><p className="jarvis-agent-fleet__empty-title">No exact {selected.label} Work is exposed yet.</p><p>This state is observational; it does not mean the registered actions are unavailable.</p></> : <div className="jarvis-agent-fleet__activity-list">{activity.workCases.slice(0, 8).map((workCase) => <WorkActivityRow key={workCase.id} workCase={workCase} onInspect={() => inspectWork(workCase)} />)}</div>}
            </FleetLane>
            <FleetLane eyebrow="ACTION AUTHORITY" title={`${selected.actionTypes.length} registered actions`} icon={<ShieldCheck size={16} />}>
              <div className="jarvis-agent-fleet__contract-list" aria-label={`${selected.label} action contracts`}>
                {selected.actionTypes.map((actionType, index) => <div key={actionType}><span>{String(index + 1).padStart(2, "0")}</span><strong>{actionType.replaceAll("_", " ")}</strong></div>)}
              </div>
            </FleetLane>
            <FleetLane eyebrow="CHANNELS & HANDOFFS" title="Voice and exceptions" icon={<Phone size={16} />}>
              <div className="jarvis-agent-fleet__channel-facts">
                {selectedAssistants.length > 0 ? selectedAssistants.map(({ key, status }) => <div key={key} data-agent-status={status.tone}><strong>{key.replaceAll("-", " ")}</strong><span>{status.label}</span><small>{status.detail}</small></div>) : <div><strong>No dedicated phone channel</strong><span>Action-contract agent</span><small>This agent operates through registered domain actions and Work evidence, not a Vapi assistant.</small></div>}
              </div>
              {activity.calls.length > 0 ? <div className="jarvis-agent-fleet__activity-list jarvis-agent-fleet__activity-list--calls">{activity.calls.slice(0, 4).map(({ workCase, call }) => <CallActivityRow key={call.id} workCase={workCase} call={call} onInspect={() => inspectCall(workCase, call)} />)}</div> : null}
              {activity.exceptions.length > 0 ? <div className="jarvis-agent-fleet__activity-list jarvis-agent-fleet__activity-list--exceptions">{activity.exceptions.slice(0, 4).map((workCase) => <WorkActivityRow key={workCase.id} workCase={workCase} onInspect={() => inspectWork(workCase)} />)}</div> : <p>No exact failures or blocked handoffs are recorded for this agent.</p>}
            </FleetLane>
          </div>

          <footer className="jarvis-agent-fleet__stage-footer">
            <span>{selected.label} owns {selected.actionTypes.length} of {REGISTERED_AGENT_ACTION_COUNT} registered actions</span>
            <span>Activity is projected from exact Work action types</span>
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
