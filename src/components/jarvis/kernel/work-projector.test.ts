import { describe, expect, it } from "vitest"
import type { WorkCaseProjection } from "@/lib/jarvis-client"
import { projectWorkToThread } from "./work-projector"

type ObjectiveState = NonNullable<WorkCaseProjection["objectiveLoop"]>["state"]
type DurableStatus = NonNullable<WorkCaseProjection["durableWork"]>["status"]

function workCase(status: DurableStatus, objectiveState: ObjectiveState = "continue", verified = false): WorkCaseProjection {
  return {
    id: "work-1",
    root: { kind: "work", id: "work-1" },
    title: "Durable objective",
    status: status === "blocked" ? "Blocked" : status === "waiting" ? "Waiting" : status === "failed" ? "Failed" : "Working",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:01:00.000Z",
    source: { kind: "instruction", id: "instruction-1", channel: "text" },
    instruction: null,
    actions: [],
    approvals: [],
    workflows: [],
    receipts: [],
    linkedEntities: [],
    businessEvents: [],
    calls: [],
    relatedActionIds: [],
    provenance: ["works(work-1)"],
    durableWork: {
      id: "work-1",
      status,
      executionModel: "objective",
      sessionId: "session-1",
      channel: "text",
      activeContext: null,
      initiatedBy: "employee-1",
      currentOwnerId: "employee-1",
      assignedTo: "employee-1",
      authorityContext: null,
      finalOutcome: {
        response: {
          executionModel: "OBJECTIVE",
          actions: [],
          assistantMessage: { semanticKind: "ACKNOWLEDGEMENT" },
        },
      },
      failure: null,
      recovery: null,
      handoffs: [],
    },
    objectiveLoop: {
      id: "objective-1",
      objective: "Finish only after verification",
      state: objectiveState,
      revision: 3,
      reason: objectiveState === "blocked" ? "Provider unavailable" : null,
      nextStep: objectiveState === "blocked" ? "Reconnect the provider" : null,
      nextRunAt: objectiveState === "waiting" ? "2026-08-26T01:00:00.000Z" : null,
      lastObservation: null,
      successCondition: { version: 1 },
      successVerification: verified ? { state: "verified" } : null,
      successVerifiedAt: verified ? "2026-08-26T00:01:00.000Z" : null,
      cancelledAt: null,
      budget: { steps: 1, maxSteps: 10, actions: 0, maxActions: 10, queries: 1, maxQueries: 10 },
      iterations: [],
      eventWaits: [],
      wakeClaims: [],
    },
  }
}

describe("canonical Work → Thread projector", () => {
  it.each([
    ["executing", "continue", "executing"],
    ["waiting", "waiting", "waiting"],
    ["blocked", "blocked", "blocked"],
    ["recovery", "continue", "recovering"],
    ["awaiting_approval", "awaiting_approval", "awaiting_approval"],
    ["failed", "failed", "failed"],
    ["cancelled", "cancelled", "cancelled"],
  ] as const)("maps durable %s/%s without flattening posture", (status, objectiveState, expected) => {
    expect(projectWorkToThread(workCase(status, objectiveState)).instructionState).toBe(expected)
  })

  it("requires canonical success verification before Objective completion", () => {
    expect(projectWorkToThread(workCase("completed", "completed", false)).instructionState).toBe("verifying")
    expect(projectWorkToThread(workCase("completed", "completed", true)).instructionState).toBe("completed")
  })

  it("never restores an Objective acknowledgement as an Answer", () => {
    const projected = projectWorkToThread(workCase("executing", "continue"), {
      assistantMessage: {
        id: "assistant-1",
        sequence: 2,
        role: "assistant",
        originalText: "I started durable Work.",
        instructionId: "instruction-1",
        workId: "work-1",
        outcomeRefs: [{ kind: "assistant_semantic", semanticKind: "ACKNOWLEDGEMENT" }],
        createdAt: "2026-08-26T00:00:01.000Z",
      },
    })
    expect(projected.assistantSemanticKind).toBe("ACKNOWLEDGEMENT")
    expect(projected.answerResult).toBeNull()
    expect(projected.instructionState).toBe("executing")
  })

  it("projects the complete canonical Objective and uses its durable wait contract", () => {
    const work = workCase("waiting", "waiting")
    work.objectiveLoop!.reason = null
    work.objectiveLoop!.nextRunAt = null
    work.objectiveLoop!.eventWaits = [{
      id: "wait-1",
      status: "waiting",
      expectedEventType: "customer.replied",
      conditionSummary: "Waiting for the customer reply",
      matchedEventId: null,
      earliestAt: "2026-08-26T00:00:00.000Z",
      deadlineAt: "2026-08-27T00:00:00.000Z",
      satisfiedAt: null,
      timedOutAt: null,
    }]
    const projected = projectWorkToThread(work)
    expect(projected.objectiveProjection).toBe(work.objectiveLoop)
    expect(projected.workPosture).toMatchObject({ reason: "Waiting for the customer reply", nextRunAt: "2026-08-27T00:00:00.000Z" })
  })

  it("records execution from existing BusinessEffect truth even before an action receipt", () => {
    const work = workCase("executing", "continue")
    work.businessEffects = [{ id: "effect-1", domainActionId: "action-1", semanticHash: "hash", status: "executing", verification: null, observedAt: null }]
    expect(projectWorkToThread(work).everExecuted).toBe(true)
  })

  it("projects canonical failure codes into bounded, truthful UI copy", () => {
    const work = workCase("failed", "failed")
    work.durableWork!.failure = { code: "worker_fleet_unavailable" }
    const projected = projectWorkToThread(work)
    expect(projected.submitError).toMatch(/operating worker is temporarily unavailable/i)
    expect(projected.submitError).not.toMatch(/reach the operating system/i)
  })

  it("normalizes durable legacy atomic_effect rows during the rolling deploy", () => {
    const work = workCase("executing", "continue")
    work.objectiveLoop = undefined
    work.durableWork!.executionModel = "atomic_effect" as never
    work.durableWork!.finalOutcome = null
    expect(projectWorkToThread(work).executionModel).toBe("ATOMIC_ACTION")
  })
})
