import type { DemoWorkflowType } from "@/lib/demo/workflows"
import type { HouseholdRecord, NextRevenueAction, QuoteSnapshot } from "@/lib/memory/household"

export type DemoQualification = {
  serviceZip: string
  pricingTier: string
  services: string[]
  householdSize: number
  onWell: boolean
}

export type DemoGenerationStage =
  | "idle"
  | "checking_duplicate"
  | "generating_profile"
  | "ready"
  | "connecting"
  | "live"
  | "ending"
  | "extracting_handoff"
  | "ended"
  | "error"
  | "duplicate_blocked"

export type ConfidenceLevel = "high" | "medium" | "low"
export type MentionState = "yes" | "no" | "unknown"

export type CompanyProfile = {
  workflowType: DemoWorkflowType
  company_name: string
  website: string
  location: string
  phone: string
  services: string[]
  equipment_mentions: string[]
  emergency_service_language: string
  after_hours_language: string
  call_to_action_text: string[]
  emergency_service_mentioned: MentionState
  service_area_mentioned: MentionState
  companySummary: string
  detectedServices: string[]
  dispatchAngle: string
  safeDemoScenario: string
  voicePrompt: string
  techAlertPreview: string
  crmPreview: string
  safe_voice_context: string
  factual_snippets: string[]
  confidence_score: number
  confidence_level: ConfidenceLevel
  warnings: string[]
  fallback_used: boolean
}

export type ScrapedPage = {
  url: string
  status: number
  title: string | null
  text: string
  links: string[]
  callToActionText: string[]
  warnings: string[]
}

export type ScrapeResult = {
  website: string
  pages: ScrapedPage[]
  discoveredUrls: string[]
  extractedSignals: {
    phoneNumbers: string[]
    services: string[]
    equipmentMentions: string[]
    emergencyServiceLines: string[]
    afterHoursLines: string[]
    callToActionText: string[]
    locations: string[]
  }
  warnings: string[]
}

export type DemoProofArtifacts = {
  workflowType: DemoWorkflowType
  intakeSummary: {
    caller: string
    client: string
    concern: string
    safetyRisk: string
    issueType: string
    immediateDanger: string
    callback: string
    status: string
  }
  alertPreview: {
    to: string
    message: string
    timestamp: string
    delivery: string
  }
  crmUpdate: {
    record: string
    fieldsMapped: string[]
    status: string
    priority: string
    issueType: string
    source: string
  }
  dashboardEvent: {
    responseTime: string
    intakeCaptured: string
    followUpNeeded: string
    humanOwner: string
    auditTrail: string
  }
}

export type VoiceDemoProfile = {
  workflowType: DemoWorkflowType
  companyName: string
  websiteUrl: string
  companySummary: string
  detectedServices: string[]
  confirmedServiceArea: string
  confirmedEmergencyAvailability: string
  scrapeStatus: string
  dispatchAngle: string
  safeDemoScenario: string
  voicePrompt: string
  techAlertPreview: string
  crmPreview: string
}

export type GenerateDemoRequest = {
  companyName: string
  websiteUrl: string
  workflowType: DemoWorkflowType
  qualification?: Partial<DemoQualification>
  browserFingerprint?: string
  accountId?: string
}

export type GenerateDemoResponse = {
  profile: CompanyProfile
  voiceProfile: VoiceDemoProfile
  voiceSystemPrompt: string
  demoContext: string
  artifacts: DemoProofArtifacts
  lead_id?: string | null
  quoting?: QuoteSnapshot | null
  household?: HouseholdRecord | null
  household_id?: string | null
  duplicate?: boolean
  duplicateMessage?: string
  calendlyUrl?: string
  qualification?: Partial<DemoQualification>
  scrape: {
    pagesRead: number
    sourceUrls: string[]
    warnings: string[]
  }
}

export type DemoLeadInsert = {
  company_name: string
  website_url: string
  generated_profile: CompanyProfile
  voice_profile: VoiceDemoProfile
  confidence_score: number
  source_path?: string
  notes?: Record<string, unknown> | null
}

export type DemoLeadUpdate = {
  lead_id: string
  call_started?: boolean
  call_ended?: boolean
  status?: string
  vapi_call_id?: string | null
  notes?: Record<string, unknown> | null
}

export type NormalizedTranscriptItem = {
  role: "user" | "assistant"
  text: string
  timestamp: string
}

export type DemoIntakeHandoff = {
  workflowType: DemoWorkflowType
  callerName: string
  facilityName: string
  mainConcern: string
  issueType: string
  equipmentType: string
  immediateDanger: string
  callbackNumber: string
  status: string
  callerIdentity: string
  clientContext: string
  equipmentContext: string
  safetyScreen: string
  followUpPath: string
  leadType: string
  priority: string
  companyName: string
  dispatchAlertText: string
  crmSummary: string
  waterSource: string
  systemInterest: string
  timeline: string
  callbackPreference: string
  wholeHouseOrPartial: string
  sinceWhen: string
  peopleAffected: string
  isPreview?: boolean
  previewReason?: string
  nextAction?: NextRevenueAction | null
  household?: HouseholdRecord | null
  completedFields: Record<
    "callerName" | "facilityName" | "mainConcern" | "issueType" | "immediateDanger" | "callbackNumber",
    boolean
  >
}
