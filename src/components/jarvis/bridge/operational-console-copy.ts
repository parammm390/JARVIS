export function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ")
}

/** Review copy is a deterministic presentation of the source summary. It never
 * asks a model to invent a friendlier question, and it never reads payload JSON
 * to fill a missing label. */
export function reviewTitle(summary: string | null, actionType: string): string {
  const source = summary?.trim()
  if (!source) return humanize(actionType)
  return /[_-]/.test(source) ? humanize(source) : source
}

export function reviewStatusCopy(actionType: string, status: string): string {
  if (actionType === "clarification_request") return "Needs one detail"
  if (status === "pending" || status === "awaiting_approval") return "Needs your decision"
  if (status === "blocked" || status === "needs_human_review" || status === "blocked_integration_unavailable") return "Needs attention"
  return humanize(status)
}
