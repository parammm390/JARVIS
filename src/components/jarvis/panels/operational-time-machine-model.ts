import type { CausalReplayEdge, CausalReplayNode, CausalReplayStage } from "@/lib/jarvis-client"

export type ReplayFilter = "all" | "governance" | "execution" | "outcomes" | "problems"

const FILTER_STAGES: Record<Exclude<ReplayFilter, "all">, Set<CausalReplayStage>> = {
  governance: new Set(["context", "policy", "authority", "approval"]),
  execution: new Set(["planning", "dependency", "execution", "provider", "external_event"]),
  outcomes: new Set(["canonical_change", "verification", "receipt", "evidence"]),
  problems: new Set(["failure", "recovery", "compensation", "missing"]),
}

export function nodesAtMoment(nodes: CausalReplayNode[], at: string, filter: ReplayFilter): CausalReplayNode[] {
  const stages = filter === "all" ? null : FILTER_STAGES[filter]
  return nodes.filter((node) => node.occurredAt <= at && (!stages || stages.has(node.stage)))
}

export function connectedEdges(edges: CausalReplayEdge[], retainedNodeIds: Set<string>): CausalReplayEdge[] {
  return edges.filter((edge) => retainedNodeIds.has(edge.from) && retainedNodeIds.has(edge.to))
}

export function humanizeReplay(value: string): string {
  return value.replace(/[_\-.]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

export function boundedFacts(value: Record<string, unknown>): string {
  const serialized = JSON.stringify(value, null, 2)
  return serialized.length > 8_000 ? `${serialized.slice(0, 8_000)}\n… bounded` : serialized
}
