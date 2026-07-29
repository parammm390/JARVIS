// jarvis-v3 P4.T6 — pure-function coverage for isSandboxStep, no DOM needed.

import { describe, it, expect } from "vitest"
import { isSandboxStep } from "./sandbox-detection"

describe("isSandboxStep", () => {
  it("create_payment_link is sandboxed when payments isn't stripe", () => {
    expect(isSandboxStep("create_payment_link", { payments: { mode: "emulator", source: "default" } })).toBe(true)
  })
  it("create_payment_link is real once payments really is stripe", () => {
    expect(isSandboxStep("create_payment_link", { payments: { mode: "stripe", source: "tenant" } })).toBe(false)
  })
  it("send_message is sandboxed when crm resolves to native (sandbox.ts's real DB-only path) or emulator", () => {
    expect(isSandboxStep("send_message", { crm: { mode: "native", source: "default" } })).toBe(true)
    expect(isSandboxStep("send_message", { crm: { mode: "emulator", source: "env" } })).toBe(true)
  })
  it("send_message is real once crm really is ghl", () => {
    expect(isSandboxStep("send_message", { crm: { mode: "ghl", source: "tenant" } })).toBe(false)
  })
  it("never applies to a step type this literal wasn't written for (sync_invoice, hold_appointment, …)", () => {
    expect(isSandboxStep("sync_invoice", { payments: { mode: "emulator", source: "default" } })).toBe(false)
    expect(isSandboxStep("hold_appointment", undefined)).toBe(false)
  })
  it("never guesses before bindings have loaded", () => {
    expect(isSandboxStep("create_payment_link", undefined)).toBe(false)
  })
})
