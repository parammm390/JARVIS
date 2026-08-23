"use client"

// P2.T2 — Work is the durable causal record, not a task list. This surface reads
// the exact P2.T1 projection and composes the existing action, approval, workflow,
// and receipt renderers. It does not create a second instruction state machine.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Check, ChevronRight, CircleDot, Clock3, FileCheck2, Link2, RefreshCw, Search, ShieldCheck, UserRound, Workflow, X } from "lucide-react"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { JarvisApiError } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { jarvisClient, type EmployeeDirectoryEntry, type WorkAction, type WorkApproval, type WorkCaseProjection, type WorkCaseStatus, type WorkEntityLink, type WorkReceipt } from "@/lib/jarvis-client"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { OperationalSurfaceNav, type HouseholdContext } from "../surfaces/OperationalSurfaceNav"
import { destinationForEntity, filterMatches, groupWorkCases, primaryEntity, readWorkSurfaceQuery, stageFor, workCaseMatchesQuery, WORK_CHAPTERS, type WorkCaseGroup, type WorkFilter, type WorkSurfaceQuery } from "./work-surface-model"
import { buildWorkInspectorFacts } from "./work-inspector"
import { useWorkspaceConfig } from "../WorkspaceConfigProvider"
import { inspectorFieldVisible } from "../lib/workspace-config"
import "../jarvis-theme.css"
import { useOperatingInteractionActions } from "../kernel/operating-interaction"

const ApprovalCockpit = dynamic(() => import("../bridge/ApprovalCockpit").then((module) => module.ApprovalCockpit), { ssr: false })
const ExecutionTheater = dynamic(() => import("./ExecutionTheater").then((module) => module.ExecutionTheater), { ssr: false })
const OperationalTimeMachine = dynamic(() => import("./OperationalTimeMachine").then((module) => module.OperationalTimeMachine), { ssr: false })
const WorkflowTheater = dynamic(() => import("./WorkflowTheater").then((module) => module.WorkflowTheater), { ssr: false })
const ReceiptContent = dynamic(() => import("../lib/ReceiptDrawer").then((module) => module.ReceiptContent), { ssr: false })

type InspectorTarget =
  | { kind: "action"; action: WorkAction }
  | { kind: "receipt"; receipt: WorkReceipt }
  | { kind: "entity"; entity: WorkEntityLink }

const FILTERS: WorkFilter[] = ["Open", "Needs you", "Working", "Waiting", "Done", "Failed"]
const STATUS_ORDER: WorkCaseStatus[] = ["Needs you", "Working", "Waiting", "Failed", "Blocked", "Completed"]

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

function queryHasExactTarget(query: WorkSurfaceQuery): boolean {
  return Object.values(query).some(Boolean)
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

function highValueFact(workCase: WorkCaseProjection): string {
  const invoice = workCase.linkedEntities.find((entity) => entity.entityType === "invoice")
  if (invoice) return `Invoice ${shortId(invoice.entityId)}`
  const event = workCase.businessEvents[0]
  if (event) return humanize(event.eventType)
  const action = workCase.actions[0]
  if (action?.summary) return action.summary
  return workCase.source.channel ? humanize(workCase.source.channel) : humanize(workCase.source.kind)
}

function workCaseMatchesSearch(workCase: WorkCaseProjection, query: string): boolean {
  if (!query) return true
  const haystack = [
    workCase.title,
    workCase.status,
    workCase.id,
    workCase.source.channel,
    workCase.source.kind,
    ...workCase.actions.flatMap((action) => [action.actionType, action.summary]),
    ...workCase.linkedEntities.flatMap((entity) => [entity.entityType, entity.entityId]),
  ].filter(Boolean).join(" ").toLocaleLowerCase()
  return haystack.includes(query.toLocaleLowerCase())
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

function observationLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ? String(value) : "No bounded observation was recorded."
  const row = value as Record<string, unknown>
  if (row.deduplicated === true) return "A matching prior action was observed; no duplicate side effect was sent."
  if (row.waitingFor) return `Waiting for ${String(row.waitingFor)}`
  if (row.failure && typeof row.failure === "object") return `Failure observed: ${String((row.failure as Record<string, unknown>).message ?? "provider/action failure")}`
  if (row.executionResult) return "The typed action result, receipt, and business state were observed."
  if (row.query) return "A deterministic Operational Query result was observed."
  if (row.recovery) return `Recovery path: ${String(row.recovery)}`
  return "Canonical business state was observed and persisted."
}

function useWorkCases() {
  const { session, loading: authLoading } = useJarvisAuth()
  const projection = useBusinessProjection(businessProjections.workCases(), { enabled: Boolean(session) })
  const denied = !authLoading && (!session || (projection.error instanceof JarvisApiError && projection.error.status === 401))
  const live = projection.data !== null
  const stale = live && (projection.stale || projection.status === "error")
  const error = denied
    ? "Sign in to inspect tenant Work."
    : projection.error
      ? live
        ? "Latest refresh was delayed. Showing the last verified Work projection."
        : "Work is unavailable — the causal projection could not be read."
      : null
  return {
    cases: projection.data ?? [],
    loading: authLoading || (Boolean(session) && projection.data === null && (projection.status === "idle" || projection.status === "loading")),
    error,
    live,
    stale,
    denied,
    reload: () => { void projection.refresh().catch(() => undefined) },
  }
}

function WorkRow({ workCase, selected, count = 1, onSelect }: { workCase: WorkCaseProjection; selected: boolean; count?: number; onSelect: () => void }) {
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
        {count > 1 && <span className="jarvis-work-row__count">{count} related</span>}
        <span className="jarvis-work-row__source">{workCase.source.channel ?? workCase.source.kind}</span>
        <span className="jarvis-work-row__age">{ageLabel(workCase.updatedAt)}</span>
      </span>
      <ChevronRight className="jarvis-work-row__chevron h-4 w-4" aria-hidden />
    </button>
  )
}

function WorkGroup({ group, selectedId, onSelect }: { group: WorkCaseGroup; selectedId: string | null; onSelect: (workCase: WorkCaseProjection) => void }) {
  const representative = group.cases[0]!
  const selected = group.cases.some((workCase) => workCase.id === selectedId)
  return (
    <div className="jarvis-work-group" data-group-size={group.cases.length}>
      <WorkRow workCase={representative} selected={selected} count={group.cases.length} onSelect={() => onSelect(representative)} />
      {group.cases.length > 1 && (
        <details className="jarvis-work-group__records">
          <summary>{group.cases.length} exact records <span>expand</span></summary>
          <div>
            {group.cases.map((workCase) => (
              <button key={workCase.id} type="button" data-selected={workCase.id === selectedId ? "true" : undefined} onClick={() => onSelect(workCase)}>
                <span><strong>{shortId(workCase.id)}</strong><small>{primaryEntity(workCase) ? entityLabel(primaryEntity(workCase)!) : "No linked entity"}</small></span>
                <span>{ageLabel(workCase.updatedAt)}<ChevronRight className="h-3.5 w-3.5" aria-hidden /></span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
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
  onRefresh,
}: {
  workCase: WorkCaseProjection
  onInspect: (target: InspectorTarget) => void
  onRefresh: () => void
}) {
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [objectiveBusy, setObjectiveBusy] = useState<"continue" | "interrupt" | "redirect" | null>(null)
  const [objectiveError, setObjectiveError] = useState<string | null>(null)
  const [redirectObjective, setRedirectObjective] = useState("")
  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [handoffTarget, setHandoffTarget] = useState("")
  const [handoffNote, setHandoffNote] = useState("")
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const entity = primaryEntity(workCase)
  const actionIds = workCase.actions.map((action) => action.id)
  const pendingApprovals = workCase.approvals.filter((approval) => approval.status === "pending")
  const failedReceipt = workCase.receipts.find((receipt) => receipt.failure !== null)
  const objective = workCase.objectiveLoop
  const latestIteration = objective?.iterations.at(-1)
  const currentOwnerId = workCase.durableWork?.assignedTo ?? workCase.durableWork?.currentOwnerId ?? workCase.durableWork?.initiatedBy ?? null
  const currentOwner = employees.find((employee) => employee.id === currentOwnerId)
  const activeHandoffTargets = employees.filter((employee) => employee.status === "active" && employee.id !== currentOwnerId)
  const canHandoff = Boolean(workCase.durableWork && viewerUserId && viewerUserId === currentOwnerId)

  useEffect(() => {
    let cancelled = false
    setDirectoryError(null)
    Promise.all([jarvisClient.employees(), jarvisClient.me()])
      .then(([directory, me]) => {
        if (cancelled) return
        setEmployees(directory.employees)
        setViewerUserId(me.userId)
      })
      .catch((error) => {
        if (!cancelled) setDirectoryError(error instanceof Error ? error.message : "Employee directory unavailable")
      })
    return () => { cancelled = true }
  }, [workCase.durableWork?.id])

  const controlObjective = async (command: "continue" | "interrupt" | "redirect") => {
    setObjectiveBusy(command)
    setObjectiveError(null)
    try {
      await jarvisClient.controlObjective(workCase.root.id, command === "redirect"
        ? { command, objective: redirectObjective.trim(), channel: "text", idempotencyKey: `workspace-redirect:${crypto.randomUUID()}` }
        : { command })
      if (command === "redirect") setRedirectObjective("")
      onRefresh()
    } catch (error) {
      setObjectiveError(error instanceof Error ? error.message : "Objective control failed")
    } finally {
      setObjectiveBusy(null)
    }
  }

  const submitHandoff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workCase.durableWork || !handoffTarget || handoffBusy) return
    setHandoffBusy(true)
    setHandoffError(null)
    try {
      await jarvisClient.handoffWork(workCase.durableWork.id, { targetEmployeeId: handoffTarget, ...(handoffNote.trim() ? { note: handoffNote.trim() } : {}) })
      setHandoffTarget("")
      setHandoffNote("")
      onRefresh()
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "Work handoff failed")
    } finally {
      setHandoffBusy(false)
    }
  }

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
          {objective && <div className="jarvis-work-action" data-objective-state={objective.state}><div className="jarvis-work-action__topline"><strong>Objective</strong><span className="jarvis-work-action__state">{humanize(objective.state)}</span></div><p className="jarvis-work-copy">{objective.objective}</p><div className="jarvis-work-facts"><span>revision {objective.revision}</span><span>{objective.budget.steps}/{objective.budget.maxSteps} steps</span><span>{objective.budget.actions}/{objective.budget.maxActions} actions</span><span>{objective.budget.queries}/{objective.budget.maxQueries} queries</span></div></div>}
          {workCase.instruction ? (
            <>
              <p className="jarvis-work-copy">{workCase.instruction.text}</p>
              <div className="jarvis-work-facts"><span><CircleDot className="h-3.5 w-3.5" aria-hidden /> {humanize(workCase.instruction.source)}</span><span><Clock3 className="h-3.5 w-3.5" aria-hidden /> opened {ageLabel(workCase.instruction.createdAt)}</span></div>
            </>
          ) : <p className="jarvis-work-muted">No instruction root was recorded; this case is rooted at an exact {humanize(workCase.root.kind)}.</p>}
          <ExactEntityLinks entities={workCase.linkedEntities} workCase={workCase} onInspect={(entityLink) => onInspect({ kind: "entity", entity: entityLink })} />
        </Chapter>

        <Chapter number="02" title="PLAN" active={stageFor(workCase) === "Plan"}>
          {objective && objective.iterations.length > 0 && <div className="jarvis-work-execution-list" aria-label="Objective iterations">{objective.iterations.map((iteration) => <div key={iteration.id} className="jarvis-work-run" data-objective-outcome={iteration.outcome ?? iteration.phase}><div className="jarvis-work-run__header"><span><CircleDot className="h-4 w-4" aria-hidden />Iteration {iteration.stepNumber} · {humanize(iteration.decisionKind ?? iteration.phase)}</span><strong>{humanize(iteration.outcome ?? iteration.phase)}</strong></div><p className="jarvis-work-copy">{iteration.reason ?? "Decision reason has not been recorded yet."}</p><div className="jarvis-work-muted">Observed · {observationLabel(iteration.observation)}</div>{iteration.plannerAttempts.length > 0 && <div className="jarvis-work-facts"><span>{iteration.plannerAttempts.length} planner attempt{iteration.plannerAttempts.length === 1 ? "" : "s"}</span><span>{iteration.plannerAttempts.at(-1)?.provider ?? "provider pending"}</span></div>}</div>)}</div>}
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
          <div className="jarvis-work-owner-line"><UserRound className="h-4 w-4" aria-hidden /><strong>{currentOwner?.displayName ?? (currentOwnerId ? shortId(currentOwnerId) : "Not recorded")}</strong>{currentOwner && <span>{currentOwner.roles.map(humanize).join(" · ") || humanize(currentOwner.legacyRole)}</span>}<span>{workCase.durableWork?.authorityContext ? "Employee identity and authority context are attached; every later inspection and effect is re-evaluated for the current owner." : "No authoritative assignee is present on this Work Case."}</span></div>
          {(workCase.durableWork?.handoffs ?? []).map((handoff) => {
            const from = employees.find((employee) => employee.id === handoff.fromEmployeeId)
            const to = employees.find((employee) => employee.id === handoff.toEmployeeId)
            return <p key={handoff.sequence} className="jarvis-work-muted">Handoff {handoff.sequence} · {from?.displayName ?? (handoff.fromEmployeeId ? shortId(handoff.fromEmployeeId) : "unassigned")} → {to?.displayName ?? (handoff.toEmployeeId ? shortId(handoff.toEmployeeId) : "unassigned")} · {ageLabel(handoff.createdAt)}{handoff.note ? ` · ${handoff.note}` : ""}</p>
          })}
          {canHandoff && activeHandoffTargets.length > 0 && <form className="jarvis-work-redirect jarvis-work-handoff" onSubmit={submitHandoff}><label htmlFor={`handoff-owner-${workCase.id}`}>Hand off this same Work</label><div><select id={`handoff-owner-${workCase.id}`} value={handoffTarget} onChange={(event) => setHandoffTarget(event.target.value)}><option value="">Choose an active employee</option>{activeHandoffTargets.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName ?? shortId(employee.id)} · {employee.roles.map(humanize).join(" / ") || humanize(employee.legacyRole)}</option>)}</select><input value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} placeholder="Optional handoff note" maxLength={2_000} /><button type="submit" className="jarvis-work-secondary-button" disabled={handoffBusy || !handoffTarget}>{handoffBusy ? "Handing off…" : "Hand off"}</button></div></form>}
          {!directoryError && workCase.durableWork && viewerUserId && !canHandoff && <p className="jarvis-work-muted">Only the current owner can transfer responsibility; approvals remain available to other authorized employees.</p>}
          {directoryError && <p className="jarvis-work-honest-warning">{directoryError}</p>}
          {handoffError && <p className="jarvis-work-honest-warning">{handoffError}</p>}
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
          {workCase.durableWork ? (
            <div className="jarvis-work-execution-list">
              {(workCase.operations ?? []).map((operation) => {
                const resolved = operation.counts.succeeded + operation.counts.failed + operation.counts.skipped
                return (
                  <div key={operation.id} className="jarvis-work-run" data-operation-status={operation.status}>
                    <div className="jarvis-work-run__header"><span><Workflow className="h-4 w-4" aria-hidden />{humanize(operation.operationType)}</span><strong>{humanize(operation.status)}</strong></div>
                    <div className="jarvis-work-run__id">operation {shortId(operation.id)} · frozen cohort {operation.targetCount}</div>
                    <div className="jarvis-work-facts">
                      <span>{resolved}/{operation.targetCount} resolved</span>
                      <span>{operation.counts.succeeded} succeeded</span>
                      <span>{operation.counts.retry} retry</span>
                      <span>{operation.counts.failed} failed</span>
                      <span>{operation.counts.skipped} skipped</span>
                    </div>
                  </div>
                )
              })}
              <ExecutionTheater workId={workCase.durableWork.id} onRefresh={onRefresh} />
            </div>
          ) : workCase.workflows.length === 0 && !workCase.operations?.length ? <p className="jarvis-work-muted">No workflow run or durable operation is linked. The case has not been promoted into execution.</p> : <div className="jarvis-work-execution-list">{workCase.workflows.map((workflow) => <div key={workflow.id} className="jarvis-work-run"><div className="jarvis-work-run__header"><span><Workflow className="h-4 w-4" aria-hidden />{humanize(workflow.workflowType)}</span><strong>{workflowStatusLabel(workflow.status)}</strong></div><div className="jarvis-work-run__id">run {shortId(workflow.id)}{workflow.correlationId ? ` · trace ${shortId(workflow.correlationId)}` : ""}</div><ol className="jarvis-work-step-list">{workflow.steps.map((step) => <li key={step.id} data-step-status={step.status}><span>{step.sequence + 1}</span><span>{humanize(step.stepType)}</span><small>{humanize(step.status)}</small></li>)}</ol></div>)}{actionIds.length > 0 && <div className="jarvis-work-reused-theater" data-work-reused-renderer="workflow-theater"><WorkflowTheater actionIds={actionIds} /></div>}</div>}
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

        {workCase.durableWork ? <Chapter number="07" title="TIME MACHINE">
          <OperationalTimeMachine workId={workCase.durableWork.id} />
        </Chapter> : null}

        <Chapter number={workCase.durableWork ? "08" : "07"} title="NEXT ACTION" active={workCase.status !== "Completed"}>
          {objective ? <div><p className="jarvis-work-next-line"><Clock3 className="h-4 w-4" aria-hidden /> {objective.nextStep ?? (objective.state === "completed" ? "The objective has a verified terminal outcome." : "Canonical re-inspection will determine the next bounded step.")}</p>{objective.reason && <p className="jarvis-work-muted">Why · {objective.reason}</p>}{latestIteration && <p className="jarvis-work-muted">Last observed · {observationLabel(latestIteration.observation)}</p>}{objective.nextRunAt && <p className="jarvis-work-muted">Scheduled continuation · {new Date(objective.nextRunAt).toLocaleString()}</p>}<div className="jarvis-work-link-row">{["blocked", "waiting"].includes(objective.state) && <button type="button" className="jarvis-work-secondary-button" disabled={objectiveBusy !== null} onClick={() => void controlObjective("continue")}>{objectiveBusy === "continue" ? "Continuing…" : "Continue objective"}</button>}{["continue", "waiting", "awaiting_approval"].includes(objective.state) && <button type="button" className="jarvis-work-secondary-button" disabled={objectiveBusy !== null} onClick={() => void controlObjective("interrupt")}>{objectiveBusy === "interrupt" ? "Interrupting…" : "Interrupt loop"}</button>}</div>{objective.state !== "completed" && objective.state !== "failed" && <form className="jarvis-work-redirect" onSubmit={(event) => { event.preventDefault(); if (redirectObjective.trim()) void controlObjective("redirect") }}><label htmlFor={`redirect-objective-${workCase.id}`}>Redirect this same Work</label><div><input id={`redirect-objective-${workCase.id}`} value={redirectObjective} onChange={(event) => setRedirectObjective(event.target.value)} placeholder="Give JARVIS a revised outcome" maxLength={10_000} /><button type="submit" className="jarvis-work-secondary-button" disabled={objectiveBusy !== null || !redirectObjective.trim()}>{objectiveBusy === "redirect" ? "Redirecting…" : "Redirect"}</button></div></form>}{objectiveError && <p className="jarvis-work-honest-warning">{objectiveError}</p>}</div>
            : pendingApprovals.length > 0 ? <p className="jarvis-work-next-line"><ShieldCheck className="h-4 w-4" aria-hidden /> Approval is the recorded next boundary.</p>
            : workCase.status === "Failed" || workCase.status === "Blocked" ? <p className="jarvis-work-next-line"><UserRound className="h-4 w-4" aria-hidden /> Manual review — no frontend-generated recovery action.</p>
              : workCase.status === "Working" || workCase.status === "Waiting" ? <p className="jarvis-work-next-line"><Clock3 className="h-4 w-4" aria-hidden /> Waiting for the recorded workflow or external result.</p>
                : <p className="jarvis-work-muted">No next action recorded.</p>}
        </Chapter>
      </div>
    </article>
  )
}

function WorkInspector({ target, workCase, onClose }: { target: InspectorTarget; workCase: WorkCaseProjection; onClose: () => void }) {
  const { config } = useWorkspaceConfig()
  const context = buildWorkInspectorFacts(workCase).filter((fact) => inspectorFieldVisible(fact.label, config))
  return (
    <aside className="jarvis-work-inspector" aria-label="Work inspector">
      <header className="jarvis-work-inspector__header"><div><span className="jarvis-work-inspector__eyebrow">Source inspector</span><h2>{target.kind === "receipt" ? "Receipt evidence" : target.kind === "action" ? "Action record" : "Exact entity link"}</h2></div><button type="button" onClick={onClose} className="jarvis-work-icon-button" aria-label="Close inspector"><X className="h-4 w-4" /></button></header>
      {target.kind === "receipt" && <div className="jarvis-work-inspector__receipt"><ReceiptContent receiptId={target.receipt.id} /></div>}
      {target.kind === "action" && <div className="jarvis-work-inspector__action"><div className="jarvis-work-inspector__id">{humanize(target.action.actionType)} · {shortId(target.action.id)}</div><ActionRenderer actionType={target.action.actionType} payload={target.action.payload} /><dl className="jarvis-work-inspector__facts"><div><dt>Status</dt><dd>{humanize(target.action.status)}</dd></div><div><dt>Instruction</dt><dd>{target.action.instructionId ? shortId(target.action.instructionId) : "Not recorded"}</dd></div><div><dt>Plan</dt><dd>{target.action.planId ? shortId(target.action.planId) : "Not recorded"}</dd></div></dl></div>}
      {target.kind === "entity" && <div className="jarvis-work-inspector__entity"><Link2 className="h-5 w-5 text-cyan-200" aria-hidden /><h3>{humanize(target.entity.entityType)}</h3><p className="jarvis-work-inspector__exact-id">{target.entity.entityId}</p><p className="jarvis-work-muted">This identifier is exact and source-backed. Use the Open link in the Spine to follow it into the matching operational surface.</p><p className="jarvis-work-inspector__provenance">Source path<br /><code>{target.entity.via}</code></p></div>}
      <section className="jarvis-work-inspector__context" aria-label="Operational context">
        <span className="jarvis-work-inspector__eyebrow">Operational context</span>
        <dl className="jarvis-work-inspector__facts">{context.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      </section>
      <button type="button" onClick={onClose} className="jarvis-work-secondary-button">Close inspector</button>
    </aside>
  )
}

export function WorkSurface() {
  const { cases, loading, error, live, stale, denied, reload } = useWorkCases()
  const { focusEntity, setFilters, capture } = useOperatingInteractionActions()
  const [filter, setFilter] = useState<WorkFilter>("Open")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspector, setInspector] = useState<InspectorTarget | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [objectiveDraft, setObjectiveDraft] = useState("")
  const [objectiveStarting, setObjectiveStarting] = useState(false)
  const [objectiveStartError, setObjectiveStartError] = useState<string | null>(null)
  const [interactiveReady, setInteractiveReady] = useState(false)
  const queueToggleRef = useRef<HTMLButtonElement>(null)
  const [surfaceQuery, setSurfaceQuery] = useState<WorkSurfaceQuery>(() => readWorkSurfaceQuery(typeof window === "undefined" ? "" : window.location.search))
  const hasExactTarget = queryHasExactTarget(surfaceQuery)

  useEffect(() => {
    // Client components still participate in server rendering, so the state
    // initializer above intentionally starts from an empty search string on the
    // server. Re-read the real address after hydration (and on history travel),
    // otherwise a direct Work link silently opens the first queue case instead
    // of the exact durable Work named by the URL.
    const syncSurfaceQuery = () => setSurfaceQuery(readWorkSurfaceQuery(window.location.search))
    setInteractiveReady(true)
    syncSurfaceQuery()
    window.addEventListener("popstate", syncSurfaceQuery)
    return () => window.removeEventListener("popstate", syncSurfaceQuery)
  }, [])

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
  const visibleCases = useMemo(() => scopedCases.filter((workCase) => filterMatches(workCase, filter) && workCaseMatchesSearch(workCase, search.trim())).sort((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status) || right.updatedAt.localeCompare(left.updatedAt)), [filter, scopedCases, search])
  const visibleGroups = useMemo(() => groupWorkCases(visibleCases), [visibleCases])
  const requestedCase = useMemo(() => cases.find((workCase) => workCaseMatchesQuery(workCase, surfaceQuery)) ?? null, [cases, surfaceQuery])
  const selectedCase = scopedCases.find((workCase) => workCase.id === selectedId) ?? requestedCase ?? null

  useEffect(() => {
    if (!requestedCase || !hasExactTarget) return
    setSelectedId((current) => current === requestedCase.id ? current : requestedCase.id)
    focusEntity({ entityType: "work", entityId: requestedCase.id }, requestedCase.title ?? `Work ${shortId(requestedCase.id)}`)
    setFilter((current) => {
      if (requestedCase.status === "Completed") return "Done"
      if (requestedCase.status === "Needs you" || requestedCase.status === "Working" || requestedCase.status === "Waiting" || requestedCase.status === "Failed") return requestedCase.status
      return current
    })
  }, [focusEntity, hasExactTarget, requestedCase])

  const selectCase = (workCase: WorkCaseProjection) => {
    setSelectedId(workCase.id)
    focusEntity({ entityType: "work", entityId: workCase.id }, workCase.title ?? `Work ${shortId(workCase.id)}`)
    setInspector(null)
    setQueueOpen(false)
    window.history.replaceState(null, "", `/jarvis/work?${queryForWorkCase(workCase)}`)
  }

  useEffect(() => {
    setFilters([
      { field: "workStatus", operator: "eq", value: filter },
      ...(search.trim() ? [{ field: "workSearch", operator: "contains" as const, value: search.trim() }] : []),
    ])
  }, [filter, search, setFilters])

  const assignObjective = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const objective = objectiveDraft.trim()
    if (!objective || objectiveStarting) return
    setObjectiveStarting(true)
    setObjectiveStartError(null)
    try {
      const result = await jarvisClient.startObjective({
        objective,
        channel: "text",
        idempotencyKey: `workspace-objective:${crypto.randomUUID()}`,
        activeContext: capture("typed", null),
      })
      setObjectiveDraft("")
      setFilter("Open")
      setSelectedId(result.objective.workId)
      const objectiveQuery = `?workCaseId=${encodeURIComponent(result.objective.workId)}`
      setSurfaceQuery(readWorkSurfaceQuery(objectiveQuery))
      window.history.replaceState(null, "", `/jarvis/work${objectiveQuery}`)
      reload()
    } catch (error) {
      setObjectiveStartError(error instanceof Error ? error.message : "JARVIS could not accept the objective")
    } finally {
      setObjectiveStarting(false)
    }
  }

  const context: HouseholdContext | undefined = selectedCase
    ? (() => {
      const household = selectedCase.linkedEntities.find((entity) => entity.entityType === "household")
      return household ? { id: household.entityId, label: `Household ${shortId(household.entityId)}` } : undefined
    })()
    : undefined

  return (
    <div className="jarvis-work-shell" data-jarvis-work data-work-interactive-ready={interactiveReady ? "true" : "false"} data-queue-open={queueOpen ? "true" : "false"}>
      <OperationalSurfaceNav active="work" context={context} workCaseId={selectedCase?.id ?? surfaceQuery.workCaseId} />
      <header className="jarvis-work-topbar">
        <div className="jarvis-work-topbar__left"><div><span className="jarvis-work-eyebrow">WORK · CAUSAL SPINE</span><h1>Work</h1></div></div>
        <div className="jarvis-work-topbar__right"><span className="jarvis-work-live"><span className="jarvis-work-live__dot" data-live={live && !stale ? "true" : "false"} aria-hidden />{live ? stale ? `${cases.length} cases · refresh delayed` : `${cases.length} cases observed` : loading ? "Reading source…" : "Source unavailable"}</span><button type="button" onClick={() => void reload()} className="jarvis-work-icon-button" aria-label="Refresh Work projection" title="Refresh"><RefreshCw className="h-4 w-4" /></button></div>
      </header>

      <div className="jarvis-work-intro"><div><p>Give JARVIS an outcome to own.</p><span>Durable Work · one governed step at a time · observed results</span></div><form className="jarvis-work-objective-intake" onSubmit={assignObjective}><label className="sr-only" htmlFor="jarvis-work-objective">Business objective</label><input id="jarvis-work-objective" value={objectiveDraft} onChange={(event) => setObjectiveDraft(event.target.value)} placeholder="e.g. Follow up with Avery and make sure the outcome is recorded" maxLength={10_000} /><button type="submit" disabled={objectiveStarting || !objectiveDraft.trim()}>{objectiveStarting ? "Assigning…" : "Assign objective"}</button>{objectiveStartError && <small role="alert">{objectiveStartError}</small>}</form></div>

      <div className="jarvis-work-filterbar"><button ref={queueToggleRef} type="button" className="jarvis-work-queue-toggle" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="jarvis-work-queue"><Workflow className="h-4 w-4" /> Cases <span>{visibleCases.length}</span></button><div className="jarvis-work-filters" role="tablist" aria-label="Work cases filter">{FILTERS.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className="jarvis-work-filter" data-selected={filter === item ? "true" : undefined} onClick={() => { setFilter(item); setQueueOpen(false) }}>{item}<span>{scopedCases.filter((workCase) => filterMatches(workCase, item)).length}</span></button>)}</div><label className="jarvis-work-search"><Search className="h-4 w-4" aria-hidden /><span className="sr-only">Search Work cases</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Work" /></label></div>

      {error && <div className="jarvis-work-banner" role="status"><span>{error}</span>{denied ? <Link href="/jarvis/login" className="jarvis-work-banner__link">Sign in</Link> : <button type="button" className="jarvis-work-banner__link" onClick={() => void reload()}>Retry now</button>}</div>}

      <main className={`jarvis-work-layout${inspector ? " jarvis-work-layout--inspector" : ""}`}>
        <section id="jarvis-work-queue" className="jarvis-work-queue" aria-label="Work cases">
          <div className="jarvis-work-queue__heading"><div><span className="jarvis-work-eyebrow">Queue</span><h2>{filter}</h2></div><span>{visibleGroups.length} pattern{visibleGroups.length === 1 ? "" : "s"} · {visibleCases.length} case{visibleCases.length === 1 ? "" : "s"}</span></div>
          <div className="jarvis-work-queue__rows">
            {loading && cases.length === 0 && <p className="jarvis-work-muted jarvis-work-queue__empty">Reading exact Work roots…</p>}
            {!loading && visibleCases.length === 0 && <p className="jarvis-work-muted jarvis-work-queue__empty">No cases in this lane. The projection did not invent a zero-state record.</p>}
            {visibleGroups.map((group) => <WorkGroup key={group.key} group={group} selectedId={selectedCase?.id ?? null} onSelect={selectCase} />)}
          </div>
        </section>

        <section className="jarvis-work-main" aria-label="Causal Spine">
          {selectedCase ? <WorkSpine workCase={selectedCase} onInspect={setInspector} onRefresh={reload} /> : <div className="jarvis-work-main__empty"><CircleDot className="h-6 w-6" aria-hidden /><h2>Choose a Work Case</h2><p>The causal record opens here when the tenant projection returns an exact root.</p></div>}
        </section>

        {inspector && selectedCase && <WorkInspector target={inspector} workCase={selectedCase} onClose={() => setInspector(null)} />}
      </main>
    </div>
  )
}

export default WorkSurface
