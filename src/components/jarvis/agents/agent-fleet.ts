import type { ProviderHealth, VoiceAssistantHealth } from "../lib/data-core"
import type { WorkCaseProjection, WorkCall } from "@/lib/jarvis-client"

export type AgentKey = "jarvis" | "follow-up" | "service-reminder" | "win-back" | "payment-collector"

export interface AgentDefinition {
  key: AgentKey
  label: string
  shortLabel: string
  personaKey: "main" | "install_followup" | "service_reminder" | "winback" | "payment_collector"
  roleCopy: string
  authorityCopy: string
  glyph: "orb" | "follow-up" | "service-reminder" | "win-back" | "payment-collector"
}

export const AGENT_ACTIVITY_UNAVAILABLE = "No exact agent activity is exposed yet."

export const AGENT_FLEET = [
  {
    key: "jarvis",
    label: "JARVIS",
    shortLabel: "JARVIS",
    personaKey: "main",
    roleCopy: "Understands your instruction, plans against the business, asks when uncertain, and routes consequential actions through approval.",
    authorityCopy: "Consequential actions route through the existing approval boundary.",
    glyph: "orb",
  },
  {
    key: "follow-up",
    label: "Follow-up",
    shortLabel: "Follow-up",
    personaKey: "install_followup",
    roleCopy: "Checks in after a new installation or major service visit, captures satisfaction, and can gently ask for a review.",
    authorityCopy: "Calls only from approved or scheduled work under tenant policy.",
    glyph: "follow-up",
  },
  {
    key: "service-reminder",
    label: "Service Reminder",
    shortLabel: "Service",
    personaKey: "service_reminder",
    roleCopy: "Contacts customers whose treatment equipment is due or coming due for filter, membrane, or service work.",
    authorityCopy: "Calls only from approved or scheduled work under tenant policy.",
    glyph: "service-reminder",
  },
  {
    key: "win-back",
    label: "Win-back",
    shortLabel: "Win-back",
    personaKey: "winback",
    roleCopy: "Reconnects with past customers who have gone quiet and can present an approved win-back offer.",
    authorityCopy: "Calls only from approved or scheduled work under tenant policy.",
    glyph: "win-back",
  },
  {
    key: "payment-collector",
    label: "Payment Collector",
    shortLabel: "Collector",
    personaKey: "payment_collector",
    roleCopy: "Gives a friendly heads-up about overdue invoices using the collection context a human approved.",
    authorityCopy: "Requires human-approved collection context before outreach.",
    glyph: "payment-collector",
  },
] as const satisfies readonly AgentDefinition[]

export function agentDefinition(key: AgentKey): AgentDefinition {
  return AGENT_FLEET.find((agent) => agent.key === key) ?? AGENT_FLEET[0]
}

const PAYMENT_COLLECTOR_ACTION_TYPES = ["send_payment_reminder", "call_overdue_invoices"] as const

function payloadString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Returns only agent edges that are present in an authoritative Work/action/call
 * record. JARVIS owns instruction-rooted work; the bounded outbound agents are
 * attached by their validated action family/persona or by the durable call envelope.
 * There is deliberately no customer, timestamp, title, or provider-name fallback.
 */
export function exactAgentKeysForWork(workCase: WorkCaseProjection): AgentKey[] {
  const keys = new Set<AgentKey>()
  if (workCase.root.kind === "instruction" || workCase.source.kind === "instruction") keys.add("jarvis")

  for (const action of workCase.actions) {
    if (PAYMENT_COLLECTOR_ACTION_TYPES.includes(action.actionType as (typeof PAYMENT_COLLECTOR_ACTION_TYPES)[number])) {
      if (action.actionType === "call_overdue_invoices" || action.payload.channel === "call") keys.add("payment-collector")
    }
    if (action.actionType === "bulk_notify_existing_customers" && action.payload.channel === "call") {
      const persona = payloadString(action.payload.voicePersona)
      if (persona === "install_followup") keys.add("follow-up")
      if (persona === "service_reminder") keys.add("service-reminder")
      if (persona === "winback") keys.add("win-back")
    }
  }

  for (const call of workCase.calls) {
    if (call.agentKey) keys.add(call.agentKey)
  }
  return AGENT_FLEET.map((agent) => agent.key).filter((key) => keys.has(key))
}

export interface AgentFleetCallActivity {
  workCase: WorkCaseProjection
  call: WorkCall
}

export interface AgentFleetActivity {
  workCases: WorkCaseProjection[]
  calls: AgentFleetCallActivity[]
  exceptions: WorkCaseProjection[]
}

export function projectAgentActivity(workCases: WorkCaseProjection[], key: AgentKey): AgentFleetActivity {
  const matchingWorkCases = workCases.filter((workCase) => exactAgentKeysForWork(workCase).includes(key))
  const calls = matchingWorkCases.flatMap((workCase) =>
    workCase.calls
      .filter((call) => call.agentKey === key)
      .map((call) => ({ workCase, call })),
  )
  const exceptions = matchingWorkCases.filter((workCase) => workCase.status === "Failed" || workCase.status === "Blocked")
  return { workCases: matchingWorkCases, calls, exceptions }
}

export type ProviderStatusTone = "verified" | "unconfigured" | "unavailable"

export interface ProviderStatusCopy {
  label: string
  detail: string
  tone: ProviderStatusTone
}

export function assistantStatusCopy(assistant: VoiceAssistantHealth | null | undefined): ProviderStatusCopy {
  if (!assistant) return { label: "Assistant status unavailable", detail: "No assistant-specific configuration result was returned.", tone: "unavailable" }
  if (!assistant.configured) return { label: "Assistant not configured", detail: "No provider assistant is bound to this channel.", tone: "unconfigured" }
  if (assistant.healthy === true) return { label: "Assistant configuration verified", detail: "The configured provider assistant exists and is readable by the active Vapi account.", tone: "verified" }
  if (assistant.healthy === false) return { label: "Assistant configuration unavailable", detail: assistant.error ?? "The configured provider assistant could not be verified.", tone: "unavailable" }
  return { label: "Assistant configured · verification unavailable", detail: assistant.note ?? "The binding exists, but the provider could not verify it.", tone: "unavailable" }
}

/**
 * Vapi's integration endpoint only proves provider-level configuration/health. It
 * must never be promoted into a per-agent Ready state.
 */
export function providerStatusCopy(provider: ProviderHealth | null | undefined): ProviderStatusCopy {
  if (!provider) {
    return {
      label: "Vapi provider status unavailable",
      detail: "The provider-level integration result is not available to this surface.",
      tone: "unavailable",
    }
  }
  if (!provider.configured) {
    return {
      label: "Vapi provider not configured",
      detail: "The integration source reports no configured Vapi provider.",
      tone: "unconfigured",
    }
  }
  if (provider.healthy === true) {
    return {
      label: "Vapi provider connection verified",
      detail: "This is a provider-level result; it does not assert assistant readiness.",
      tone: "verified",
    }
  }
  if (provider.healthy === false) {
    return {
      label: "Vapi provider connection unavailable",
      detail: "The provider-level integration check did not verify a connection.",
      tone: "unavailable",
    }
  }
  return {
    label: "Vapi provider health unavailable",
    detail: "The provider is configured, but no authoritative health result is exposed.",
    tone: "unavailable",
  }
}
