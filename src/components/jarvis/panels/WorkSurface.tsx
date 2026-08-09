"use client"

// P2.T2 — Work is the durable causal record, not a task list. This surface reads
// the exact P2.T1 projection and composes the existing action, approval, workflow,
// and receipt renderers. It does not create a second instruction state machine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Check, ChevronRight, CircleDot, Clock3, FileCheck2, Link2, RefreshCw, ShieldCheck, UserRound, Workflow, X } from "lucide-react"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { jarvisClient, type WorkAction, type WorkApproval, type WorkCaseProjection, type WorkCaseStatus, type WorkEntityLink, type WorkReceipt } from "@/lib/jarvis-client"
import { OperationalSurfaceNav, type HouseholdContext } from "../surfaces/OperationalSurfaceNav"
import "../jarvis-theme.css"

const ApprovalCockpit = dynamic(() => import("../bridge/ApprovalCockpit").then((module) => module.ApprovalCockpit), { ssr: false })
const WorkflowTheater = dynamic(() => import("./WorkflowTheater").then((module) => module.WorkflowTheater), { ssr: false })
const ReceiptContent = dynamic(() => import("../lib/ReceiptDrawer").then((module) => module.ReceiptContent), { ssr: false })

type WorkFilter = "Open" | "Needs you" | "Working" | "Waiting" | "Done" | "Failed"
type InspectorTarget =
  | { kind: "action"; action: WorkAction }
  | { kind: "receipt"; receipt: WorkReceipt }
  | { kind: "entity"; entity: WorkEntityLink }

const FILTERS: WorkFilter[] = ["Open", "Needs you", "Working", "Waiting", "Done", "Failed"]
const STATUS_ORDER: WorkCaseStatus[] = ["Needs you", "Working", "Waiting", "Failed", "Blocked", "Completed"]
export const WORK_CHAPTERS = ["WHY", "PLAN", "OWNER", "APPROVAL", "EXECUTION", "EVIDENCE & OUTCOME", "NEXT ACTION"] as const

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function ageLabel(iso: string): string {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime())
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function statusGlyph(status: WorkCaseStatus): string {
  if (status === "Needs you") return "!"
  if (status === "Working") return "›"
  if (status === "Waiting") return "·"
  if (status === "Failed" || status === "Blocked") return "×"
  return "✓"
}

function entityLabel(entity: WorkEntityLink): string {
  return `${humanize(entity.entityType)} · ${shortId(entity.entityId)}`
}

function primaryEntity(workCase: WorkCaseProjection): WorkEntityLink | null {
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
    workCaseId: params.get("workCaseId"),
    householdId: params.get("householdId"),
    invoiceId: params.get("invoiceId"),
    visitId: params.get("visitId"),
    serviceVisitId: params.get("serviceVisitId"),
    workOrderId: params.get("workOrderId"),
    appointmentId: params.get("appointmentId"),
    receiptId: params.get("receiptId"),
  }
}

function queryHasExactTarget(query: WorkSurfaceQuery): boolean {
  return Object.values(query).some(Boolean)
}

function hasEntity(workCase: WorkCaseProjection, entityTypes: string[], entityId: string | null): boolean {
  return entityId === null || workCase.linkedEntities.some((entity) => entityTypes.includes(entity.entityType) && entity.entityId === entityId)
}

export function workCaseMatchesQuery(workCase: WorkCaseProjection, query: WorkSurfaceQuery): boolean {
  if (query.workCaseId && workCase.id !== query.workCaseId) return false
  if (!hasEntity(workCase, ["household"], query.householdId)) return false
  if (!hasEntity(workCase, ["invoice"], query.invoiceId)) return false
  if (!hasEntity(workCase, ["visit", "service_visit"], query.visitId)) return false
  if (!hasEntity(workCase, ["visit", "service_visit"], query.serviceVisitId)) return false
  if (!hasEntity(workCase, ["work_order"], query.workOrderId)) return false
  if (!hasEntity(workCase, ["appointment"], query.appointmentId)) return false
  if (query.receiptId && !workCase.receipts.some((receipt) => receipt.id === query.receiptId)) return false
  return true
}

function queryForWorkCase(workCase: WorkCaseProjection): string {
  const params = new URLSearchParams({ workCaseId: workCase.id })
  const entityParams: Array<[string, string[]]> = [
    ["householdId", ["household"]],
    ["invoiceId", ["invoice"]],
    ["visitId", ["visit"]],
    ["serviceVisitId", ["service_visit"]],
    ["workOrderId", ["work_order"]],
    ["appointmentId", ["appointment"]],
  ]
  for (const [param, types] of entityParams) {
    const entity = workCase.linkedEntities.find((candidate) => types.includes(candidate.entityType))
    if (entity) params.set(param, entity.entityId)
  }
  const receipt = workCase.receipts[0]
  if (receipt) params.set("receiptId", receipt.id)
  return params.toString()
}

export function destinationForEntity(entity: WorkEntityLink, workCase: WorkCaseProjection): string | null {
  const householdId = workCase.linkedEntities.find((candidate) => candidate.entityType === "household")?.entityId
  const context = householdId ? `&householdId=${encodeURIComponent(householdId)}` : ""
  if (entity.entityType === "household") return `/jarvis/customers?householdId=${encodeURIComponent(entity.entityId)}`
  if (entity.entityType === "invoice") return `/jarvis/money?invoiceId=${encodeURIComponent(entity.entityId)}${context}`
  if (entity.entityType === "visit" || entity.entityType === "service_visit") return `/jarvis/schedule?${entity.entityType === "visit" ? "visitId" : "serviceVisitId"}=${encodeURIComponent(entity.entityId)}${context}`
  if (entity.entityType === "work_order") return `/jarvis/schedule?workOrderId=${encodeURIComponent(entity.entityId)}${context}`
  if (entity.entityType === "appointment") return `/jarvis/schedule?appointmentId=${encodeURIComponent(entity.entityId)}${context}`
  return null
}

export function stageFor(workCase: WorkCaseProjection): string {
  if (workCase.status === "Failed" || workCase.status === "Blocked") return "Evidence & outcome"
  if (workCase.approvals.some((approval) => approval.status === "pending")) return "Approval"
  if (workCase.workflows.some((workflow) => ["running", "compensating"].includes(workflow.status))) return "Execution"
  if (workCase.receipts.length > 0 || workCase.status === "Completed") return "Evidence & outcome"
  if (workCase.actions.length > 0) return "Plan"
  return "Why"
}

function highValueFact(workCase: WorkCaseProjection): string {
  const invoice = workCase.linkedEntities.find((entity) => entity.entityType === "invoice")
  if (invoice) return `Invoice ${shortId(invoice.entityId)}`
  const event = workCase.businessEvents[0]
  if (event) return humanize(event.eventType)
  const action = workCase.actions[0]
  if (action?.summary) return action.summary
  return workCase.source.channel ? humanize(workCase.source.channel) : humanize(workCase.source.kind)
}

export function filterMatches(workCase: WorkCaseProjection, filter: WorkFilter): boolean {
  if (filter === "Open") return workCase.status !== "Completed"
  if (filter === "Done") return workCase.status === "Completed"
  return workCase.status === filter
}

function approvalLabel(approval: WorkApproval): string {
  if (approval.status === "pending") return "Needs your decision"
  if (approval.status === "not_required") return "No approval required"
  return humanize(approval.status)
}

function workflowStatusLabel(status: string): string {
  if (status === "running") return "In motion"
  if (status === "completed") return "Settled"
  if (status === "failed") return "Failed"
  if (status === "compensating") return "Compensating"
  return humanize(status)
}

function useWorkCases() {
  const { session, loading: authLoading } = useJarvisAuth()
  const [cases, setCases] = useState<WorkCaseProjection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  const reload = useCallback(async () => {
    if (!session) return
    try {
      const response = await jarvisClient.workCases()
      setCases(response.data)
      setLive(true)
      setError(null)
    } catch (cause) {
      setLive(false)
      setError(cause instanceof JarvisApiError && cause.status === 401 ? "Sign in to inspect tenant Work." : "Work is unavailable — the causal projection could not be read.")
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (authLoading) {
      setLoading(true)
      return
    }
    if (!session) {
      setCases([])
      setLive(false)
      setError("Sign in to inspect tenant Work.")
      setLoading(false)
      return
    }
    setLoading(true)
    void reload()
    const interval = window.setInterval(() => void reload(), 8_000)
    return () => window.clearInterval(interval)
  }, [authLoading, reload, session])

  return { cases, loading, error, live, reload }
}

function WorkRow({ workCase, selected, onSelect }: { workCase: WorkCaseProjection; selected: boolean; onSelect: () => void }) {
  const entity = primaryEntity(workCase)
  return (
    <button
      type="button"
      className="jarvis-work-row"
      data-selected={selected ? "true" : undefined}
      data-status={workCase.status.toLowerCase().replaceAll(" ", "-")}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <span className="jarvis-work-row__status" aria-hidden>{statusGlyph(workCase.status)}</span>
      <span className="jarvis-work-row__body">
        <span className="jarvis-work-row__title">{workCase.title}</span>
        <span className="jarvis-work-row__meta">
          <span>{entity ? entityLabel(entity) : "No linked entity"}</span>
          <span>·</span>
          <span>{stageFor(workCase)}</span>
        </span>
        <span className="jarvis-work-row__fact">{highValueFact(workCase)}</span>
      </span>
      <span className="jarvis-work-row__aside">
        <span className="jarvis-work-row__source">{workCase.source.channel ?? workCase.source.kind}</span>
        <span className="jarvis-work-row__age">{ageLabel(workCase.updatedAt)}</span>
      </span>
      <ChevronRight className="jarvis-work-row__chevron h-4 w-4" aria-hidden />
    </button>
  )
}

function Chapter({
  number,
  title,
  active,
  children,
}: {
  number: string
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="jarvis-work-chapter" data-active={active ? "true" : undefined}>
      <div className="jarvis-work-chapter__rail" aria-hidden>
        <span className="jarvis-work-chapter__node">{number}</span>
      </div>
      <div className="jarvis-work-chapter__content">
        <div className="jarvis-work-chapter__heading">
          <span>{title}</span>
          {active && <span className="jarvis-work-chapter__signal">current</span>}
        </div>
        <div className="jarvis-work-chapter__body">{children}</div>
      </div>
    </section>
  )
}

function ExactEntityLinks({ entities, workCase, onInspect }: { entities: WorkEntityLink[]; workCase: WorkCaseProjection; onInspect: (entity: WorkEntityLink) => void }) {
  if (entities.length === 0) return <span className="jarvis-work-muted">No exact entity link recorded.</span>
  return (
    <div className="jarvis-work-link-row">
      {entities.map((entity) => (
        <span key={`${entity.entityType}:${entity.entityId}`} className="jarvis-work-entity-link">
          <button type="button" className="jarvis-work-link" onClick={() => onInspect(entity)} title={`Source: ${entity.via}`}>
            <Link2 className="h-3 w-3" aria-hidden />
            {entityLabel(entity)}
          </button>
          {destinationForEntity(entity, workCase) && <Link className="jarvis-work-link" href={destinationForEntity(entity, workCase)!}>Open</Link>}
        </span>
      ))}
    </div>
  )
}

function WorkSpine({
  workCase,
  onInspect,
}: {
  workCase: WorkCaseProjection
  onInspect: (target: InspectorTarget) => void
}) {
  const [approvalOpen, setApprovalOpen] = useState(false)
  const entity = primaryEntity(workCase)
  const actionIds = workCase.actions.map((action) => action.id)
  const pendingApprovals = workCase.approvals.filter((approval) => approval.status === "pending")
  const failedReceipt = workCase.receipts.find((receipt) => receipt.failure !== null)

  return (
    <article className="jarvis-work-spine" aria-labelledby="jarvis-work-case-title">
      <header className="jarvis-work-spine__header">
        <div className="jarvis-work-spine__eyebrow">
          <span className="jarvis-work-status" data-status={workCase.status.toLowerCase().replaceAll(" ", "-")}><span aria-hidden>{statusGlyph(workCase.status)}</span>{workCase.status}</span>
          <span className="jarvis-work-root">{humanize(workCase.root.kind)} · {shortId(workCase.root.id)}</span>
        </div>
        <h2 id="jarvis-work-case-title" className="jarvis-work-spine__title">{workCase.title}</h2>
        <div className="jarvis-work-spine__subline">
          <span>{workCase.source.channel ? `${humanize(workCase.source.channel)} instruction` : humanize(workCase.source.kind)}</span>
          <span>·</span>
          <span>updated {ageLabel(workCase.updatedAt)}</span>
          {entity && <><span>·</span><span>{entityLabel(entity)}</span></>}
        </div>
      </header>

      <div className="jarvis-work-spine__body">
        <Chapter number="01" title="WHY" active={stageFor(workCase) === "Why"}>
          {workCase.instruction ? (
            <>
              <p className="jarvis-work-copy">{workCase.instruction.text}</p>
              <div className="jarvis-work-facts"><span><CircleDot className="h-3.5 w-3.5" aria-hidden /> {humanize(workCase.instruction.source)}</span><span><Clock3 className="h-3.5 w-3.5" aria-hidden /> opened {ageLabel(workCase.instruction.createdAt)}</span></div>
            </>
          ) : <p className="jarvis-work-muted">No instruction root was recorded; this case is rooted at an exact {humanize(workCase.root.kind)}.</p>}
          <ExactEntityLinks entities={workCase.linkedEntities} workCase={workCase} onInspect={(entityLink) => onInspect({ kind: "entity", entity: entityLink })} />
        </Chapter>

        <Chapter number="02" title="PLAN" active={stageFor(workCase) === "Plan"}>
          {workCase.actions.length === 0 ? <p className="jarvis-work-muted">No action plan recorded.</p> : (
            <div className="jarvis-work-action-list">
              {workCase.actions.map((action) => (
                <div key={action.id} className="jarvis-work-action">
                  <div className="jarvis-work-action__topline">
                    <button type="button" className="jarvis-work-action__name" onClick={() => onInspect({ kind: "action", action })}>{action.summary ?? humanize(action.actionType)}</button>
                    <span className="jarvis-work-action__state">{humanize(action.status)}</span>
                  </div>
                  <div className="jarvis-work-action__renderer"><ActionRenderer actionType={action.actionType} payload={action.payload} compact /></div>
                  {action.dependsOn.length > 0 && <div className="jarvis-work-dependency">Depends on exact action IDs: {action.dependsOn.map(shortId).join(", ")}</div>}
                </div>
              ))}
            </div>
          )}
        </Chapter>

        <Chapter number="03" title="OWNER">
          <div className="jarvis-work-owner-line"><UserRound className="h-4 w-4" aria-hidden /><strong>Not recorded</strong><span>No authoritative assignee is present on this Work Case.</span></div>
        </Chapter>

        <Chapter number="04" title="APPROVAL" active={stageFor(workCase) === "Approval"}>
          {workCase.approvals.length === 0 ? <p className="jarvis-work-muted">No approval record is attached to this case.</p> : (
            <div className="jarvis-work-approval-list">
              {workCase.approvals.map((approval) => (
                <div key={approval.actionId} className="jarvis-work-approval-row">
                  <span className="jarvis-work-approval-dot" data-approval-status={approval.status} aria-hidden />
                  <span><strong>{approvalLabel(approval)}</strong><small>{shortId(approval.actionId)}{approval.decidedBy ? ` · ${approval.decidedBy}` : ""}</small></span>
                </div>
              ))}
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <>
              <button type="button" className="jarvis-work-primary-button" onClick={() => setApprovalOpen((open) => !open)} aria-expanded={approvalOpen}>
                <ShieldCheck className="h-4 w-4" aria-hidden /> {approvalOpen ? "Close approval controls" : "Open approval controls"}
              </button>
              {approvalOpen && <div className="jarvis-work-reused-cockpit"><ApprovalCockpit scopeActionIds={actionIds} scopeInstructionId={workCase.instruction?.id ?? null} /></div>}
            </>
          )}
        </Chapter>

        <Chapter number="05" title="EXECUTION" active={stageFor(workCase) === "Execution"}>
          {workCase.workflows.length === 0 ? <p className="jarvis-work-muted">No workflow run is linked. The case has not been promoted into execution.</p> : (
            <div className="jarvis-work-execution-list">
              {workCase.workflows.map((workflow) => (
                <div key={workflow.id} className="jarvis-work-run">
                  <div className="jarvis-work-run__header"><span><Workflow className="h-4 w-4" aria-hidden />{humanize(workflow.workflowType)}</span><strong>{workflowStatusLabel(workflow.status)}</strong></div>
                  <div className="jarvis-work-run__id">run {shortId(workflow.id)}{workflow.correlationId ? ` · trace ${shortId(workflow.correlationId)}` : ""}</div>
                  <ol className="jarvis-work-step-list">
                    {workflow.steps.map((step) => <li key={step.id} data-step-status={step.status}><span>{step.sequence + 1}</span><span>{humanize(step.stepType)}</span><small>{humanize(step.status)}</small></li>)}
                  </ol>
                </div>
              ))}
              {actionIds.length > 0 && <div className="jarvis-work-reused-theater" data-work-reused-renderer="workflow-theater"><WorkflowTheater actionIds={actionIds} /></div>}
            </div>
          )}
        </Chapter>

        <Chapter number="06" title="EVIDENCE & OUTCOME" active={stageFor(workCase) === "Evidence & outcome"}>
          {workCase.receipts.length === 0 ? (
            <p className="jarvis-work-honest-warning"><FileCheck2 className="h-4 w-4" aria-hidden /> No receipt recorded — outcome remains unverified.</p>
          ) : (
            <div className="jarvis-work-receipt-list">
              {workCase.receipts.map((receipt) => (
                <button key={receipt.id} type="button" className="jarvis-work-receipt-row" onClick={() => onInspect({ kind: "receipt", receipt })}>
                  <FileCheck2 className="h-4 w-4" aria-hidden />
                  <span><strong>{receipt.objective}</strong><small>{receipt.finalizedAt ? `Finalized ${ageLabel(receipt.finalizedAt)}` : "Still in progress · not finalized"}</small></span>
                  <ChevronRight className="ml-auto h-4 w-4" aria-hidden />
                </button>
              ))}
            </div>
          )}
          {failedReceipt && <p className="jarvis-work-failure-line"><span aria-hidden>×</span> A recorded failure is attached to the evidence chain; inspect the receipt for the backend recovery path.</p>}
          {workCase.businessEvents.length > 0 && <div className="jarvis-work-event-line"><Check className="h-4 w-4" aria-hidden /> {workCase.businessEvents.length} exact business event{workCase.businessEvents.length === 1 ? "" : "s"} linked to the recorded entities.</div>}
        </Chapter>

        <Chapter number="07" title="NEXT ACTION" active={workCase.status !== "Completed"}>
          {pendingApprovals.length > 0 ? <p className="jarvis-work-next-line"><ShieldCheck className="h-4 w-4" aria-hidden /> Approval is the recorded next boundary.</p>
            : workCase.status === "Failed" || workCase.status === "Blocked" ? <p className="jarvis-work-next-line"><UserRound className="h-4 w-4" aria-hidden /> Manual review — no frontend-generated recovery action.</p>
              : workCase.status === "Working" || workCase.status === "Waiting" ? <p className="jarvis-work-next-line"><Clock3 className="h-4 w-4" aria-hidden /> Waiting for the recorded workflow or external result.</p>
                : <p className="jarvis-work-muted">No next action recorded.</p>}
        </Chapter>
      </div>
    </article>
  )
}

function WorkInspector({ target, onClose }: { target: InspectorTarget; onClose: () => void }) {
  return (
    <aside className="jarvis-work-inspector" aria-label="Work inspector">
      <header className="jarvis-work-inspector__header"><div><span className="jarvis-work-inspector__eyebrow">Source inspector</span><h2>{target.kind === "receipt" ? "Receipt evidence" : target.kind === "action" ? "Action record" : "Exact entity link"}</h2></div><button type="button" onClick={onClose} className="jarvis-work-icon-button" aria-label="Close inspector"><X className="h-4 w-4" /></button></header>
      {target.kind === "receipt" && <div className="jarvis-work-inspector__receipt"><ReceiptContent receiptId={target.receipt.id} /></div>}
      {target.kind === "action" && <div className="jarvis-work-inspector__action"><div className="jarvis-work-inspector__id">{humanize(target.action.actionType)} · {shortId(target.action.id)}</div><ActionRenderer actionType={target.action.actionType} payload={target.action.payload} /><dl className="jarvis-work-inspector__facts"><div><dt>Status</dt><dd>{humanize(target.action.status)}</dd></div><div><dt>Instruction</dt><dd>{target.action.instructionId ? shortId(target.action.instructionId) : "Not recorded"}</dd></div><div><dt>Plan</dt><dd>{target.action.planId ? shortId(target.action.planId) : "Not recorded"}</dd></div></dl></div>}
      {target.kind === "entity" && <div className="jarvis-work-inspector__entity"><Link2 className="h-5 w-5 text-cyan-200" aria-hidden /><h3>{humanize(target.entity.entityType)}</h3><p className="jarvis-work-inspector__exact-id">{target.entity.entityId}</p><p className="jarvis-work-muted">This identifier is exact and source-backed. Use the Open link in the Spine to follow it into the matching operational surface.</p><p className="jarvis-work-inspector__provenance">Source path<br /><code>{target.entity.via}</code></p></div>}
      <button type="button" onClick={onClose} className="jarvis-work-secondary-button">Close inspector</button>
    </aside>
  )
}

export function WorkSurface() {
  const { cases, loading, error, live, reload } = useWorkCases()
  const [filter, setFilter] = useState<WorkFilter>("Open")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspector, setInspector] = useState<InspectorTarget | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const queueToggleRef = useRef<HTMLButtonElement>(null)
  const [surfaceQuery] = useState<WorkSurfaceQuery>(() => readWorkSurfaceQuery(typeof window === "undefined" ? "" : window.location.search))
  const hasExactTarget = queryHasExactTarget(surfaceQuery)

  useEffect(() => {
    if (!queueOpen && !inspector) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setInspector(null)
      setQueueOpen(false)
      window.requestAnimationFrame(() => queueToggleRef.current?.focus({ preventScroll: true }))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [inspector, queueOpen])

  const scopedCases = useMemo(() => hasExactTarget ? cases.filter((workCase) => workCaseMatchesQuery(workCase, surfaceQuery)) : cases, [cases, hasExactTarget, surfaceQuery])
  const visibleCases = useMemo(() => scopedCases.filter((workCase) => filterMatches(workCase, filter)).sort((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status) || right.updatedAt.localeCompare(left.updatedAt)), [filter, scopedCases])
  const requestedCase = useMemo(() => cases.find((workCase) => workCaseMatchesQuery(workCase, surfaceQuery)) ?? null, [cases, surfaceQuery])
  const selectedCase = scopedCases.find((workCase) => workCase.id === selectedId) ?? requestedCase ?? (!hasExactTarget ? visibleCases[0] : null)

  useEffect(() => {
    if (!requestedCase || !hasExactTarget) return
    setSelectedId((current) => current === requestedCase.id ? current : requestedCase.id)
    setFilter((current) => {
      if (requestedCase.status === "Completed") return "Done"
      if (requestedCase.status === "Needs you" || requestedCase.status === "Working" || requestedCase.status === "Waiting" || requestedCase.status === "Failed") return requestedCase.status
      return current
    })
  }, [hasExactTarget, requestedCase])

  const selectCase = (workCase: WorkCaseProjection) => {
    setSelectedId(workCase.id)
    setInspector(null)
    setQueueOpen(false)
    window.history.replaceState(null, "", `/jarvis/work?${queryForWorkCase(workCase)}`)
  }

  const context: HouseholdContext | undefined = selectedCase
    ? (() => {
      const household = selectedCase.linkedEntities.find((entity) => entity.entityType === "household")
      return household ? { id: household.entityId, label: `Household ${shortId(household.entityId)}` } : undefined
    })()
    : undefined

  return (
    <div className="jarvis-work-shell" data-jarvis-work data-queue-open={queueOpen ? "true" : "false"}>
      <OperationalSurfaceNav active="work" context={context} />
      <header className="jarvis-work-topbar">
        <div className="jarvis-work-topbar__left"><div><span className="jarvis-work-eyebrow">WORK · CAUSAL SPINE</span><h1>Work</h1></div></div>
        <div className="jarvis-work-topbar__right"><span className="jarvis-work-live"><span className="jarvis-work-live__dot" data-live={live ? "true" : "false"} aria-hidden />{live ? `${cases.length} cases observed` : loading ? "Reading source…" : "Source unavailable"}</span><button type="button" onClick={() => void reload()} className="jarvis-work-icon-button" aria-label="Refresh Work projection" title="Refresh"><RefreshCw className="h-4 w-4" /></button></div>
      </header>

      <div className="jarvis-work-intro"><p>Durable operational records from instruction to proof.</p><span>Exact roots only · no customer or invoice merging</span></div>

      <div className="jarvis-work-filterbar"><button ref={queueToggleRef} type="button" className="jarvis-work-queue-toggle" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="jarvis-work-queue"><Workflow className="h-4 w-4" /> Cases <span>{visibleCases.length}</span></button><div className="jarvis-work-filters" role="tablist" aria-label="Work cases filter">{FILTERS.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className="jarvis-work-filter" data-selected={filter === item ? "true" : undefined} onClick={() => { setFilter(item); setQueueOpen(false) }}>{item}</button>)}</div></div>

      {error && <div className="jarvis-work-banner" role="status"><span>{error}</span><Link href="/jarvis/login" className="jarvis-work-banner__link">Sign in</Link></div>}

      <main className={`jarvis-work-layout${inspector ? " jarvis-work-layout--inspector" : ""}`}>
        <section id="jarvis-work-queue" className="jarvis-work-queue" aria-label="Work cases">
          <div className="jarvis-work-queue__heading"><div><span className="jarvis-work-eyebrow">Queue</span><h2>{filter}</h2></div><span>{visibleCases.length}</span></div>
          <div className="jarvis-work-queue__rows">
            {loading && cases.length === 0 && <p className="jarvis-work-muted jarvis-work-queue__empty">Reading exact Work roots…</p>}
            {!loading && visibleCases.length === 0 && <p className="jarvis-work-muted jarvis-work-queue__empty">No cases in this lane. The projection did not invent a zero-state record.</p>}
            {visibleCases.map((workCase) => <WorkRow key={workCase.id} workCase={workCase} selected={selectedCase?.id === workCase.id} onSelect={() => selectCase(workCase)} />)}
          </div>
        </section>

        <section className="jarvis-work-main" aria-label="Causal Spine">
          {selectedCase ? <WorkSpine workCase={selectedCase} onInspect={setInspector} /> : <div className="jarvis-work-main__empty"><CircleDot className="h-6 w-6" aria-hidden /><h2>Choose a Work Case</h2><p>The seven-chapter causal record opens here when the tenant projection returns an exact root.</p></div>}
        </section>

        {inspector && <WorkInspector target={inspector} onClose={() => setInspector(null)} />}
      </main>
    </div>
  )
}

export default WorkSurface
