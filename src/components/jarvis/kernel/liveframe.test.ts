import { describe, expect, it } from "vitest"
import {
  deriveLiveFrame,
  LIVEFRAME_ENERGY_BASE,
  LIVEFRAME_FOCUSES,
  LIVEFRAME_MODES,
  type LiveFrameInput,
  type LiveFrameInstructionSignals,
  type LiveFrameRunSignal,
} from "./liveframe"

function instruction(state: LiveFrameInstructionSignals["state"], overrides: Partial<LiveFrameInstructionSignals> = {}): LiveFrameInstructionSignals {
  return {
    state,
    actionIds: [],
    ...overrides,
  }
}

function run(
  id: string,
  status: string,
  steps: LiveFrameRunSignal["steps"] = [],
): LiveFrameRunSignal {
  return { id, status, steps }
}

function input(overrides: Partial<LiveFrameInput> = {}): LiveFrameInput {
  return {
    presence: "dormant",
    transport: "polling",
    micOpen: false,
    voiceSpeaking: false,
    localVolumeLevel: 0,
    nowMs: 1_000,
    instruction: null,
    workflowRuns: [],
    latestImpulse: null,
    ...overrides,
  }
}

describe("kernel/liveframe — exact mode set", () => {
  it("exposes exactly the eight plan modes", () => {
    expect(LIVEFRAME_MODES).toEqual([
      "ready",
      "listening",
      "thinking",
      "decision",
      "working",
      "verifying",
      "resolved",
      "fault",
    ])
  })

  it.each([
    ["ready", input()],
    ["listening", input({ presence: "listening", micOpen: true, localVolumeLevel: 0.2 })],
    ["thinking", input({ presence: "thinking", instruction: instruction("planning") })],
    ["decision", input({ presence: "asking", instruction: instruction("clarifying") })],
    ["working", input({
      presence: "working",
      instruction: instruction("executing", { actionIds: ["action-1"] }),
      workflowRuns: [run("run-1", "running", [{ id: "step-1", domainActionId: "action-1", status: "leased" }])],
    })],
    ["verifying", input({ presence: "verifying", instruction: instruction("verifying") })],
    ["resolved", input({ presence: "resolved", instruction: instruction("completed") })],
    ["fault", input({ presence: "wounded", instruction: instruction("failed") })],
  ] as const)("derives %s", (expected, current) => {
    expect(deriveLiveFrame(current).mode).toBe(expected)
  })
})

describe("kernel/liveframe — every focus branch", () => {
  it("exposes exactly the seven plan focus values", () => {
    expect(LIVEFRAME_FOCUSES).toEqual([
      "presence",
      "thread",
      "clarification",
      "approval",
      "workflow",
      "receipt",
      "recovery",
    ])
  })

  it.each([
    ["presence", input()],
    ["thread", input({ instruction: instruction("planning") })],
    ["clarification", input({ instruction: instruction("clarifying") })],
    ["approval", input({ instruction: instruction("awaiting_approval") })],
    ["workflow", input({
      instruction: instruction("executing", { actionIds: ["action-1"] }),
      workflowRuns: [run("run-1", "running", [{ id: "step-1", domainActionId: "action-1", status: "leased" }])],
    })],
    ["receipt", input({ instruction: instruction("completed") })],
    ["recovery", input({ instruction: instruction("failed") })],
  ] as const)("derives %s focus", (expected, current) => {
    expect(deriveLiveFrame(current).focus).toBe(expected)
  })
})

describe("kernel/liveframe — §3.2 focus priority", () => {
  it("1. clarification outranks approval, execution, verification, voice, planning, and terminal residue", () => {
    const projection = deriveLiveFrame(input({
      presence: "asking",
      micOpen: true,
      voiceSpeaking: true,
      instruction: instruction("planning", {
        clarificationRequired: true,
        approvalRequired: true,
        verificationActive: true,
        recoveryActive: true,
        actionIds: ["action-1"],
      }),
      workflowRuns: [run("run-1", "running", [{ id: "step-1", domainActionId: "action-1", status: "leased" }])],
    }))
    expect(projection).toMatchObject({ mode: "decision", focus: "clarification" })
  })

  it("1. approval outranks execution and voice", () => {
    const projection = deriveLiveFrame(input({
      micOpen: true,
      instruction: instruction("awaiting_approval", { actionIds: ["action-1"] }),
      workflowRuns: [run("run-1", "running", [{ id: "step-1", domainActionId: "action-1", status: "leased" }])],
    }))
    expect(projection).toMatchObject({ mode: "decision", focus: "approval" })
  })

  it("2. active recovery outranks verification and voice", () => {
    const projection = deriveLiveFrame(input({
      micOpen: true,
      instruction: instruction("verifying", { recoveryActive: true }),
    }))
    expect(projection).toMatchObject({ mode: "fault", focus: "recovery" })
  })

  it("2. active execution outranks voice and stays on the thread until a linked run is real", () => {
    const projection = deriveLiveFrame(input({
      micOpen: true,
      instruction: instruction("executing", { actionIds: ["action-1"] }),
    }))
    expect(projection).toMatchObject({ mode: "working", focus: "thread" })
  })

  it("2. active execution transfers focus to the linked workflow only", () => {
    const projection = deriveLiveFrame(input({
      instruction: instruction("executing", { actionIds: ["action-1"] }),
      workflowRuns: [
        run("linked", "running", [{ id: "step-1", domainActionId: "action-1", status: "leased" }]),
        run("unrelated", "running", [{ id: "step-x", domainActionId: "other-action", status: "leased" }]),
      ],
    }))
    expect(projection).toMatchObject({ mode: "working", focus: "workflow", linkedRunIds: ["linked"], activeRunIds: ["linked"], activeStepIds: ["step-1"] })
  })

  it("retains a linked terminal run for the verifying composition without activating it", () => {
    const projection = deriveLiveFrame(input({
      instruction: instruction("verifying", { actionIds: ["action-1"] }),
      workflowRuns: [run("settled", "completed", [{ id: "step-1", domainActionId: "action-1", status: "completed" }])],
    }))
    expect(projection).toMatchObject({ linkedRunIds: ["settled"], activeRunIds: [], activeStepIds: [] })
  })

  it("3. verifying outranks voice", () => {
    const projection = deriveLiveFrame(input({
      micOpen: true,
      voiceSpeaking: true,
      instruction: instruction("verifying"),
    }))
    expect(projection).toMatchObject({ mode: "verifying", focus: "receipt" })
  })

  it("4. active mic/speech outranks planning", () => {
    const projection = deriveLiveFrame(input({
      presence: "listening",
      micOpen: true,
      localVolumeLevel: 0.7,
      instruction: instruction("planning"),
    }))
    expect(projection).toMatchObject({ mode: "listening", focus: "presence" })
  })

  it("5. planning/understanding outranks terminal fallback when no mic is active", () => {
    expect(deriveLiveFrame(input({ instruction: instruction("understanding") }))).toMatchObject({ mode: "thinking", focus: "thread" })
  })

  it("6. completed, partial, and failed terminal outcomes remain legible", () => {
    expect(deriveLiveFrame(input({ instruction: instruction("completed") }))).toMatchObject({ mode: "resolved", focus: "receipt" })
    expect(deriveLiveFrame(input({ instruction: instruction("partial") }))).toMatchObject({ mode: "fault", focus: "recovery" })
    expect(deriveLiveFrame(input({ instruction: instruction("failed") }))).toMatchObject({ mode: "fault", focus: "recovery" })
  })

  it("7. ready is the final branch, while offline idle posture is a fault", () => {
    expect(deriveLiveFrame(input())).toMatchObject({ mode: "ready", focus: "presence" })
    expect(deriveLiveFrame(input({ transport: "offline" }))).toMatchObject({ mode: "fault", focus: "recovery" })
  })
})

describe("kernel/liveframe — variable energy and linked activity", () => {
  it("uses the exact base energy for every mode with no variable inputs", () => {
    const cases = [
      ["ready", input()],
      ["listening", input({ micOpen: true, presence: "listening" })],
      ["thinking", input({ instruction: instruction("planning") })],
      ["decision", input({ instruction: instruction("clarifying") })],
      ["working", input({ instruction: instruction("executing") })],
      ["verifying", input({ instruction: instruction("verifying") })],
      ["resolved", input({ instruction: instruction("completed") })],
      ["fault", input({ instruction: instruction("failed") })],
    ] as const
    for (const [mode, current] of cases) {
      expect(deriveLiveFrame(current).energy).toBe(LIVEFRAME_ENERGY_BASE[mode])
    }
  })

  it("uses local mic level only while the mic is open and clamps it", () => {
    expect(deriveLiveFrame(input({ localVolumeLevel: 1.5, micOpen: false })).voiceEnergy).toBe(0)
    expect(deriveLiveFrame(input({ localVolumeLevel: 1.5, micOpen: true })).voiceEnergy).toBe(1)
    expect(deriveLiveFrame(input({ localVolumeLevel: -1, micOpen: true })).voiceEnergy).toBe(0)
  })

  it("puts the real local mic contribution into the shared energy consumed by the scene", () => {
    const quiet = deriveLiveFrame(input({ presence: "listening", micOpen: true, localVolumeLevel: 0 }))
    const speaking = deriveLiveFrame(input({ presence: "listening", micOpen: true, localVolumeLevel: 0.8 }))

    expect(quiet.voiceEnergy).toBe(0)
    expect(speaking.voiceEnergy).toBe(0.8)
    expect(speaking.energy).toBeCloseTo(quiet.energy + 0.45 * 0.8)
  })

  it("counts only linked leased/compensating steps, caps activity at six, and excludes unrelated runs", () => {
    const actionIds = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]
    const steps = actionIds.map((actionId, index) => ({ id: `s${index + 1}`, domainActionId: actionId, status: "leased" }))
    const projection = deriveLiveFrame(input({
      instruction: instruction("executing", { actionIds }),
      workflowRuns: [
        run("linked", "running", steps),
        run("unrelated", "running", [{ id: "unrelated-step", domainActionId: "other", status: "leased" }]),
      ],
    }))
    expect(projection.activity).toBe(1)
    expect(projection.activeRunIds).toEqual(["linked"])
    expect(projection.activeStepIds).toEqual(actionIds.map((_, index) => `s${index + 1}`))
  })

  it("decays a real impulse and never invents energy after its named duration", () => {
    const latestImpulse = { kind: "step", atMs: 1_000, durationMs: 500 }
    const start = deriveLiveFrame(input({ latestImpulse, nowMs: 1_000 }))
    const middle = deriveLiveFrame(input({ latestImpulse, nowMs: 1_250 }))
    const ended = deriveLiveFrame(input({ latestImpulse, nowMs: 1_500 }))
    expect(start.energy).toBeCloseTo(LIVEFRAME_ENERGY_BASE.ready + 0.2)
    expect(middle.energy).toBeGreaterThan(LIVEFRAME_ENERGY_BASE.ready)
    expect(middle.energy).toBeLessThan(start.energy)
    expect(ended.energy).toBe(LIVEFRAME_ENERGY_BASE.ready)
  })

  it("carries an accepted intent-launch impulse only for its named 260ms window", () => {
    const latestImpulse = { id: 1, kind: "intent-launch" as const, atMs: 1_000, durationMs: 260 }
    const start = deriveLiveFrame(input({ latestImpulse, nowMs: 1_000 }))
    const ended = deriveLiveFrame(input({ latestImpulse, nowMs: 1_260 }))
    expect(start.latestImpulse).toEqual(latestImpulse)
    expect(start.energy).toBeCloseTo(LIVEFRAME_ENERGY_BASE.ready + 0.2)
    expect(ended.energy).toBe(LIVEFRAME_ENERGY_BASE.ready)
  })

  it("maps all existing transport values to the three human-safe postures", () => {
    expect(deriveLiveFrame(input({ transport: "live" })).transportPosture).toBe("healthy")
    expect(deriveLiveFrame(input({ transport: "polling" })).transportPosture).toBe("healthy")
    expect(deriveLiveFrame(input({ transport: "reconnecting" })).transportPosture).toBe("degraded")
    expect(deriveLiveFrame(input({ transport: "unavailable" })).transportPosture).toBe("degraded")
    expect(deriveLiveFrame(input({ transport: "offline" })).transportPosture).toBe("offline")
  })
})
