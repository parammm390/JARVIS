"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, CircleDot, Clock3, FileCheck2, GitBranch, LockKeyhole, SearchCheck } from "lucide-react"
import type { CausalReplayNode } from "@/lib/jarvis-client"
import { useBusinessProjection } from "../lib/business-projections"
import { businessProjections } from "../lib/projection-definitions"
import { boundedFacts, connectedEdges, humanizeReplay, nodesAtMoment, type ReplayFilter } from "./operational-time-machine-model"
import "./operational-time-machine.css"

const FILTERS: Array<{ id: ReplayFilter; label: string }> = [
  { id: "all", label: "All facts" },
  { id: "governance", label: "Governance" },
  { id: "execution", label: "Execution" },
  { id: "outcomes", label: "Outcomes" },
  { id: "problems", label: "Failures & recovery" },
]

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
}

function availabilityLabel(node: CausalReplayNode): string {
  const values = new Set(node.evidence.map((item) => item.availability))
  if (values.has("restricted")) return "Evidence restricted"
  if (values.has("expired")) return "Content expired · metadata retained"
  if (values.has("legacy_incomplete")) return "Legacy gap"
  if (values.has("unavailable")) return "Evidence unavailable"
  return `${node.evidence.length} evidence reference${node.evidence.length === 1 ? "" : "s"}`
}

export function OperationalTimeMachine({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<ReplayFilter>("all")
  const [momentIndex, setMomentIndex] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const definition = useMemo(() => businessProjections.workReplay(workId), [workId])
  const projection = useBusinessProjection(definition, { enabled: open })
  const data = projection.data
  const maxMoment = Math.max(0, (data?.moments.length ?? 1) - 1)
  const safeMoment = Math.min(momentIndex ?? maxMoment, maxMoment)
  const selectedMoment = data?.moments[safeMoment]
  const visibleNodes = useMemo(() => data && selectedMoment ? nodesAtMoment(data.nodes, selectedMoment.at, filter) : [], [data, filter, selectedMoment])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(() => data ? connectedEdges(data.edges, visibleNodeIds) : [], [data, visibleNodeIds])
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes.at(-1) ?? null
  const selectedEdges = selectedNode ? visibleEdges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id) : []
  const decisionContext = [...visibleNodes].reverse().find((node) => node.id.startsWith("decision-context:"))
  const canonicalChanges = visibleNodes.filter((node) => node.stage === "canonical_change")

  return (
    <div className="jarvis-time-machine" data-open={open ? "true" : undefined}>
      <button type="button" className="jarvis-time-machine__entry" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span><SearchCheck className="h-4 w-4" aria-hidden /><strong>Why did this happen?</strong><small>Replay the recorded trigger, context, decisions, execution, and outcome.</small></span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>

      {open && data === null ? (
        <div className="jarvis-time-machine__loading" data-error={projection.error ? "true" : undefined}>
          {projection.error ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Clock3 className="h-4 w-4" aria-hidden />}
          <span>{projection.error ? "Causal replay is unavailable. The operational Work and receipts remain unchanged." : "Reconstructing durable causal facts…"}</span>
          {projection.error ? <button type="button" onClick={() => void projection.refresh().catch(() => undefined)}>Retry read</button> : null}
        </div>
      ) : null}

      {open && data ? (
        <div className="jarvis-time-machine__body">
          <header className="jarvis-time-machine__header">
            <div><span>Operational Time Machine · read only</span><h3>{data.work.objective}</h3></div>
            <div className="jarvis-time-machine__badges"><span data-completeness={data.completeness.status}>{humanizeReplay(data.completeness.status)}</span><span>{data.completeness.provenEdges} proven links</span><span><LockKeyhole className="h-3 w-3" aria-hidden /> no side effects</span></div>
          </header>

          <section className="jarvis-time-machine__explanation" aria-label="Deterministic causal explanation">
            <div><span>Trigger</span><p>{data.explanation.trigger}</p></div>
            <div><span>Context</span><p>{data.explanation.context}</p></div>
            <div><span>Plan & governance</span><p>{data.explanation.plan} {data.explanation.governance}</p></div>
            <div><span>Execution & verification</span><p>{data.explanation.execution} {data.explanation.verification}</p></div>
            <div><span>Outcome</span><p>{data.explanation.outcome}</p></div>
          </section>

          {data.completeness.missing.length > 0 ? <details className="jarvis-time-machine__gaps"><summary><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{data.completeness.missing.length} explicit provenance gap{data.completeness.missing.length === 1 ? "" : "s"}</summary><ul>{data.completeness.missing.map((gap) => <li key={gap}>{gap}</li>)}</ul></details> : null}

          {data.moments.length > 0 ? <section className="jarvis-time-machine__scrubber" aria-label="Causal timeline controls">
            <div><span>Moment {safeMoment + 1} of {data.moments.length}</span><time dateTime={selectedMoment?.at}>{selectedMoment ? formatTime(selectedMoment.at) : "No recorded moment"}</time></div>
            <input type="range" min={0} max={maxMoment} step={1} value={safeMoment} onChange={(event) => { setMomentIndex(Number(event.target.value)); setSelectedNodeId(null) }} aria-label="Replay moment" />
            <div className="jarvis-time-machine__filters" role="group" aria-label="Replay stage filter">{FILTERS.map((item) => <button key={item.id} type="button" data-selected={filter === item.id ? "true" : undefined} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setSelectedNodeId(null) }}>{item.label}</button>)}</div>
          </section> : null}

          <div className="jarvis-time-machine__workspace">
            <ol className="jarvis-time-machine__timeline" aria-label="Evidence-backed causal facts">
              {visibleNodes.map((node) => <li key={node.id} data-stage={node.stage} data-selected={node.id === selectedNode?.id ? "true" : undefined}>
                <button type="button" onClick={() => setSelectedNodeId(node.id)}>
                  <span className="jarvis-time-machine__dot" aria-hidden />
                  <span><small>{humanizeReplay(node.stage)} · <time dateTime={node.occurredAt}>{formatTime(node.occurredAt)}</time></small><strong>{node.title}</strong><em>{node.summary}</em></span>
                  <span>{humanizeReplay(node.status)}</span>
                </button>
              </li>)}
              {visibleNodes.length === 0 ? <li className="jarvis-time-machine__empty">No facts in this filter at the selected moment.</li> : null}
            </ol>

            <aside className="jarvis-time-machine__inspector" aria-live="polite">
              {selectedNode ? <>
                <div className="jarvis-time-machine__inspector-heading"><span>{humanizeReplay(selectedNode.stage)} fact</span><h4>{selectedNode.title}</h4><p>{selectedNode.summary}</p></div>
                <dl><div><dt>Status</dt><dd>{humanizeReplay(selectedNode.status)}</dd></div><div><dt>Recorded</dt><dd>{formatTime(selectedNode.occurredAt)}</dd></div><div><dt>Evidence</dt><dd>{availabilityLabel(selectedNode)}</dd></div></dl>
                {selectedEdges.length > 0 ? <section><span><GitBranch className="h-3.5 w-3.5" aria-hidden />Exact causal links</span><ul>{selectedEdges.map((edge) => <li key={edge.id} data-certainty={edge.certainty}><strong>{humanizeReplay(edge.relation)}</strong><small>{edge.explanation}</small><code>{shortId(edge.from)} → {shortId(edge.to)}</code></li>)}</ul></section> : <p className="jarvis-time-machine__no-link">No retained causal edge touches this fact.</p>}
                <details><summary><FileCheck2 className="h-3.5 w-3.5" aria-hidden />Source evidence</summary><ul>{selectedNode.evidence.map((item, index) => <li key={`${item.source}:${item.ref ?? index}`}><strong>{humanizeReplay(item.source)}</strong><small>{humanizeReplay(item.availability)} · {item.ref ? shortId(item.ref) : "reference withheld or unavailable"}</small>{item.integrityHash ? <code>sha256 {shortId(item.integrityHash)}</code> : null}</li>)}</ul></details>
                {Object.keys(selectedNode.facts).length > 0 ? <details><summary>Bounded recorded facts</summary><pre>{boundedFacts(selectedNode.facts)}</pre></details> : null}
              </> : <p>Select a recorded causal fact.</p>}
            </aside>
          </div>

          {(decisionContext || canonicalChanges.length > 0) ? <section className="jarvis-time-machine__context-delta" aria-label="Decision-time context and later canonical changes"><div><span>Decision-time snapshot</span><strong>{decisionContext ? `${decisionContext.entityRefs.length} referenced entit${decisionContext.entityRefs.length === 1 ? "y" : "ies"}` : "Unavailable"}</strong><small>{decisionContext?.summary ?? "Legacy history has no immutable snapshot."}</small></div><div><CircleDot className="h-4 w-4" aria-hidden /></div><div><span>Observed afterward</span><strong>{canonicalChanges.length} canonical change{canonicalChanges.length === 1 ? "" : "s"}</strong><small>{canonicalChanges.length ? canonicalChanges.map((node) => node.title).slice(0, 3).join(" · ") : "No correlated business-state change was recorded."}</small></div></section> : null}

          <footer className="jarvis-time-machine__footer"><span>As of {formatTime(data.asOf)} · {data.viewer.evidenceVisibility} evidence view</span><span>The replay contains no approval, retry, cancel, planner, provider, or lifecycle controls.</span></footer>
        </div>
      ) : null}
    </div>
  )
}
