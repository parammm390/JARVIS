import { describe, expect, it } from "vitest"
import type { ExecutionActionNode } from "@/lib/jarvis-client"
import { boundedOutcomeSummary, buildExecutionLayers } from "./execution-theater-model"

function node(id: string, dependencyIds: string[] = []): ExecutionActionNode {
  return { id, dependencyIds } as ExecutionActionNode
}

describe("Execution Theater model", () => {
  it("keeps independent branches parallel and unlocks their dependent layer", () => {
    expect(buildExecutionLayers([node("a"), node("b", ["a"]), node("c", ["a"]), node("d", ["b", "c"])]).map((layer) => layer.map((item) => item.id))).toEqual([
      ["a"], ["b", "c"], ["d"],
    ])
  })

  it("keeps cyclic nodes visible instead of inventing an order", () => {
    expect(buildExecutionLayers([node("a", ["b"]), node("b", ["a"])]).map((layer) => layer.map((item) => item.id))).toEqual([["a", "b"]])
  })

  it("summarizes known result fields without rendering a raw object dump", () => {
    expect(boundedOutcomeSummary({ output: { status: "delivered", providerBlob: { opaque: true } } })).toBe("Status: delivered.")
    expect(boundedOutcomeSummary({ providerBlob: { opaque: true } })).toContain("canonical receipt")
  })
})
