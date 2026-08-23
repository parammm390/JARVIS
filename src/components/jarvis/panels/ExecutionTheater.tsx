"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, Ban, Check, ChevronRight, CircleDot, Clock3, FileCheck2, GitBranch, Laptop, Link2, LoaderCircle, RotateCcw, ShieldCheck, UserRound, Workflow } from "lucide-react"
import { jarvisClient, type ExecutionActionNode, type ExecutionControl, type ExecutionWorkflow } from "@/lib/jarvis-client"
import { ActionRenderer } from "../ui/renderers/ActionRenderer"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { boundedOutcomeSummary, buildExecutionLayers, shortId } from "./execution-theater-model"
import { useWorkspaceConfig } from "../WorkspaceConfigProvider"
import { vocabularyLabel } from "../lib/workspace-config"

const ApprovalCockpit = dynamic(() => import("../bridge/ApprovalCockpit").then((module) => module.ApprovalCockpit), { ssr: false })

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function statusIcon(status: ExecutionActionNode["status"]) {
  if (status === "succeeded") return <Check className="h-3.5 w-3.5" aria-hidden />
  if (["failed", "denied", "rejected"].includes(status)) return <Ban className="h-3.5 w-3.5" aria-hidden />
  if (status === "blocked") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
  if (status === "executing" || status === "verifying") return <LoaderCircle className="h-3.5 w-3.5" aria-hidden />
  return <CircleDot className="h-3.5 w-3.5" aria-hidden />
}

function TargetLine({ node }: { node: ExecutionActionNode }) {
  const { config } = useWorkspaceConfig()
  return node.targets.length > 0 ? (
    <div className="jarvis-execution-node__targets">
      {node.targets.slice(0, 4).map((target) => <span key={`${target.entityType}:${target.entityId}`}><Link2 className="h-3 w-3" aria-hidden />{target.label ?? `${vocabularyLabel(target.entityType, config)} ${shortId(target.entityId)}`}{target.status ? <small>{humanize(target.status)}</small> : null}</span>)}
      {node.targets.length > 4 ? <span>+{node.targets.length - 4} linked</span> : null}
    </div>
  ) : <p className="jarvis-execution-node__unknown">No action-specific canonical target was recorded.</p>
}

function RouteLine({ node }: { node: ExecutionActionNode }) {
  if (!node.route) return <p className="jarvis-execution-node__unknown">No external application or provider execution is recorded for this action.</p>
  return (
    <div className="jarvis-execution-node__route">
      {node.route.route === "computer" ? <Laptop className="h-3.5 w-3.5" aria-hidden /> : <Workflow className="h-3.5 w-3.5" aria-hidden />}
      <span><strong>{node.route.application ?? "Application not recorded"}</strong><small>{node.route.provider ?? "FINNOR / provider not recorded"}{node.route.identity?.label ? ` · ${node.route.identity.label}` : ""}{node.route.source === "persisted_configuration" ? " · configured route (not yet executed)" : ""}</small></span>
    </div>
  )
}

function AuthorityLine({ node }: { node: ExecutionActionNode }) {
  const actor = node.actor?.displayName ?? (node.actor ? `Employee ${shortId(node.actor.employeeId)}` : "Actor not recorded")
  return (
    <div className="jarvis-execution-node__authority" data-authority-state={node.authority.state}>
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
      <span><strong>{actor} · {humanize(node.authority.state)}</strong><small>{node.authority.reasonCode ? humanize(node.authority.reasonCode) : "No authority reason was recorded"}{node.approval.required ? ` · approval ${humanize(node.approval.status)}` : " · no approval record required"}</small></span>
    </div>
  )
}

function ComputerActivity({ node }: { node: ExecutionActionNode }) {
  const run = node.computer
  if (!run) return null
  return (
    <section className="jarvis-execution-computer" aria-label="Computer execution activity">
      <div className="jarvis-execution-computer__header"><span><Laptop className="h-3.5 w-3.5" aria-hidden />{run.application} · {run.account.label}</span><strong>{humanize(run.status)}</strong></div>
      <p>{run.task}</p>
      <div className="jarvis-execution-node__facts"><span>{run.mode}</span><span>{run.provider}</span><span>{run.stepCount} persisted step{run.stepCount === 1 ? "" : "s"}</span>{run.stepsTruncated ? <span>latest {run.steps.length} shown</span> : null}</div>
      <ol>{run.steps.slice(-8).map((step) => <li key={step.id} data-step-status={step.status}><span>{step.status === "succeeded" ? "✓" : step.status === "started" ? "→" : "!"}</span><span>{step.summary}</span><small>{humanize(step.phase)}</small></li>)}</ol>
      {run.blockReason ? <p className="jarvis-execution-failure"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{run.blockReason}</p> : null}
    </section>
  )
}

function ActionNode({ node, onRefresh }: { node: ExecutionActionNode; onRefresh: () => void }) {
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasApprovalControls = node.controls.some((control) => control.kind === "approve" || control.kind === "reject")
  const computerCancel = node.controls.find((control) => control.kind === "cancel" && control.endpoint.includes("/computer/runs/"))

  const cancelComputer = async () => {
    if (!node.computer || !computerCancel || busy) return
    setBusy(true); setError(null)
    try { await jarvisClient.cancelComputerRun(node.computer.id); onRefresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Computer cancellation failed") }
    finally { setBusy(false) }
  }

  return (
    <motion.article
      key={`${node.id}:${node.status}:${node.observation.verification}`}
      layout
      initial={{ opacity: 0.72, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="jarvis-execution-node"
      data-execution-status={node.status}
      aria-label={`${node.businessVerb}: ${humanize(node.status)}`}
    >
      <header className="jarvis-execution-node__header">
        <div><span className="jarvis-execution-node__index">{shortId(node.id)}</span><h4>{node.summary ?? node.businessVerb}</h4></div>
        <span className="jarvis-execution-node__status">{statusIcon(node.status)}{humanize(node.status)}</span>
      </header>
      <div className="jarvis-execution-node__semantic"><ActionRenderer actionType={node.actionType} payload={node.semanticPayload} compact /></div>
      {node.dependencyIds.length > 0 ? <div className="jarvis-execution-node__dependencies"><GitBranch className="h-3.5 w-3.5" aria-hidden /><span>Depends on {node.dependencyIds.map(shortId).join(" · ")}</span>{node.blockedBy.length > 0 ? <small>{node.blockedBy.length} unresolved</small> : <small>dependencies resolved</small>}</div> : null}

      <div className="jarvis-execution-node__questions">
        <section><span>Target</span><TargetLine node={node} /></section>
        <section><span>Through</span><RouteLine node={node} /></section>
        <section><span>Authority</span><AuthorityLine node={node} /></section>
        <section><span>Now</span><div className="jarvis-execution-node__now"><p>{node.failure?.message ?? node.observation.basis}</p><small>External effect: {humanize(node.externalEffect)}</small></div></section>
      </div>

      <div className="jarvis-execution-outcome" data-verification={node.observation.verification}>
        <div><span>Intent</span><strong>{boundedOutcomeSummary(node.intent.expectedResult)}</strong><small>{node.intent.source === "prediction" ? "No-write prediction" : node.intent.source === "receipt" ? "Receipt expectation" : "No expected result recorded"}</small></div>
        <ChevronRight className="h-4 w-4" aria-hidden />
        <div><span>Observed</span><strong>{boundedOutcomeSummary(node.observation.actualResult)}</strong><small>{humanize(node.observation.verification)} · {node.observation.evidence.length} evidence record{node.observation.evidence.length === 1 ? "" : "s"}</small></div>
      </div>

      {node.observation.evidence.length > 0 ? <div className="jarvis-execution-evidence" aria-label="Execution evidence references">{node.observation.evidence.slice(0, 6).map((item, index) => <span key={`${item.source}:${item.ref ?? index}`}><FileCheck2 className="h-3 w-3" aria-hidden /><strong>{humanize(item.source)}</strong><small>{item.restricted ? "Reference restricted for this role" : item.ref ?? "No reference recorded"}</small></span>)}</div> : null}

      {node.failure ? <div className="jarvis-execution-failure"><AlertTriangle className="h-4 w-4" aria-hidden /><span><strong>{node.failure.message}</strong><small>{node.failure.reconciliationRequired ? "Reconciliation required · retry hidden" : node.failure.retrySafe ? "Recorded as retry-safe" : node.failure.humanRequired ? "Human review required" : "No legal recovery control is currently exposed"}{node.failure.recoveryPath ? ` · ${node.failure.recoveryPath}` : ""}</small></span></div> : null}
      <ComputerActivity node={node} />

      {(hasApprovalControls || computerCancel) ? <div className="jarvis-execution-node__controls">
        {hasApprovalControls ? <button type="button" onClick={() => setApprovalOpen((open) => !open)}><ShieldCheck className="h-3.5 w-3.5" aria-hidden />{approvalOpen ? "Close exact decision" : "Review exact decision"}</button> : null}
        {computerCancel ? <button type="button" disabled={busy || node.computer?.cancellationRequested} onClick={() => void cancelComputer()}><Ban className="h-3.5 w-3.5" aria-hidden />{node.computer?.cancellationRequested ? "Cancellation requested" : busy ? "Requesting…" : computerCancel.label}</button> : null}
      </div> : null}
      {approvalOpen ? <div className="jarvis-execution-node__approval"><ApprovalCockpit scopeActionIds={[node.id]} /></div> : null}
      {error ? <p className="jarvis-execution-node__control-error" role="alert">{error}</p> : null}
    </motion.article>
  )
}

function WorkflowLane({ workflow, onRefresh }: { workflow: ExecutionWorkflow; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [compensationReasons, setCompensationReasons] = useState<Record<string, string>>({})
  const control = async (item: ExecutionControl) => {
    if (item.expectedVersion === null || busy) return
    setBusy(item.kind); setError(null)
    try { await jarvisClient.runControl(workflow.id, item.kind as "pause" | "resume" | "cancel" | "retry" | "escalate", item.expectedVersion); onRefresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workflow control failed") }
    finally { setBusy(null) }
  }
  const compensate = async (stepId: string) => {
    const reason = compensationReasons[stepId]?.trim()
    if (!reason || reason.length < 3 || busy) return
    setBusy(`compensate:${stepId}`); setError(null)
    try { await jarvisClient.compensateStep(stepId, reason); onRefresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workflow compensation failed") }
    finally { setBusy(null) }
  }
  return (
    <section className="jarvis-execution-workflow" data-workflow-status={workflow.status}>
      <header><span><Workflow className="h-4 w-4" aria-hidden />{humanize(workflow.workflowType)}</span><strong>{humanize(workflow.status)} · v{workflow.version}</strong></header>
      <ol>{workflow.steps.map((step) => {
        const compensationControl = step.controls.find((item) => item.kind === "compensate")
        return <li key={step.id} data-step-status={step.status}><span>{step.sequence + 1}</span><div><strong>{humanize(step.stepType)}</strong><small>{step.integration ? `${step.integration.provider ?? "provider not recorded"} · ${humanize(step.integration.status)}` : "FINNOR runtime step"}{step.reconciliation?.status === "open" ? " · reconciliation open" : ""}{step.compensation ? ` · compensation ${step.compensation.status}` : ""}</small>{step.terminalReason ? <em>{step.terminalReason}</em> : null}{compensationControl ? <div className="jarvis-execution-step-controls"><input aria-label={`Reason to compensate ${humanize(step.stepType)}`} value={compensationReasons[step.id] ?? ""} onChange={(event) => setCompensationReasons((current) => ({ ...current, [step.id]: event.target.value }))} placeholder="Reason for reversing this effect" maxLength={2_000} /><button type="button" title={compensationControl.reason} disabled={busy !== null || !compensationReasons[step.id] || compensationReasons[step.id].trim().length < 3} onClick={() => void compensate(step.id)}><RotateCcw className="h-3.5 w-3.5" aria-hidden />{busy === `compensate:${step.id}` ? "Compensating…" : compensationControl.label}</button></div> : null}</div><span>{humanize(step.status)}</span></li>
      })}</ol>
      {workflow.controls.length > 0 ? <div className="jarvis-execution-node__controls">{workflow.controls.map((item) => <button key={item.kind} type="button" disabled={busy !== null} title={item.reason} onClick={() => void control(item)}>{item.kind === "retry" ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : item.kind === "cancel" ? <Ban className="h-3.5 w-3.5" aria-hidden /> : <CircleDot className="h-3.5 w-3.5" aria-hidden />}{busy === item.kind ? "Applying…" : item.label}</button>)}</div> : null}
      {error ? <p className="jarvis-execution-node__control-error" role="alert">{error}</p> : null}
    </section>
  )
}

export function ExecutionTheater({ workId, onRefresh }: { workId: string; onRefresh: () => void }) {
  const definition = useMemo(() => businessProjections.workExecution(workId), [workId])
  const projection = useBusinessProjection(definition)
  const layers = useMemo(() => buildExecutionLayers(projection.data?.nodes ?? []), [projection.data?.nodes])
  const refresh = () => { void projection.refresh().catch(() => undefined); onRefresh() }

  if (projection.data === null) {
    return <div className="jarvis-execution-empty" data-status={projection.error ? "unavailable" : "reading"}><Clock3 className="h-4 w-4" aria-hidden /><span>{projection.error ? "Execution projection unavailable. Existing Work facts remain visible outside this theater." : "Reading durable execution facts…"}</span></div>
  }
  const data = projection.data
  return (
    <div className="jarvis-execution-theater" data-work-status={data.work.status} data-projection-stale={projection.stale ? "true" : undefined}>
      <header className="jarvis-execution-theater__header">
        <div><span>Execution projection · Work {shortId(data.work.id)}</span><h3>{data.work.objective}</h3></div>
        <div><span>{data.nodes.length} action{data.nodes.length === 1 ? "" : "s"}</span><span>{data.workflows.length} workflow{data.workflows.length === 1 ? "" : "s"}</span><span>{data.receipts.filter((receipt) => receipt.finalizedAt).length} finalized receipt{data.receipts.filter((receipt) => receipt.finalizedAt).length === 1 ? "" : "s"}</span></div>
      </header>
      {projection.stale ? <p className="jarvis-execution-stale"><Clock3 className="h-3.5 w-3.5" aria-hidden />A realtime refresh is delayed; showing the last reconstructed durable state.</p> : null}
      {Object.values(data.truncated).some(Boolean) ? <p className="jarvis-execution-stale"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />This large Work is bounded for operator safety. Counts and truncation are explicit; no node state was synthesized.</p> : null}
      {layers.length === 0 ? <div className="jarvis-execution-empty"><CircleDot className="h-4 w-4" aria-hidden /><span>No DomainAction is attached to this Work.</span></div> : (
        <div className="jarvis-execution-graph" aria-label="Canonical action dependency graph">
          {layers.map((layer, index) => <section key={layer.map((node) => node.id).join(":")} className="jarvis-execution-layer"><div className="jarvis-execution-layer__label"><span>{index + 1}</span><small>{layer.length > 1 ? `${layer.length} independent branches` : "dependency layer"}</small></div><div className="jarvis-execution-layer__nodes">{layer.map((node) => <ActionNode key={node.id} node={node} onRefresh={refresh} />)}</div></section>)}
        </div>
      )}
      {data.workflows.length > 0 ? <section className="jarvis-execution-workflows"><div className="jarvis-execution-workflows__heading"><Workflow className="h-4 w-4" aria-hidden /><span>Durable workflow runtime</span></div>{data.workflows.map((workflow) => <WorkflowLane key={workflow.id} workflow={workflow} onRefresh={refresh} />)}</section> : null}
      {data.receipts.length > 0 ? <footer className="jarvis-execution-receipt-settle"><FileCheck2 className="h-4 w-4" aria-hidden /><span><strong>Receipt continuity</strong><small>{data.receipts.filter((receipt) => receipt.finalizedAt).length === data.receipts.length ? "Every projected receipt is finalized." : `${data.receipts.filter((receipt) => receipt.finalizedAt).length}/${data.receipts.length} receipts finalized; unfinished outcomes remain open.`}</small></span></footer> : null}
    </div>
  )
}
