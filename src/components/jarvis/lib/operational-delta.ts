import type { ProjectionTag } from "./business-projection-cache"

export interface OperationalDelta {
  cursor: string
  changeType: string
  priority: "low" | "normal" | "high"
  entityRefs: Array<{ entityType: string; entityId: string }>
  workId: string | null
  projectionTags: string[]
  occurredAt: string
}

export interface OperationalDeltaPage {
  status: "ok" | "resync_required"
  cursor: string
  deltas: OperationalDelta[]
  hasMore: boolean
  retentionDays: number
}

export interface OperationalCursorState { cursor: string; scope: string; seq: bigint }
export type DeltaReduction =
  | { kind: "apply"; state: OperationalCursorState; tags: ProjectionTag[]; highPriority: boolean }
  | { kind: "ignore"; state: OperationalCursorState }
  | { kind: "resync"; state: OperationalCursorState | null }

export const ALL_REALTIME_TAGS: readonly ProjectionTag[] = [
  "actions", "activity", "agents", "approvals", "comms", "computer", "customers",
  "events", "inventory", "money", "preferences", "queries", "receipts", "schedule", "system", "work", "workflows",
]
const VALID_TAGS = new Set<string>(ALL_REALTIME_TAGS)

export function parseOperationalCursor(cursor: string): OperationalCursorState | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(0|[1-9][0-9]*)$/i.exec(cursor)
  if (!match) return null
  return { cursor, scope: match[1]!, seq: BigInt(match[2]!) }
}

/** Same/older frames are deduped; scope changes and sequence gaps require an
 * authenticated full projection resync. */
export function reduceOperationalDelta(current: OperationalCursorState, delta: OperationalDelta): DeltaReduction {
  const next = parseOperationalCursor(delta.cursor)
  if (!next || next.scope !== current.scope) return { kind: "resync", state: next }
  if (next.seq <= current.seq) return { kind: "ignore", state: current }
  if (next.seq !== current.seq + BigInt(1)) return { kind: "resync", state: current }
  return {
    kind: "apply",
    state: next,
    tags: [...new Set(delta.projectionTags.filter((tag): tag is ProjectionTag => VALID_TAGS.has(tag)))],
    highPriority: delta.priority === "high",
  }
}
