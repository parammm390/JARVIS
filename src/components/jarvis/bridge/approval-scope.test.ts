import { describe, expect, it } from "vitest"
import { actionBelongsToApprovalScope, filterApprovalActions } from "./approval-scope"

const action = (id: string, instructionId?: string) => ({ id, instructionId })

describe("approval scope", () => {
  it("leaves the standalone tenant-wide cockpit unfiltered", () => {
    expect(filterApprovalActions([action("thread-action"), action("unrelated")], {})).toHaveLength(2)
  })

  it("keeps only the active thread's action ids", () => {
    const actions = [action("active-1"), action("active-2"), action("unrelated")]
    expect(filterApprovalActions(actions, { actionIds: ["active-1", "active-2"] }).map((a) => a.id)).toEqual(["active-1", "active-2"])
  })

  it("uses instruction_id as a real fallback while trace-created action ids catch up", () => {
    const actions = [action("known-id", "instruction-1"), action("late-id", "instruction-1"), action("unrelated", "instruction-2")]
    expect(filterApprovalActions(actions, { actionIds: ["known-id"], instructionId: "instruction-1" }).map((a) => a.id)).toEqual(["known-id", "late-id"])
  })

  it("treats an explicit empty action-id list as safely empty", () => {
    expect(actionBelongsToApprovalScope(action("unrelated"), { actionIds: [] })).toBe(false)
    expect(filterApprovalActions([action("unrelated")], { actionIds: [] })).toEqual([])
  })
})
