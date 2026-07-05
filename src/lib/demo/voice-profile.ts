import type { CompanyProfile, VoiceDemoProfile } from "@/lib/demo/types"
import { buildVoiceSystemPrompt } from "@/lib/llm/prompt-builder"
import { getWorkflowDefinition } from "@/lib/demo/workflows"

export const REQUIRED_VAPI_VARIABLE_KEYS = [
  "company_name",
  "workflow_type",
  "workflow_label",
  "website_url",
  "scrape_status",
  "confirmed_equipment",
  "confirmed_service_areas",
  "confirmed_emergency_availability",
  "unknowns",
  "handoff_target",
  "voice_prompt",
] as const

export type RequiredVapiVariableKey = (typeof REQUIRED_VAPI_VARIABLE_KEYS)[number]
export type VapiVariableValues = Record<RequiredVapiVariableKey, string> & Record<string, string>

export function toVoiceDemoProfile(profile: CompanyProfile): VoiceDemoProfile {
  return {
    workflowType: profile.workflowType,
    companyName: profile.company_name,
    websiteUrl: profile.website,
    companySummary: profile.companySummary || "unknown",
    detectedServices: profile.detectedServices.length ? profile.detectedServices : ["unknown"],
    confirmedServiceArea:
      profile.service_area_mentioned === "yes" && profile.location !== "unknown"
        ? profile.location
        : "unknown",
    confirmedEmergencyAvailability:
      profile.emergency_service_mentioned === "yes"
        ? profile.emergency_service_language || "Emergency service mentioned on public website"
        : "unknown",
    scrapeStatus: profile.fallback_used ? "fallback" : "success",
    dispatchAngle: profile.dispatchAngle || "unknown",
    safeDemoScenario: profile.safeDemoScenario || "unknown",
    voicePrompt: buildVoiceSystemPrompt(profile),
    techAlertPreview: profile.techAlertPreview || "unknown",
    crmPreview: profile.crmPreview || "unknown",
  }
}

export function toVapiVariableValues(voiceProfile: VoiceDemoProfile): VapiVariableValues {
  const workflow = getWorkflowDefinition(voiceProfile.workflowType)
  const companyName = cleanVariable(voiceProfile.companyName)
  const websiteUrl = cleanVariable(voiceProfile.websiteUrl)
  const companySummary = cleanVariable(voiceProfile.companySummary)
  const detectedServices = cleanVariable(
    voiceProfile.detectedServices.length ? voiceProfile.detectedServices.join(", ") : "unknown"
  )
  const dispatchAngle = cleanVariable(voiceProfile.dispatchAngle)
  const safeDemoScenario = cleanVariable(voiceProfile.safeDemoScenario)
  const voicePrompt = cleanVariable(voiceProfile.voicePrompt, 6000)
  const techAlertPreview = cleanVariable(voiceProfile.techAlertPreview)
  const crmPreview = cleanVariable(voiceProfile.crmPreview)
  const unknowns = inferUnknowns(voiceProfile)

  return {
    company_name: companyName,
    workflow_type: voiceProfile.workflowType,
    workflow_label: workflow.label,
    website_url: websiteUrl,
    scrape_status: cleanVariable(voiceProfile.scrapeStatus) || "fallback",
    confirmed_equipment: detectedServices,
    confirmed_service_areas: cleanVariable(voiceProfile.confirmedServiceArea) || "unknown",
    confirmed_emergency_availability:
      cleanVariable(voiceProfile.confirmedEmergencyAvailability) || "unknown",
    unknowns,
    handoff_target: workflow.handoffTarget,
    voice_prompt: voicePrompt,
    emergency_call_scenario: safeDemoScenario,
    tech_alert_summary: techAlertPreview,
    crm_handoff_summary: crmPreview,

    // Keep the original variables for assistants created before the well-service migration.
    companyName,
    websiteUrl,
    companySummary,
    detectedServices,
    dispatchAngle,
    safeDemoScenario,
    voicePrompt,
    techAlertPreview,
    crmPreview,
  }
}

export function missingVapiVariableKeys(values: Partial<Record<RequiredVapiVariableKey, string>>) {
  return REQUIRED_VAPI_VARIABLE_KEYS.filter((key) => !cleanVariable(values[key]).length)
}

function cleanVariable(value: unknown, maxLength = 1400) {
  if (Array.isArray(value)) return cleanVariable(value.join(", "), maxLength)
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : ""
}

function inferUnknowns(voiceProfile: VoiceDemoProfile) {
  const unknowns: string[] = []
  if (!voiceProfile.detectedServices.length || voiceProfile.detectedServices.includes("unknown")) {
    unknowns.push("confirmed_equipment")
  }
  if (voiceProfile.confirmedServiceArea === "unknown") unknowns.push("confirmed_service_areas")
  if (voiceProfile.confirmedEmergencyAvailability === "unknown") {
    unknowns.push("confirmed_emergency_availability")
  }
  unknowns.push("confirmed_brands", "confirmed_hours")
  return unknowns.join(", ")
}
