import type { WorkCaseProjection } from "@/lib/jarvis-client"

export interface WorkInspectorFact {
  label: string
  value: string
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function compact(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized
}

function recordedValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return compact(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  const record = value as Record<string, unknown>
  const preferred = ["status", "outcome", "message", "result", "code", "provider", "reason"]
    .flatMap((key) => {
      const item = record[key]
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [`${humanize(key)} · ${String(item)}`] : []
    })
  return preferred.length > 0 ? compact(preferred.join(" · ")) : `${fallback} (${Object.keys(record).length} recorded fields)`
}

function nextAction(workCase: WorkCaseProjection): string {
  if (workCase.objectiveLoop?.nextStep) return compact(workCase.objectiveLoop.nextStep)
  if (workCase.approvals.some((approval) => approval.status === "pending")) return "Review the pending approval; execution remains paused until a permitted decision is recorded."
  if (workCase.status === "Failed" || workCase.status === "Blocked") return recordedValue(workCase.durableWork?.recovery, "Inspect the failure and use only the recorded recovery path.")
  if (workCase.status === "Working" || workCase.status === "Waiting") return "Wait for the recorded operation or external result, then re-inspect this same Work."
  if (workCase.status === "Completed") return "Continue this same Work for a follow-up, or inspect its receipt and linked business evidence."
  return "No permitted next action is recorded."
}

export function buildWorkInspectorFacts(workCase: WorkCaseProjection): WorkInspectorFact[] {
  const sources = Array.from(new Set([
    ...workCase.provenance,
    ...workCase.linkedEntities.map((entity) => entity.via),
    ...workCase.businessEvents.flatMap((event) => event.source ? [event.source] : []),
  ].filter(Boolean)))
  const pending = workCase.approvals.filter((approval) => approval.status === "pending")
  const approvals = Array.from(new Set(workCase.approvals.map((approval) => humanize(approval.status))))
  const receipt = workCase.receipts[0] ?? null
  const expected = receipt?.expectedResult
    ? recordedValue(receipt.expectedResult, "Expected result recorded")
    : workCase.actions.length > 0
      ? workCase.actions.map((action) => action.summary?.trim() || humanize(action.actionType)).join(" → ")
      : "No consequential state change is recorded for this Work."
  const happened = receipt?.failure
    ? recordedValue(receipt.failure, "A failure was recorded")
    : receipt?.actualResult
      ? recordedValue(receipt.actualResult, "An actual result was recorded")
      : workCase.durableWork?.finalOutcome
        ? recordedValue(workCase.durableWork.finalOutcome, "A durable final outcome was recorded")
        : workCase.businessEvents.length > 0
          ? workCase.businessEvents.slice(0, 4).map((event) => humanize(event.eventType)).join(" · ")
          : `${workCase.status}; no terminal result record is attached yet.`
  const authority = workCase.durableWork?.authorityContext
    ? recordedValue(workCase.durableWork.authorityContext, "Recorded Work authority context")
    : workCase.durableWork?.assignedTo || workCase.durableWork?.currentOwnerId
      ? `Owned by ${workCase.durableWork.assignedTo ?? workCase.durableWork.currentOwnerId}`
      : "Authority remains governed by the action approval and current employee context."
  const finalized = workCase.receipts.filter((item) => item.finalizedAt).length
  const closure = [
    `${workCase.receipts.length} receipt${workCase.receipts.length === 1 ? "" : "s"} · ${finalized} finalized`,
    `${workCase.businessEvents.length} business event${workCase.businessEvents.length === 1 ? "" : "s"}`,
    `${workCase.linkedEntities.length} exact entity link${workCase.linkedEntities.length === 1 ? "" : "s"}`,
  ].join(" · ")

  return [
    { label: "What you are looking at", value: `${workCase.title} · ${workCase.status} · ${workCase.id}` },
    { label: "Why now", value: compact(workCase.objectiveLoop?.reason ?? workCase.instruction?.text ?? `This Work is currently ${workCase.status.toLocaleLowerCase()}.`) },
    { label: "Supporting sources", value: sources.length > 0 ? sources.join(" · ") : "No provenance label is attached yet." },
    { label: "Policy / permission", value: pending.length > 0 ? `${pending.length} human approval${pending.length === 1 ? "" : "s"} pending.` : approvals.length > 0 ? `Approval record · ${approvals.join(" · ")}` : "No approval requirement is recorded." },
    { label: "Expected change", value: expected },
    { label: "Authority boundary", value: authority },
    { label: "What happened", value: happened },
    { label: "Evidence / closure", value: closure },
    { label: "Next permitted action", value: nextAction(workCase) },
  ]
}
