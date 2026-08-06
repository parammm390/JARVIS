import { describe, expect, it } from "vitest"
import { executionProgressForActions, runsForActionIds, scopedExecutionMode } from "./execution-presentation"
import type { WorkflowRun } from "../lib/data-core"

function run(id: string, status: string, domainActionId: string | null, stepStatuses: string[], updatedAt: string): WorkflowRun {
  return {
    id,
    workflowType: "invoice_to_cash",
    status,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    steps: stepStatuses.map((stepStatus, sequence) => ({
      id: `${id}-step-${sequence}`,
      stepType: ["create_payment_link", "send_message", "sync_invoice"][sequence] ?? "step",
      sequence,
      status: stepStatus,
      attempts: 1,
      terminalReason: null,
      domainActionId,
      updatedAt,
    })),
  }
}

describe("instruction-scoped execution presentation", () => {
  it("filters out unrelated tenant runs, including runs with no action link", () => {
    const related = run("related", "running", "action-1", ["leased", "pending"], "2026-08-02T10:00:00Z")
    const unrelated = run("unrelated", "running", "other-action", ["leased"], "2026-08-02T10:01:00Z")
    const unlinked = run("unlinked", "running", null, ["leased"], "2026-08-02T10:02:00Z")

    expect(runsForActionIds([related, unrelated, unlinked], ["action-1"]).map((item) => item.id)).toEqual(["related"])
  })

  it("counts real partial progress and leaves missing action rows unresolved", () => {
    const progress = executionProgressForActions(
      ["action-1", "action-2", "action-3"],
      [
        run("done", "completed", "action-1", ["completed", "completed", "completed"], "2026-08-02T10:00:00Z"),
        run("failed", "failed", "action-2", ["completed", "failed", "pending"], "2026-08-02T10:01:00Z"),
      ],
    )

    expect(progress).toMatchObject({
      totalActions: 3,
      linkedActions: 2,
      completedActions: 1,
      failedActions: 1,
      activeActions: 0,
      unresolvedActions: 1,
      totalSteps: 6,
      completedSteps: 4,
      failedSteps: 1,
    })
    expect(progress.actionStates).toEqual({ "action-1": "completed", "action-2": "failed", "action-3": "unobserved" })
  })

  it.each([1, 3, 6] as const)("keeps %s linked lanes scoped and counts terminal partials", (laneCount) => {
    const actionIds = Array.from({ length: laneCount }, (_, index) => `lane-${index + 1}`)
    const runs = actionIds.map((actionId, index) => run(
      `${actionId}-run`,
      index === 0 ? "completed" : index === 1 ? "failed" : "running",
      actionId,
      index === 0 ? ["completed"] : index === 1 ? ["failed"] : ["leased"],
      `2026-08-02T10:0${index}:00Z`,
    ))
    const progress = executionProgressForActions(actionIds, runs)
    expect(progress.totalActions).toBe(laneCount)
    expect(progress.linkedActions).toBe(laneCount)
    expect(progress.completedActions).toBe(laneCount >= 1 ? 1 : 0)
    expect(progress.failedActions).toBe(laneCount >= 2 ? 1 : 0)
    expect(progress.activeActions).toBe(laneCount >= 3 ? laneCount - 2 : 0)
  })

  it("counts only the steps carrying the instruction action id", () => {
    const mixed = run("mixed", "running", "action-1", ["completed", "pending"], "2026-08-02T10:00:00Z")
    mixed.steps[1] = { ...mixed.steps[1]!, domainActionId: "other-action" }
    const progress = executionProgressForActions(
      ["action-1"],
      [mixed],
    )

    expect(progress).toMatchObject({ totalSteps: 1, completedSteps: 1, completedActions: 1, failedSteps: 0 })
  })

  it("keeps the freshest duplicate run snapshot", () => {
    const old = run("same-run", "running", "action-1", ["leased"], "2026-08-02T10:00:00Z")
    const fresh = run("same-run", "completed", "action-1", ["completed"], "2026-08-02T10:01:00Z")

    expect(runsForActionIds([old, fresh], ["action-1"])[0]?.status).toBe("completed")
  })

  it("uses trace outcomes for synchronous actions before their durable run arrives", () => {
    const progress = executionProgressForActions(["action-1", "action-2"], [], {
      completedActionIds: ["action-1"],
      failedActionIds: ["action-2"],
    })

    expect(progress).toMatchObject({ linkedActions: 2, completedActions: 1, failedActions: 1, unresolvedActions: 0 })
  })

  it("keeps running and paused actions visible as distinct live states", () => {
    const progress = executionProgressForActions(
      ["running-action", "paused-action"],
      [
        run("running-run", "running", "running-action", ["leased"], "2026-08-02T10:00:00Z"),
        run("paused-run", "paused", "paused-action", ["pending"], "2026-08-02T10:01:00Z"),
      ],
    )

    expect(progress).toMatchObject({ activeActions: 2, runningActions: 1, pausedActions: 1 })
  })

  it("keeps six linked lanes and every recovery state distinct", () => {
    const progress = executionProgressForActions(
      ["a", "b", "c", "d", "e", "f"],
      [
        run("a-run", "completed", "a", ["completed"], "2026-08-02T10:00:00Z"),
        run("b-run", "failed", "b", ["failed"], "2026-08-02T10:01:00Z"),
        run("c-run", "compensating", "c", ["compensating"], "2026-08-02T10:02:00Z"),
        run("d-run", "compensated", "d", ["compensated"], "2026-08-02T10:03:00Z"),
        run("e-run", "cancelled", "e", ["pending"], "2026-08-02T10:04:00Z"),
        run("f-run", "escalated", "f", ["pending"], "2026-08-02T10:05:00Z"),
      ],
    )

    expect(progress.actionStates).toEqual({ a: "completed", b: "failed", c: "compensating", d: "compensated", e: "cancelled", f: "escalated" })
    expect(progress).toMatchObject({ totalActions: 6, linkedActions: 6, completedActions: 1, failedActions: 1, compensatingActions: 1, compensatedActions: 1, cancelledActions: 1, escalatedActions: 1, activeActions: 1 })
  })

  it("does not let an action/run race attach an unrelated run or erase a real terminal result", () => {
    const progress = executionProgressForActions(
      ["action-1", "action-2"],
      [
        run("action-1-run", "completed", "action-1", ["completed"], "2026-08-02T10:05:00Z"),
        run("other-run", "running", "other-action", ["leased"], "2026-08-02T10:06:00Z"),
      ],
    )
    expect(progress.actionStates).toEqual({ "action-1": "completed", "action-2": "unobserved" })
    expect(progress.linkedActions).toBe(1)
    expect(progress.unresolvedActions).toBe(1)
  })

  it("keeps blocked actions truthful before a workflow run exists", () => {
    const progress = executionProgressForActions(["blocked", "missing"], [], undefined, ["blocked"])
    expect(progress.actionStates).toEqual({ blocked: "blocked", missing: "unobserved" })
    expect(progress).toMatchObject({ blockedActions: 1, linkedActions: 1, unresolvedActions: 1 })
  })

  it("distinguishes empty scope, no-run trace, and waiting", () => {
    const empty = executionProgressForActions([], [])
    const trace = executionProgressForActions(["trace"], [], { completedActionIds: ["trace"] })
    const waiting = executionProgressForActions(["waiting"], [])
    expect(scopedExecutionMode([], [], [], empty)).toBe("empty")
    expect(scopedExecutionMode(["trace"], [], [], trace)).toBe("trace")
    expect(scopedExecutionMode(["waiting"], [], [], waiting)).toBe("waiting")
  })
})
