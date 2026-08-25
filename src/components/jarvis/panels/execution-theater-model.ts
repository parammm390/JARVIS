import type { ExecutionActionNode } from "@/lib/jarvis-client"

/** Stable topological layers from the canonical dependsOn IDs. Independent roots
 * share a layer; missing/cyclic dependencies remain visible in a final blocked layer
 * instead of being silently serialized or discarded. */
export function buildExecutionLayers(nodes: readonly ExecutionActionNode[]): ExecutionActionNode[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const remaining = new Set(nodes.map((node) => node.id))
  const emitted = new Set<string>()
  const layers: ExecutionActionNode[][] = []
  while (remaining.size > 0) {
    const layer = nodes.filter((node) => remaining.has(node.id) && node.dependencyIds.every((id) => !byId.has(id) || emitted.has(id)))
    if (layer.length === 0) {
      layers.push(nodes.filter((node) => remaining.has(node.id)))
      break
    }
    layers.push(layer)
    for (const node of layer) {
      remaining.delete(node.id)
      emitted.add(node.id)
    }
  }
  return layers
}

export function boundedOutcomeSummary(value: Record<string, unknown> | null): string {
  if (!value) return "No durable result recorded."
  const output = value.output && typeof value.output === "object" && !Array.isArray(value.output) ? value.output as Record<string, unknown> : value
  if (typeof output.status === "string") return `Status: ${output.status.replaceAll("_", " ")}.`
  if (typeof output.message === "string") return output.message.slice(0, 180)
  if (typeof output.scheduledAt === "string") return `Scheduled for ${new Date(output.scheduledAt).toLocaleString()}.`
  if (typeof output.deliveryCount === "number") return `${output.deliveryCount} delivery result${output.deliveryCount === 1 ? "" : "s"} recorded.`
  if (typeof output.count === "number") return `${output.count} result${output.count === 1 ? "" : "s"} recorded.`
  if (typeof output.id === "string") return `Result reference ${shortId(output.id)} recorded.`
  return "A structured result is preserved in the canonical receipt."
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}
