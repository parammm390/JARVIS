export type DecisionWaveTone = "green" | "red" | "amber"
export type DecisionWaveVerb = "confirm" | "reject" | "escalate"

export interface AuthoritativeDecisionWave {
  actionId: string | null
  tone: DecisionWaveTone
  verb: DecisionWaveVerb
}

/** Presentation may react only to the post-response event emitted by data-core. */
export function authoritativeDecisionWave(detail: unknown): AuthoritativeDecisionWave | null {
  if (typeof detail !== "object" || detail === null || !("authoritative" in detail) || detail.authoritative !== true) return null
  if (!("verb" in detail) || (detail.verb !== "confirm" && detail.verb !== "reject" && detail.verb !== "escalate")) return null
  const actionId = "actionId" in detail && typeof detail.actionId === "string" ? detail.actionId : null
  return {
    actionId,
    verb: detail.verb,
    tone: detail.verb === "confirm" ? "green" : detail.verb === "reject" ? "red" : "amber",
  }
}
