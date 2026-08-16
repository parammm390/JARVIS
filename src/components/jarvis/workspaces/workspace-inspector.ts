import type { JarvisRole } from "../lib/jarvis-auth"
import type { Thread } from "../kernel/store"
import type { WorkspaceProjection } from "./contracts"

export interface WorkspaceInspectorItem {
  label: string
  value: string
  href?: string
}

export interface WorkspaceInspectorGroups {
  primary: WorkspaceInspectorItem[]
  advanced: WorkspaceInspectorItem[]
  durableWork: WorkspaceInspectorItem | null
}

const READ_ONLY_ACTIONS = new Set([
  "answer_business_question",
  "get_business_overview",
  "check_stock_level",
  "answer_water_question",
  "answer_customer_question",
  "check_reminder_due",
  "check_technician_availability",
  "summarize_ad_performance",
  "search_web",
  "scan_competitors",
  "check_business_reviews",
])

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
  const contextLabels = new Set<string>()
  for (const table of projection.query?.result.source.tables ?? []) sourceLabels.add(table)
  for (const evidence of thread.answerResult?.evidence ?? []) sourceLabels.add(`${evidence.kind ?? "UNCLASSIFIED"} · ${evidence.title ?? evidence.source}`)
  for (const chip of thread.contextChips) contextLabels.add(`${chip.label} · ${chip.source}`)
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
  const readOnly = projection.actions.length === 0 || projection.actions.every((action) => READ_ONLY_ACTIONS.has(action.actionType))
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
    { label: "Context inputs", value: contextLabels.size > 0 ? Array.from(contextLabels).join(" · ") : "No optional context input is attached." },
    { label: "Policy / permission", value: readOnly ? "Read-only result; no consequential permission was exercised." : policies.length > 0 ? policies.join(" · ") : "Policy resolution is not recorded yet." },
    { label: "Expected change", value: readOnly ? "No business-state change. This Work reads or explains existing evidence." : actions.join(" → ") },
    { label: "Authority boundary", value: state === "awaiting_approval" ? `${humanize(role ?? "unknown")} session · a recorded human decision is required before execution.` : readOnly ? `${humanize(role ?? "unknown")} session · read authority only for this result.` : `${humanize(role ?? "unknown")} session · actions remain bounded by recorded policy and approval state.` },
    { label: "What happened", value: outcome },
    { label: "Evidence / closure", value: evidenceParts.length > 0 ? evidenceParts.join(" · ") : "Closure evidence has not been recorded yet." },
    { label: "Next permitted action", value: nextAction(thread) },
    { label: "Durable Work", value: projection.workId ?? "Pending durable ID", ...(projection.workId ? { href: `/jarvis/work?workCaseId=${encodeURIComponent(projection.workId)}` } : {}) },
  ]
}

/**
 * The Inspector is a contextual lens, not a second transcript. Keep the three
 * facts needed to orient a human in the open and move policy/debug detail
 * behind disclosure. The source item deliberately combines both source lists
 * so a collapsed canvas never loses the evidence boundary.
 */
export function groupWorkspaceInspector(items: WorkspaceInspectorItem[]): WorkspaceInspectorGroups {
  const find = (label: string) => items.find((item) => item.label === label) ?? null
  const state = find("What you are looking at")
  const authority = find("Authority boundary")
  const supporting = find("Supporting sources")
  const closure = find("Evidence / closure")
  const durableWork = find("Durable Work")
  const sourceParts = [supporting?.value, closure?.value].filter((value): value is string => Boolean(value))

  return {
    primary: [
      state ? { ...state, label: "Work state" } : { label: "Work state", value: "No Work state is selected." },
      authority ? { ...authority, label: "Authority" } : { label: "Authority", value: "Authority context is not attached yet." },
      { label: "Source evidence", value: sourceParts.length > 0 ? sourceParts.join(" · ") : "No source evidence is attached yet." },
    ],
    advanced: items.filter((item) => !["What you are looking at", "Authority boundary", "Supporting sources", "Evidence / closure", "Durable Work"].includes(item.label)),
    durableWork,
  }
}
