import type { JarvisRole } from "../lib/jarvis-auth"
import type { Thread } from "../kernel/store"
import type { WorkspaceProjection } from "./contracts"

export interface WorkspaceInspectorItem {
  label: string
  value: string
  href?: string
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function compact(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized
}

function nextAction(thread: Thread): string {
  const state = thread.machine.instructionState
  if (state === "awaiting_approval") return "Review the recorded approval boundary; execution remains paused until a permitted decision is made."
  if (state === "failed") return "Inspect the failure, then retry this same Work only when the recorded recovery path permits it."
  if (state === "partial") return "Inspect the receipt and recover only the incomplete or failed step from this same Work."
  if (state === "completed") return "Continue this same Work for a follow-up, or open the durable record to inspect evidence."
  if (state === "cancelled") return "Continue this same Work with a revised instruction, or explicitly start new Work."
  if (state === "clarifying") return "Answer the requested clarification or cancel safely."
  return "Wait for the current governed step to settle; cancellation remains available before execution where shown."
}

export function buildWorkspaceInspector(thread: Thread, projection: WorkspaceProjection, role: JarvisRole): WorkspaceInspectorItem[] {
  const sourceLabels = new Set<string>()
  for (const table of projection.query?.result.source.tables ?? []) sourceLabels.add(table)
  for (const evidence of thread.answerResult?.evidence ?? []) sourceLabels.add(evidence.title ?? evidence.source)
  for (const chip of thread.contextChips) sourceLabels.add(`${chip.label} · ${chip.source}`)
  const verifiedFields = thread.nodes.flatMap((node) => node.groundedPayload.filter((field) => field.status === "verified").map((field) => field.field))
  if (verifiedFields.length > 0) sourceLabels.add(`Verified fields · ${Array.from(new Set(verifiedFields)).join(", ")}`)

  const policies = Array.from(new Set(thread.nodes.flatMap((node) => {
    if (!node.policyId && node.policyVersion === null) return []
    return [`${node.policyId ? `Policy ${node.policyId}` : "Recorded policy"}${node.policyVersion === null ? "" : ` · v${node.policyVersion}`}`]
  })))
  const actions = projection.actions.map((action) => {
    const detail = [action.targetLabel, action.amountUsd === null ? null : `$${action.amountUsd.toLocaleString("en-US")}`].filter(Boolean).join(" · ")
    return `${humanize(action.actionType)}${detail ? ` (${detail})` : ""}`
  })
  const state = thread.machine.instructionState
  const readOnly = projection.actions.length === 0
  const outcome = thread.submitError
    ? compact(thread.submitError)
    : thread.answerResult?.spokenSummary
      ? compact(thread.answerResult.spokenSummary)
      : state === "awaiting_approval" && !thread.everExecuted
        ? "Nothing consequential has executed; the plan is paused at approval."
        : state === "completed"
          ? "The instruction reached a completed terminal state."
          : `The instruction is currently ${humanize(state).toLocaleLowerCase()}.`
  const evidenceParts = [
    projection.query ? `Query ${projection.query.metadata.queryId} · as of ${projection.query.result.asOf}` : null,
    thread.answerResult?.evidence?.length ? `${thread.answerResult.evidence.length} cited source${thread.answerResult.evidence.length === 1 ? "" : "s"}` : null,
    thread.runWatch?.correlatedRunIds.size ? `${thread.runWatch.correlatedRunIds.size} correlated run${thread.runWatch.correlatedRunIds.size === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => Boolean(value))

  return [
    { label: "What you are looking at", value: `${projection.title} · ${humanize(state)}` },
    { label: "Why now", value: compact(thread.instructionText) },
    { label: "Supporting sources", value: sourceLabels.size > 0 ? Array.from(sourceLabels).join(" · ") : "No source record has been attached yet." },
    { label: "Policy / permission", value: readOnly ? "Read-only result; no consequential permission was exercised." : policies.length > 0 ? policies.join(" · ") : "Policy resolution is not recorded yet." },
    { label: "Expected change", value: readOnly ? "No business-state change. This Work reads or explains existing evidence." : actions.join(" → ") },
    { label: "Authority boundary", value: state === "awaiting_approval" ? `${humanize(role ?? "unknown")} session · a recorded human decision is required before execution.` : readOnly ? `${humanize(role ?? "unknown")} session · read authority only for this result.` : `${humanize(role ?? "unknown")} session · actions remain bounded by recorded policy and approval state.` },
    { label: "What happened", value: outcome },
    { label: "Evidence / closure", value: evidenceParts.length > 0 ? evidenceParts.join(" · ") : "Closure evidence has not been recorded yet." },
    { label: "Next permitted action", value: nextAction(thread) },
    { label: "Durable Work", value: projection.workId ?? "Pending durable ID", ...(projection.workId ? { href: `/jarvis/work?workCaseId=${encodeURIComponent(projection.workId)}` } : {}) },
  ]
}
