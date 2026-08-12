import type { ProjectionTag } from "./business-projection-cache"

export interface BusinessInvalidationSignal {
  tags: readonly ProjectionTag[]
  source: "mutation" | "business-event" | "trace" | "manual" | "broadcast"
  path?: string
  at: number
}

const listeners = new Set<(signal: BusinessInvalidationSignal) => void>()

export function onBusinessInvalidation(listener: (signal: BusinessInvalidationSignal) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishBusinessInvalidation(signal: Omit<BusinessInvalidationSignal, "at">): void {
  if (signal.tags.length === 0) return
  const event = { ...signal, at: Date.now() }
  listeners.forEach((listener) => listener(event))
}

export function mutationProjectionTags(path: string): ProjectionTag[] {
  const clean = path.replace(/^\/+/, "")
  if (clean === "queries") return []
  if (clean === "actions") return ["actions", "approvals", "work", "activity", "events", "queries"]
  if (/^actions\/[^/]+\/(confirm|reject|escalate|revert)$/.test(clean)) {
    return ["actions", "approvals", "workflows", "work", "receipts", "activity", "events", "customers", "schedule", "money", "agents", "queries"]
  }
  if (/^workflows\/runs\/[^/]+\//.test(clean)) return ["workflows", "work", "actions", "approvals", "receipts", "activity", "events", "queries"]
  if (/^instructions\/[^/]+\/cancel$/.test(clean) || /^works\/[^/]+\/retry$/.test(clean)) return ["work", "workflows", "actions", "activity", "events", "queries"]
  if (clean === "dispatch/map" || clean === "technician/my-day") return ["schedule", "work", "customers", "activity", "events", "queries"]
  if (clean === "corrections") return ["receipts", "customers", "work", "queries"]
  if (/^data-quality\//.test(clean)) return ["work", "activity", "events", "queries"]
  if (/^dlq\//.test(clean)) return ["system", "workflows", "activity"]
  if (/^(policies|price-book)\//.test(clean)) return ["agents", "system", "queries"]
  if (clean === "user-prefs" || clean === "push-subscriptions") return ["preferences"]
  return ["work", "activity", "events", "queries"]
}

export function businessEventProjectionTags(eventType: string, entityType: string): ProjectionTag[] {
  const value = `${eventType}:${entityType}`.toLowerCase()
  const tags = new Set<ProjectionTag>(["activity", "work", "queries"])
  if (/(payment|invoice|collection|cash|quote|proposal)/.test(value)) { tags.add("money"); tags.add("customers") }
  if (/(appointment|visit|schedule|route|technician|work_order)/.test(value)) { tags.add("schedule"); tags.add("customers") }
  if (/(household|customer|lead|contact|conversation|call|communication)/.test(value)) tags.add("customers")
  if (/(action|approval)/.test(value)) { tags.add("actions"); tags.add("approvals") }
  if (/(workflow|step|run)/.test(value)) tags.add("workflows")
  if (/(receipt|evidence|correction)/.test(value)) tags.add("receipts")
  return [...tags]
}
