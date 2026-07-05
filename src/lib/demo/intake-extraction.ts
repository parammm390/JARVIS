import type { CompanyProfile, DemoIntakeHandoff, NormalizedTranscriptItem } from "@/lib/demo/types"
import {
  DEFAULT_WORKFLOW_TYPE,
  getWorkflowDefinition,
  type DemoWorkflowType,
} from "@/lib/demo/workflows"

export const NEEDS_CONFIRMATION = "Needs confirmation"
export const NOT_CAPTURED = "Not captured during call"
export const LISTENING_PLACEHOLDER = "Listening..."

type ExtractionInput = {
  transcript: NormalizedTranscriptItem[]
  companyProfile?: Partial<CompanyProfile> | null
  safeDemoScenario?: string
  workflowType?: DemoWorkflowType
}

export function buildLiveIntakeSnapshot(
  transcript: NormalizedTranscriptItem[],
  companyName: string,
  workflowType: DemoWorkflowType
) {
  const extracted = extractIntakeDeterministic({
    transcript,
    companyProfile: { company_name: companyName, workflowType },
    workflowType,
  })

  const hasCallerSpeech = transcript.some((item) => item.role === "user" && item.text.trim())
  return hasCallerSpeech ? extracted : buildEmptyHandoff(companyName, workflowType, LISTENING_PLACEHOLDER)
}

export function buildDemoPreviewHandoff(
  companyName: string,
  safeDemoScenario = "",
  workflowType: DemoWorkflowType = DEFAULT_WORKFLOW_TYPE
): DemoIntakeHandoff {
  if (workflowType === "water_treatment") {
    return normalizeIntake({
      workflowType,
      callerName: "Jennifer",
      facilityName: "142 Millbrook Road, Harrisonburg VA",
      mainConcern: concernFromText(safeDemoScenario, workflowType) || "Sulfur smell and hard water",
      issueType: "Water treatment consultation",
      equipmentType: "Water softener and whole-house filtration",
      immediateDanger: "No",
      callbackNumber: "Captured in demo",
      status: "Ready for CSR follow-up",
      callerIdentity: "Jennifer, homeowner",
      clientContext: "142 Millbrook Road, Harrisonburg VA",
      equipmentContext: "Softener and whole-house filtration interest",
      safetyScreen: "No urgent water loss, leak, flooding, or safety risk reported",
      followUpPath: "Afternoon callback from CSR / sales team",
      leadType: "Water treatment quote or consultation inquiry",
      priority: "Standard follow-up",
      companyName,
      waterSource: "Well water",
      systemInterest: "Water softener and whole-house filtration",
      timeline: "Within the next few weeks",
      callbackPreference: "Afternoon callback",
      isPreview: true,
      previewReason: "Demo handoff preview generated from the selected water treatment scenario",
    })
  }

  return normalizeIntake({
    workflowType,
    callerName: "Sarah",
    facilityName: "142 Millbrook Road, Harrisonburg VA",
    mainConcern:
      concernFromText(safeDemoScenario, workflowType) || "No water - pump failure suspected",
    issueType: "No-water / low-pressure issue",
    equipmentType: equipmentFromText(safeDemoScenario) || "Submersible well pump and pressure tank",
    immediateDanger: "No",
    callbackNumber: "Captured in demo",
    status: "Ready for on-call dispatch",
    callerIdentity: "Sarah, homeowner",
    clientContext: "142 Millbrook Road, Harrisonburg VA",
    equipmentContext: "Submersible well pump and pressure tank; tank showing zero pressure",
    safetyScreen: "No immediate danger reported",
    followUpPath: "On-call dispatch alert",
    leadType: "Well pump / no-water emergency",
    priority: "High priority",
    companyName,
    wholeHouseOrPartial: "Whole house",
    sinceWhen: "Since 11 PM",
    peopleAffected: "Family of 4",
    isPreview: true,
    previewReason: "Demo handoff preview generated from the selected emergency dispatch scenario",
  })
}

export function extractIntakeDeterministic({
  transcript,
  companyProfile,
  safeDemoScenario,
  workflowType,
}: ExtractionInput): DemoIntakeHandoff {
  const selectedWorkflow =
    workflowType || companyProfile?.workflowType || DEFAULT_WORKFLOW_TYPE
  const companyName =
    clean(companyProfile?.company_name) ||
    clean((companyProfile as { companyName?: string } | null | undefined)?.companyName) ||
    "Generated company"
  const callerText = transcript
    .filter((item) => item.role === "user")
    .map((item) => item.text)
    .join(" ")
  const allText = transcript.map((item) => item.text).join(" ")

  if (!callerText.trim() && !allText.trim()) {
    return buildDemoPreviewHandoff(companyName, safeDemoScenario, selectedWorkflow)
  }

  const callerName = matchFirst(callerText, [
    /\bmy name is\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i,
    /\bthis is\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i,
    /\bi(?: am|'m)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/i,
  ])
  const facilityName = addressFromText(callerText)
  const callbackNumber = phoneFromText(callerText)
  const immediateDanger = immediateDangerFromText(allText)

  if (selectedWorkflow === "water_treatment") {
    const waterSource = waterSourceFromText(allText)
    const systemInterest = treatmentInterestFromText(allText)
    const timeline = timelineFromText(allText)
    const callbackPreference = callbackPreferenceFromText(allText)
    const concern = concernFromText(allText, selectedWorkflow)
    return normalizeIntake({
      workflowType: selectedWorkflow,
      callerName,
      facilityName,
      mainConcern: concern,
      issueType: "Water treatment consultation",
      equipmentType: systemInterest,
      immediateDanger,
      callbackNumber,
      status: "Ready for CSR follow-up",
      callerIdentity: callerName ? `${callerName}, caller` : "",
      clientContext: facilityName ? `${facilityName}, service location` : "",
      equipmentContext: systemInterest,
      safetyScreen:
        immediateDanger === "Yes"
          ? "Urgent water loss, leak, flooding, or safety risk mentioned"
          : immediateDanger === "No"
            ? "No urgent water loss, leak, flooding, or safety risk reported"
            : "",
      followUpPath: callbackPreference
        ? `${callbackPreference}; CSR / sales follow-up`
        : "CSR / sales follow-up",
      leadType: "Water treatment quote or consultation inquiry",
      priority: immediateDanger === "Yes" ? "Urgent human review" : "Standard follow-up",
      companyName,
      waterSource,
      systemInterest,
      timeline,
      callbackPreference,
    })
  }

  const concern = concernFromText(allText, selectedWorkflow)
  const wholeHouseOrPartial = scopeFromText(allText)
  const sinceWhen = sinceWhenFromText(allText)
  const peopleAffected = peopleAffectedFromText(allText)
  const equipment = equipmentFromText(allText)
  return normalizeIntake({
    workflowType: selectedWorkflow,
    callerName,
    facilityName,
    mainConcern: concern,
    issueType: concern,
    equipmentType: equipment,
    immediateDanger,
    callbackNumber,
    status: "Ready for on-call dispatch",
    callerIdentity: callerName ? `${callerName}, caller` : "",
    clientContext: facilityName ? `${facilityName}, service address` : "",
    equipmentContext: equipment ? `${equipment} mentioned by caller; verification required` : "",
    safetyScreen:
      immediateDanger === "Yes"
        ? "Immediate safety risk mentioned; emergency direction required"
        : immediateDanger === "No"
          ? "No immediate danger reported"
          : "",
    followUpPath: callbackNumber ? `On-call dispatch can follow up at ${callbackNumber}` : "",
    leadType: "Well pump / no-water emergency",
    priority: immediateDanger === "Yes" ? "Urgent safety review" : "High priority",
    companyName,
    wholeHouseOrPartial,
    sinceWhen,
    peopleAffected,
  })
}

export function normalizeIntake(value: Partial<DemoIntakeHandoff>): DemoIntakeHandoff {
  const workflowType = value.workflowType || DEFAULT_WORKFLOW_TYPE
  const workflow = getWorkflowDefinition(workflowType)
  const companyName = clean(value.companyName) || "Generated company"
  const intake: DemoIntakeHandoff = {
    workflowType,
    callerName: clean(value.callerName) || NEEDS_CONFIRMATION,
    facilityName: clean(value.facilityName) || NEEDS_CONFIRMATION,
    mainConcern: clean(value.mainConcern) || NEEDS_CONFIRMATION,
    issueType: clean(value.issueType) || clean(value.mainConcern) || NEEDS_CONFIRMATION,
    equipmentType: clean(value.equipmentType) || NEEDS_CONFIRMATION,
    immediateDanger: normalizeDanger(value.immediateDanger),
    callbackNumber: clean(value.callbackNumber) || NOT_CAPTURED,
    status: clean(value.status) || workflow.handoffStatus,
    callerIdentity: clean(value.callerIdentity) || clean(value.callerName) || NEEDS_CONFIRMATION,
    clientContext: clean(value.clientContext) || clean(value.facilityName) || NEEDS_CONFIRMATION,
    equipmentContext: clean(value.equipmentContext) || clean(value.equipmentType) || NEEDS_CONFIRMATION,
    safetyScreen: clean(value.safetyScreen) || NEEDS_CONFIRMATION,
    followUpPath: clean(value.followUpPath) || NOT_CAPTURED,
    leadType: clean(value.leadType) || workflow.leadType,
    priority: clean(value.priority) || workflow.priority,
    companyName,
    dispatchAlertText: clean(value.dispatchAlertText),
    crmSummary: clean(value.crmSummary),
    waterSource: clean(value.waterSource) || NEEDS_CONFIRMATION,
    systemInterest: clean(value.systemInterest) || NEEDS_CONFIRMATION,
    timeline: clean(value.timeline) || NEEDS_CONFIRMATION,
    callbackPreference: clean(value.callbackPreference) || NOT_CAPTURED,
    wholeHouseOrPartial: clean(value.wholeHouseOrPartial) || NEEDS_CONFIRMATION,
    sinceWhen: clean(value.sinceWhen) || NEEDS_CONFIRMATION,
    peopleAffected: clean(value.peopleAffected) || NEEDS_CONFIRMATION,
    isPreview: value.isPreview,
    previewReason: clean(value.previewReason),
    completedFields: {
      callerName: Boolean(clean(value.callerName)),
      facilityName: Boolean(clean(value.facilityName)),
      mainConcern: Boolean(clean(value.mainConcern)),
      issueType: Boolean(clean(value.issueType)),
      immediateDanger: Boolean(clean(value.immediateDanger)),
      callbackNumber: Boolean(clean(value.callbackNumber)),
    },
  }

  return withGeneratedCopy(intake)
}

export function withGeneratedCopy(intake: DemoIntakeHandoff): DemoIntakeHandoff {
  if (intake.workflowType === "water_treatment") {
    return {
      ...intake,
      dispatchAlertText:
        clean(intake.dispatchAlertText) ||
        `Water treatment lead captured. ${safeCopy(intake.callerName)} reports ${safeCopy(
          intake.mainConcern
        )}. Water source: ${safeCopy(intake.waterSource)}. System interest: ${safeCopy(
          intake.systemInterest
        )}. Timeline: ${safeCopy(intake.timeline)}. ${safeCopy(intake.status)}.`,
      crmSummary:
        clean(intake.crmSummary) ||
        `Water treatment lead created for ${safeCopy(intake.companyName)}. Follow-up owner: CSR / sales team. Callback preference: ${safeCopy(
          intake.callbackPreference
        )}.`,
    }
  }

  return {
    ...intake,
    dispatchAlertText:
      clean(intake.dispatchAlertText) ||
      `Well pump emergency captured. Issue: ${safeCopy(intake.mainConcern)}. Scope: ${safeCopy(
        intake.wholeHouseOrPartial
      )}. Since: ${safeCopy(intake.sinceWhen)}. People affected: ${safeCopy(
        intake.peopleAffected
      )}. Safety screen: ${safeCopy(intake.safetyScreen)}. Callback: ${safeCopy(
        intake.callbackNumber
      )}.`,
    crmSummary:
      clean(intake.crmSummary) ||
      `Well pump emergency created for ${safeCopy(intake.companyName)}. ${safeCopy(
        intake.callerName
      )} reported ${safeCopy(intake.mainConcern)}. On-call dispatch owns follow-up.`,
  }
}

function buildEmptyHandoff(
  companyName: string,
  workflowType: DemoWorkflowType,
  placeholder: string
): DemoIntakeHandoff {
  return normalizeIntake({
    workflowType,
    callerName: placeholder,
    facilityName: "Waiting for caller",
    mainConcern: "Not captured yet",
    issueType: "Not captured yet",
    equipmentType: "Not captured yet",
    immediateDanger: "Not captured yet",
    callbackNumber: "Not captured yet",
    status: "Call in progress",
    callerIdentity: "Waiting for caller",
    clientContext: "Waiting for caller",
    equipmentContext: "Not captured yet",
    safetyScreen: "Not captured yet",
    followUpPath: "Not captured yet",
    companyName,
  })
}

function matchFirst(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return toTitleCase(match[1].trim())
  }
  return ""
}

function addressFromText(text: string) {
  return matchFirst(text, [
    /\b(?:address is|at|from)\s+(\d{1,6}\s+[a-z0-9][a-z0-9.' -]{2,70}?)(?=\s+(?:has|have|had|is|where|and)\b|[,.]|$)/i,
    /\bservice address(?: is)?\s+([a-z0-9][a-z0-9.' -]{4,80})(?=[,.]|$)/i,
  ])
}

function concernFromText(text: string, workflowType: DemoWorkflowType) {
  const lower = text.toLowerCase()
  if (workflowType === "water_treatment") {
    if (lower.includes("sulfur") || lower.includes("rotten egg")) return "Sulfur smell"
    if (lower.includes("hard water")) return "Hard water"
    if (lower.includes("iron")) return "Iron staining or metallic water concern"
    if (lower.includes("taste") || lower.includes("odor")) return "Water taste or odor concern"
    if (lower.includes("water test")) return "Water testing request"
    return ""
  }
  if (lower.includes("no water")) return "No water / pump issue"
  if (lower.includes("zero pressure")) return "No water / zero pressure"
  if (lower.includes("low pressure")) return "Low-pressure issue"
  if (lower.includes("pressure tank")) return "Pressure tank issue"
  if (lower.includes("pump")) return "Well pump issue"
  return ""
}

function waterSourceFromText(text: string) {
  const lower = text.toLowerCase()
  if (lower.includes("well water") || lower.includes("private well")) return "Well water"
  if (lower.includes("city water") || lower.includes("municipal")) return "City / municipal water"
  return ""
}

function treatmentInterestFromText(text: string) {
  const interests = [
    ["water softener", "Water softener"],
    ["whole-house", "Whole-house filtration"],
    ["whole house", "Whole-house filtration"],
    ["reverse osmosis", "Reverse osmosis"],
    [" ro ", "Reverse osmosis"],
    ["filtration", "Filtration"],
    ["water test", "Water testing"],
  ] as const
  const detected = Array.from(
    new Set(interests.filter(([term]) => ` ${text.toLowerCase()} `.includes(term)).map(([, label]) => label))
  )
  return detected
    .filter((label) => !(label === "Filtration" && detected.includes("Whole-house filtration")))
    .join(", ")
}

function timelineFromText(text: string) {
  const match = text.match(
    /\b(today|tomorrow|this week|next week|within (?:the )?next few weeks|this month|next month|as soon as possible|soon)\b/i
  )
  return match?.[1] ? sentenceCase(match[1]) : ""
}

function callbackPreferenceFromText(text: string) {
  const match = text.match(/\b(morning|afternoon|evening|after \d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/i)
  return match?.[1] ? `${toTitleCase(match[1])} callback` : ""
}

function scopeFromText(text: string) {
  const lower = text.toLowerCase()
  if (/\b(whole house|entire house|every faucet|all faucets|everywhere)\b/.test(lower)) return "Whole house"
  if (/\b(one faucet|one bathroom|part of the house|partial|only upstairs|only downstairs)\b/.test(lower)) {
    return "Partial"
  }
  return ""
}

function sinceWhenFromText(text: string) {
  const match = text.match(/\b(?:since|started|beginning)\s+([^,.]{2,32})/i)
  return match?.[1] ? trimSentence(match[1]) : ""
}

function peopleAffectedFromText(text: string) {
  const match = text.match(
    /\b(?:family|household|there are)\s+(?:of\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
  )
  if (!match?.[1]) return ""
  const numberWords: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
  }
  const count = numberWords[match[1].toLowerCase()] || match[1]
  return `${count} people`
}

function equipmentFromText(text: string) {
  const match = text.match(
    /\b(submersible well pump|submersible pump|jet pump|well pump|pressure tank|pressure switch|bladder tank|water line)\b/i
  )
  return match?.[1] ? toTitleCase(match[1]) : ""
}

function immediateDangerFromText(text: string) {
  const lower = text.toLowerCase()
  if (/\b(no immediate danger|no danger|no safety risk|not in immediate danger)\b/.test(lower)) return "No"
  if (/\b(flooding|active leak|electrical hazard|fire|injury|safety risk|immediate danger)\b/.test(lower)) {
    return "Yes"
  }
  return ""
}

function phoneFromText(text: string) {
  const match = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)
  return match?.[0]?.trim() || ""
}

function normalizeDanger(value: unknown) {
  const text = clean(value)
  if (!text) return NEEDS_CONFIRMATION
  if (/^(no|none|false)$/i.test(text)) return "No"
  if (/^(yes|true)$/i.test(text)) return "Yes"
  return text
}

function safeCopy(value: string) {
  return value || NEEDS_CONFIRMATION
}

function clean(value: unknown) {
  if (typeof value !== "string") return ""
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed || /^unknown$/i.test(trimmed) || /^n\/a$/i.test(trimmed)) return ""
  return trimmed
}

function trimSentence(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/\s+(?:and|but)\s+.*$/i, "")
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

function sentenceCase(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : ""
}
