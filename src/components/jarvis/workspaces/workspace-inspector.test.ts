import { describe, expect, it } from "vitest"
import type { Thread } from "../kernel/store"
import type { WorkspaceProjection } from "./contracts"
import { buildWorkspaceInspector, groupWorkspaceInspector } from "./workspace-inspector"

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1", sessionId: "session-1", instructionId: "instruction-1", workId: "work-1", source: "typed",
    instructionText: "Show the current business state", createdAtMs: 1, machine: { instructionState: "completed" }, nodes: [], contextChips: [],
    traceGating: { expectedCount: 0, resolvedActionIds: [], gatedActionIds: [] }, clarification: null, submitError: null,
    approvalWatch: null, runWatch: null, terminalAtMs: 2, everExecuted: false, receiptRefreshTick: 0,
    ...overrides,
  }
}

function projection(overrides: Partial<WorkspaceProjection> = {}): WorkspaceProjection {
  return {
    key: "work-1:instruction-1", kind: "research", title: "Business operating state", eyebrow: "research", description: "Current state",
    state: "completed", workId: "work-1", instructionId: "instruction-1", instruction: "Show the current business state", updatedAtMs: 2, actions: [],
    ...overrides,
  }
}

describe("contextual workspace inspector", () => {
  it("makes a read-only result explicit without inventing policy or execution", () => {
    const items = buildWorkspaceInspector(thread({ answerResult: { kind: "answer", spokenSummary: "Three operating queues are open.", evidence: [{ source: "business_state", ref: "query-1" }] } }), projection(), "owner")
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["Supporting sources", "Policy / permission", "Expected change", "Authority boundary", "What happened", "Evidence / closure"]))
    expect(items.find((item) => item.label === "Expected change")?.value).toContain("No business-state change")
    expect(items.find((item) => item.label === "What happened")?.value).toContain("Three operating queues")
    expect(items.find((item) => item.label === "Durable Work")?.href).toContain("work-1")
  })

  it("states the approval boundary and recorded policy without exposing planner reasoning", () => {
    const active = thread({
      machine: { instructionState: "awaiting_approval" },
      nodes: [{ id: "action-1", actionType: "send_payment_reminder", amountUsd: 240, targetLabel: "Invoice 7", policyId: "collections", policyVersion: 3, groundedPayload: [{ field: "invoiceId", status: "verified" }], payload: {}, reasoning: "private planner trace" }],
    })
    const items = buildWorkspaceInspector(active, projection({ state: "awaiting_approval", actions: [{ id: "action-1", actionType: "send_payment_reminder", amountUsd: 240, targetLabel: "Invoice 7", payload: {}, policyVersion: 3 }] }), "dispatcher")
    const rendered = items.map((item) => item.value).join(" ")
    expect(rendered).toContain("Policy collections · v3")
    expect(rendered).toContain("recorded human decision is required")
    expect(rendered).not.toContain("private planner trace")
  })

  it("keeps Work state, authority, and source evidence as the primary lens", () => {
    const items = buildWorkspaceInspector(thread({ answerResult: { kind: "answer", spokenSummary: "Three operating queues are open.", evidence: [{ source: "business_state", ref: "query-1" }] } }), projection(), "owner")
    const groups = groupWorkspaceInspector(items)
    expect(groups.primary.map((item) => item.label)).toEqual(["Work state", "Authority", "Source evidence"])
    expect(groups.primary.find((item) => item.label === "Source evidence")?.value).toContain("business_state")
    expect(groups.advanced.map((item) => item.label)).toContain("Policy / permission")
    expect(groups.durableWork?.href).toContain("work-1")
  })
})
