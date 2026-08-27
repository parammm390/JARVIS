import { beforeEach, describe, expect, it, vi } from "vitest"

const jarvisPostMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/api", () => ({
  jarvisGet: vi.fn(),
  jarvisPost: jarvisPostMock,
}))

import { submitInstruction } from "./instruction"

describe("Phase 6 canonical thread submission", () => {
  beforeEach(() => {
    jarvisPostMock.mockReset()
  })

  it("continues the Postgres thread while keeping sessionId transport-only", async () => {
    jarvisPostMock.mockResolvedValue({
      executionModel: "OBJECTIVE",
      actions: [],
      workId: "work-1",
      workInputId: "work-input-1",
      instructionId: "instruction-2",
      threadId: "canonical-thread-1",
      objectiveLoopId: "objective-1",
      objectiveState: "continue",
      assistantMessage: { id: "message-2", originalText: "Actual response", createdAt: "2026-08-25T00:00:00.000Z", semanticKind: "ACKNOWLEDGEMENT" },
    })

    const result = await submitInstruction("Continue that.", {
      source: "typed",
      sessionId: "typed:transport-session",
      instructionId: "instruction-2",
      workId: "work-1",
      threadId: "canonical-thread-1",
    })

    expect(jarvisPostMock).toHaveBeenCalledWith("actions", expect.objectContaining({
      instruction: "Continue that.",
      sessionId: "typed:transport-session",
      threadId: "canonical-thread-1",
      workId: "work-1",
    }))
    expect(result).toMatchObject({
      threadId: "canonical-thread-1",
      workId: "work-1",
      assistantMessage: { originalText: "Actual response" },
    })
  })
})
