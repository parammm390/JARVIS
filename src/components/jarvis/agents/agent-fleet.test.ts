import { describe, expect, it } from "vitest"
import type { WorkCaseProjection } from "@/lib/jarvis-client"
import { AGENT_ACTIVITY_UNAVAILABLE, AGENT_FLEET, agentDefinition, assistantStatusCopy, exactAgentKeysForWork, projectAgentActivity, providerStatusCopy } from "./agent-fleet"

function workCase(overrides: Partial<WorkCaseProjection> = {}): WorkCaseProjection {
  return {
    id: "action:work-1",
    root: { kind: "action", id: "work-1" },
    title: "Untitled Work",
    status: "Completed",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    source: { kind: "action", id: "work-1", channel: null },
    instruction: null,
    actions: [],
    approvals: [],
    workflows: [],
    receipts: [],
    linkedEntities: [],
    businessEvents: [],
    calls: [],
    relatedActionIds: [],
    provenance: [],
    ...overrides,
  }
}

describe("P3.T2 Agent Fleet contract", () => {
  it("keeps the five fixed channels in source order", () => {
    expect(AGENT_FLEET.map((agent) => agent.key)).toEqual(["jarvis", "follow-up", "service-reminder", "win-back", "payment-collector"])
    expect(AGENT_FLEET.map((agent) => agent.label)).toEqual(["JARVIS", "Follow-up", "Service Reminder", "Win-back", "Payment Collector"])
  })

  it("keeps the plan-fixed role copy and authority boundary", () => {
    expect(agentDefinition("jarvis").roleCopy).toContain("routes consequential actions through approval")
    expect(agentDefinition("follow-up").roleCopy).toContain("new installation or major service visit")
    expect(agentDefinition("service-reminder").roleCopy).toContain("filter, membrane, or service work")
    expect(agentDefinition("win-back").roleCopy).toContain("approved win-back offer")
    expect(agentDefinition("payment-collector").authorityCopy).toBe("Requires human-approved collection context before outreach.")
    expect(AGENT_FLEET.filter((agent) => !["jarvis", "payment-collector"].includes(agent.key)).every((agent) => agent.authorityCopy === "Calls only from approved or scheduled work under tenant policy.")).toBe(true)
  })

  it("does not expose provider identifiers or invent assistant readiness", () => {
    expect(JSON.stringify(AGENT_FLEET)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
    expect(AGENT_ACTIVITY_UNAVAILABLE).toBe("No exact agent activity is exposed yet.")
  })

  it("keeps provider health separate from agent status", () => {
    expect(providerStatusCopy({ configured: true, healthy: true }).label).toBe("Vapi provider connection verified")
    expect(providerStatusCopy({ configured: false, healthy: null }).tone).toBe("unconfigured")
    expect(providerStatusCopy({ configured: true, healthy: false }).label).toBe("Vapi provider connection unavailable")
    expect(providerStatusCopy(undefined).label).toBe("Vapi provider status unavailable")
    expect(assistantStatusCopy({ agentKey: "jarvis", personaKey: "main", configured: true, healthy: true }).label).toBe("Assistant configuration verified")
    expect(assistantStatusCopy({ agentKey: "follow-up", personaKey: "install_followup", configured: false, healthy: null }).tone).toBe("unconfigured")
    expect(assistantStatusCopy(undefined).label).toBe("Assistant status unavailable")
    expect(agentDefinition("jarvis").roleCopy).not.toContain("Ready")
  })
})

describe("P3.T3 exact Agent → Work → Customer projection", () => {
  it("filters Payment Collector Work to voice collection actions only", () => {
    const overdue = workCase({ actions: [{ actionType: "call_overdue_invoices", payload: {}, id: "a", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })
    const callReminder = workCase({ actions: [{ actionType: "send_payment_reminder", payload: { channel: "call" }, id: "b", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })
    const emailReminder = workCase({ actions: [{ actionType: "send_payment_reminder", payload: { channel: "email" }, id: "c", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })
    const invoiceCreation = workCase({ actions: [{ actionType: "create_invoice", payload: {}, id: "d", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })

    expect(exactAgentKeysForWork(overdue)).toContain("payment-collector")
    expect(exactAgentKeysForWork(callReminder)).toContain("payment-collector")
    expect(exactAgentKeysForWork(emailReminder)).not.toContain("payment-collector")
    expect(exactAgentKeysForWork(invoiceCreation)).not.toContain("payment-collector")
  })

  it("uses the validated bulk voice persona and does not widen SMS or unknown rows", () => {
    const service = workCase({ actions: [{ actionType: "bulk_notify_existing_customers", payload: { channel: "call", voicePersona: "service_reminder" }, id: "a", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })
    const sms = workCase({ actions: [{ actionType: "bulk_notify_existing_customers", payload: { channel: "sms", voicePersona: "service_reminder" }, id: "b", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })
    const unknown = workCase({ actions: [{ actionType: "bulk_notify_existing_customers", payload: { channel: "call", voicePersona: "other" }, id: "c", status: "completed", summary: null, instructionId: null, planId: null, dependsOn: [], createdAt: "", updatedAt: "" }] })

    expect(exactAgentKeysForWork(service)).toContain("service-reminder")
    expect(exactAgentKeysForWork(sms)).not.toContain("service-reminder")
    expect(exactAgentKeysForWork(unknown)).not.toContain("service-reminder")
  })

  it("uses the durable call agent key and exact household edge, never title or time", () => {
    const linked = workCase({
      title: "Payment reminder",
      linkedEntities: [{ entityType: "household", entityId: "household-1", via: "calls(call-1).conversation_id" }],
      calls: [{ id: "call-1", conversationId: "conversation-1", direction: "outbound", externalId: "vapi-1", sourceSystem: "vapi", startedAt: null, endedAt: null, endedReason: "completed", householdId: "household-1", agentKey: "payment-collector" }],
    })
    const decoy = workCase({ title: "Payment reminder", updatedAt: linked.updatedAt })

    expect(exactAgentKeysForWork(linked)).toEqual(["payment-collector"])
    expect(exactAgentKeysForWork(decoy)).not.toContain("payment-collector")
    expect(projectAgentActivity([linked, decoy], "payment-collector").calls.map(({ call }) => call.id)).toEqual(["call-1"])
  })

  it("attributes instruction-rooted Work to JARVIS without claiming provider readiness", () => {
    const instruction = workCase({ root: { kind: "instruction", id: "instruction-1" }, source: { kind: "instruction", id: "instruction-1", channel: "typed" } })
    expect(exactAgentKeysForWork(instruction)).toContain("jarvis")
  })
})
