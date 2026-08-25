import { describe, expect, it } from "vitest"
import type { CausalReplayEdge, CausalReplayNode, CausalReplayStage } from "@/lib/jarvis-client"
import { boundedFacts, connectedEdges, humanizeReplay, nodesAtMoment } from "./operational-time-machine-model"

function node(id: string, stage: CausalReplayStage, occurredAt: string): CausalReplayNode {
  return { id, stage, title: id, summary: id, status: "recorded", occurredAt, sourceRefs: [`facts:${id}`], evidence: [{ source: "facts", ref: id, recordedAt: occurredAt, availability: "available", integrityHash: null }], facts: {}, entityRefs: [] }
}

const NODES = [
  node("trigger", "trigger", "2026-08-22T09:00:00.000Z"),
  node("authority", "authority", "2026-08-22T09:01:00.000Z"),
  node("provider", "provider", "2026-08-22T09:02:00.000Z"),
  node("failure", "failure", "2026-08-22T09:03:00.000Z"),
  node("receipt", "receipt", "2026-08-22T09:04:00.000Z"),
]

const EDGES: CausalReplayEdge[] = [
  { id: "edge-1", from: "trigger", to: "authority", relation: "governed", certainty: "proven", evidenceRefs: ["facts:authority"], explanation: "exact" },
  { id: "edge-2", from: "authority", to: "provider", relation: "authorized", certainty: "proven", evidenceRefs: ["facts:provider"], explanation: "exact" },
  { id: "edge-3", from: "provider", to: "failure", relation: "failed", certainty: "proven", evidenceRefs: ["facts:failure"], explanation: "exact" },
  { id: "edge-4", from: "failure", to: "receipt", relation: "settled", certainty: "proven", evidenceRefs: ["facts:receipt"], explanation: "exact" },
]

describe("Operational Time Machine pure replay model", () => {
  it("scrubs by durable timestamp without leaking future facts", () => {
    expect(nodesAtMoment(NODES, "2026-08-22T09:02:30.000Z", "all").map((item) => item.id)).toEqual(["trigger", "authority", "provider"])
    expect(nodesAtMoment(NODES, "2026-08-22T09:04:00.000Z", "governance").map((item) => item.id)).toEqual(["authority"])
    expect(nodesAtMoment(NODES, "2026-08-22T09:04:00.000Z", "problems").map((item) => item.id)).toEqual(["failure"])
  })

  it("retains only causal edges whose two facts are visible at the scrubbed moment", () => {
    const visible = new Set(nodesAtMoment(NODES, "2026-08-22T09:02:30.000Z", "all").map((item) => item.id))
    expect(connectedEdges(EDGES, visible).map((edge) => edge.id)).toEqual(["edge-1", "edge-2"])
  })

  it("formats event names and bounds inspector serialization", () => {
    expect(humanizeReplay("customer.updated-state")).toBe("Customer Updated State")
    expect(boundedFacts({ evidence: "x".repeat(9_000) })).toMatch(/… bounded$/)
  })
})
