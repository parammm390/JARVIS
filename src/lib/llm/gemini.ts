import type { CompanyProfile, MentionState, ScrapeResult, VoiceDemoProfile } from "@/lib/demo/types"
import type { DemoWorkflowType } from "@/lib/demo/workflows"
import { getWorkflowDefinition } from "@/lib/demo/workflows"
import { isDemoMockMode, serverEnv } from "@/lib/env"
import { groqConfigured, groqGenerateJson } from "@/lib/llm/groq"
import { readablePagesFrom } from "@/lib/scrape/scrape-site"

const EQUIPMENT_TERMS = [
  "Water softener",
  "Water filter",
  "Whole-house filter",
  "Whole house filter",
  "Reverse osmosis",
  "RO system",
  "Drinking water system",
  "Iron filter",
  "Sulfur filter",
  "Well pump",
  "Submersible pump",
  "Jet pump",
  "Pressure tank",
  "Pressure switch",
  "Bladder tank",
  "Water line",
]

const SERVICE_TERMS = [
  "Water treatment",
  "Water softener",
  "Water softeners",
  "Water filtration",
  "Whole-house filtration",
  "Whole house filtration",
  "Reverse osmosis",
  "RO system",
  "Drinking water system",
  "Water testing",
  "Water test",
  "Free water analysis",
  "Hard water treatment",
  "Iron filtration",
  "Sulfur odor treatment",
  "Emergency service",
  "Well pump repair",
  "Water well service",
  "Pressure tank replacement",
  "Submersible pump repair",
  "Jet pump repair",
  "Pressure switch repair",
  "Water line repair",
  "Well drilling",
]

const STATE_PATTERN =
  /\b[A-Z][a-zA-Z .'-]+,\s?(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>
  }
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
}

const GEMINI_TIMEOUT_MS = 34_000
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
]
const COMPANY_PROFILE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    location: { type: "STRING" },
    phone: { type: "STRING" },
    services: { type: "ARRAY", items: { type: "STRING" } },
    equipment_mentions: { type: "ARRAY", items: { type: "STRING" } },
    emergency_service_language: { type: "STRING" },
    after_hours_language: { type: "STRING" },
    call_to_action_text: { type: "ARRAY", items: { type: "STRING" } },
    emergency_service_mentioned: { type: "STRING" },
    service_area_mentioned: { type: "STRING" },
    companySummary: { type: "STRING" },
    detectedServices: { type: "ARRAY", items: { type: "STRING" } },
    dispatchAngle: { type: "STRING" },
    safeDemoScenario: { type: "STRING" },
    voicePrompt: { type: "STRING" },
    techAlertPreview: { type: "STRING" },
    crmPreview: { type: "STRING" },
    factual_snippets: { type: "ARRAY", items: { type: "STRING" } },
    confidence_score: { type: "NUMBER" },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
}

export async function buildGeminiCompanyProfile(
  companyName: string,
  scrape: ScrapeResult,
  workflowType: DemoWorkflowType
): Promise<CompanyProfile> {
  const fallback = buildFallbackProfile(companyName, scrape, workflowType)
  const apiKey = serverEnv.geminiApiKey

  if (isDemoMockMode()) {
    return {
      ...fallback,
      warnings: uniqueStrings([...fallback.warnings, "Mock mode is enabled."]),
      fallback_used: true,
    }
  }

  if (groqConfigured()) {
    try {
      const parsed = (await groqGenerateJson({
        prompt: buildGeminiPrompt(companyName, scrape, workflowType),
        maxTokens: 4096,
        temperature: 0.05,
        timeoutMs: GEMINI_TIMEOUT_MS,
      })) as Partial<CompanyProfile & VoiceDemoProfile>
      return normalizeGeminiProfile(parsed, fallback)
    } catch {
      // Fall through to Gemini, then the conservative fallback profile.
    }
  }

  if (!apiKey) {
    return {
      ...fallback,
      warnings: uniqueStrings([
        ...fallback.warnings,
        "No LLM provider is configured, so conservative fallback extraction was used.",
      ]),
      fallback_used: true,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const payload = await generateGeminiContent({
      apiKey,
      signal: controller.signal,
      body: {
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: COMPANY_PROFILE_RESPONSE_SCHEMA,
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildGeminiPrompt(companyName, scrape, workflowType),
              },
            ],
          },
        ],
      },
    })
    const rawText =
      payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || ""

    const parsed = parseGeminiJson(rawText) as Partial<CompanyProfile & VoiceDemoProfile>
    return normalizeGeminiProfile(parsed, fallback)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini profile extraction failed."
    return {
      ...fallback,
      warnings: uniqueStrings([
        ...fallback.warnings,
        message,
        "Conservative fallback profile was used.",
      ]),
      fallback_used: true,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function generateGeminiContent({
  apiKey,
  signal,
  body,
}: {
  apiKey: string
  signal: AbortSignal
  body: Record<string, unknown>
}) {
  const models = uniqueStrings([serverEnv.geminiModel, ...FALLBACK_GEMINI_MODELS])
  const failures: string[] = []

  for (const modelName of models) {
    const model = encodeURIComponent(modelName)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    )

    if (response.ok) {
      return (await response.json()) as GeminiResponse
    }

    failures.push(`${modelName}:${response.status}`)
    if (![429, 500, 502, 503, 504, 404].includes(response.status)) {
      break
    }
  }

  throw new Error(`Gemini profile request failed (${failures.join(", ")}).`)
}

export function buildFallbackProfile(
  companyName: string,
  scrape: ScrapeResult,
  workflowType: DemoWorkflowType
): CompanyProfile {
  const workflow = getWorkflowDefinition(workflowType)
  const readablePages = readablePagesFrom(scrape.pages)
  const allText = readablePages.map((page) => page.text).join("\n")
  const lines = allText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 35)

  const services = collectTermEvidence(lines, SERVICE_TERMS)
  const issueType = collectTermEvidence(lines, EQUIPMENT_TERMS)
  const jobLines = uniqueStrings([
    ...scrape.extractedSignals.emergencyServiceLines,
    ...collectLines(lines, workflowType === "water_treatment"
      ? [
          "water treatment",
          "water softener",
          "filtration",
          "reverse osmosis",
          "water test",
          "water testing",
          "hard water",
          "sulfur",
          "iron",
          "quote",
          "book",
          "schedule",
          "appointment",
          "call",
        ]
      : ["emergency", "after hours", "dispatch", "repair", "request service", "call"]),
  ])
  const afterHoursLines = uniqueStrings([
    ...scrape.extractedSignals.afterHoursLines,
    ...collectLines(lines, ["24/7", "24 hours", "after hours"]),
  ])
  const emergencyServiceMentioned = textMentionState(allText, "emergency service")
  const serviceAreaMentioned = textMentionState(allText, "service area|areas served|serving")
  const knownFields = [
    findPhone(allText),
    findLocationCandidate(lines),
    services.length ? "services" : "",
    issueType.length ? "equipment" : "",
    jobLines.length ? "dispatch" : "",
  ].filter(Boolean).length
  const confidence = Math.min(82, Math.max(24, readablePages.length * 12 + knownFields * 10))
  const summaryLine = bestSummaryLine(lines, workflowType)
  const safeVoiceContext = buildSafeVoiceContext({
    companyName,
    services,
    issueType,
    emergencyServiceMentioned,
    serviceAreaMentioned,
    workflowType,
  })

  return {
    workflowType,
    company_name: companyName.trim(),
    website: scrape.website,
    location: findLocationCandidate(lines) || scrape.extractedSignals.locations[0] || "unknown",
    phone: findPhone(allText) || scrape.extractedSignals.phoneNumbers[0] || "unknown",
    services: uniqueStrings([...scrape.extractedSignals.services, ...services]),
    equipment_mentions: uniqueStrings([...scrape.extractedSignals.equipmentMentions, ...issueType]),
    emergency_service_language: jobLines[0] || "unknown",
    after_hours_language: afterHoursLines[0] || "unknown",
    call_to_action_text: scrape.extractedSignals.callToActionText,
    emergency_service_mentioned: emergencyServiceMentioned,
    service_area_mentioned: serviceAreaMentioned,
    companySummary:
      summaryLine || jobLines[0] || `${companyName.trim()} public website profile prepared with unknown fields preserved.`,
    detectedServices: uniqueStrings([...scrape.extractedSignals.services, ...services]),
    dispatchAngle:
      workflowType === "water_treatment"
        ? "Capture quote, water test, and treatment system inquiries and prepare a structured CSR or sales follow-up."
        : "Capture no-water, low-pressure, pump, and pressure tank calls and prepare an on-call technician handoff.",
    safeDemoScenario:
      workflowType === "water_treatment"
        ? "Jennifer calls about sulfur smell and hard water at her home. She is on well water and wants to discuss a water softener and whole-house filtration options within the next few weeks."
        : "At 2:13 AM, Sarah calls from 142 Millbrook Road in Harrisonburg, Virginia because her family of 4 has had no water since 11pm. The submersible well pump stopped working around midnight and the pressure tank reads zero.",
    voicePrompt: safeVoiceContext,
    techAlertPreview:
      workflowType === "water_treatment"
        ? "Water treatment lead captured. Well water with sulfur smell and hard water. Interested in softener and whole-house filtration. Timeline and callback preference captured. Ready for CSR follow-up."
        : "No-water emergency at 142 Millbrook Rd. Submersible pump suspected failure. Pressure tank reading zero. Family of 4 without water since 11pm. Callback captured. Ready for on-call dispatch.",
    crmPreview:
      workflowType === "water_treatment"
        ? "Water treatment lead with water source, concern, system interest, timeline, and CSR follow-up owner."
        : "Well pump emergency with issue scope, start time, people affected, safety screen, and on-call dispatch required.",
    safe_voice_context: safeVoiceContext,
    factual_snippets: uniqueStrings([
      ...jobLines.slice(0, 3),
      ...collectLines(lines, [
        "water treatment",
        "water softener",
        "filtration",
        "reverse osmosis",
        "water testing",
        "well pump",
        "water well",
        "pressure tank",
        "emergency service",
        "service area",
      ]).slice(0, 4),
    ]).slice(0, 7),
    confidence_score: Math.round(confidence),
    confidence_level: confidenceLevel(confidence),
    warnings: uniqueStrings([
      ...scrape.warnings,
      ...(readablePages.length < 2 ? ["Limited readable website content was available."] : []),
      ...(issueType.length
        ? ["Equipment mentions are treated as mentions only, not acceptance claims."]
        : ["Supported equipment is unknown from available website text."]),
    ]).slice(0, 8),
    fallback_used: readablePages.length < 2,
  }
}

function buildGeminiPrompt(
  companyName: string,
  scrape: ScrapeResult,
  workflowType: DemoWorkflowType
) {
  const workflow = getWorkflowDefinition(workflowType)
  return [
    `Convert these company website excerpts into strict JSON for a FINNOR ${workflow.label} demo.`,
    `The selected workflow is ${workflowType}. It must control all routing, urgency, and handoff copy.`,
    "Return only valid compact JSON with this shape. Use unknown or [] for unverified fields:",
    JSON.stringify(
      {
        location: "unknown",
        phone: "unknown",
        services: [],
        equipment_mentions: [],
        emergency_service_language: "",
        after_hours_language: "unknown",
        call_to_action_text: [],
        emergency_service_mentioned: "unknown",
        service_area_mentioned: "unknown",
        companySummary: "",
        detectedServices: [],
        dispatchAngle: "",
        voicePrompt: "",
        techAlertPreview: "",
        crmPreview: "",
        factual_snippets: [],
        confidence_score: 0,
        warnings: [],
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Do not invent supported equipment.",
    "- Do not invent emergency availability.",
    "- Do not invent service areas.",
    "- Do not invent services.",
    "- Do not invent locations.",
    "- Unknown is better than fake.",
    "- Use yes/no/unknown for emergency_service_mentioned and service_area_mentioned.",
    "- factual_snippets must only contain short text directly supported by the supplied excerpts.",
    "- confidence_score must reflect how much useful public website context was actually found.",
    `- voicePrompt must instruct Sarah to run only the ${workflow.label} workflow and avoid repair advice, quotes, unsupported claims, or promises.`,
    workflowType === "water_treatment"
      ? "- Use quote request, water test, water source, concern, softener/filtration/RO/whole-house interest, timeline, callback preference, and CSR/sales follow-up language. Avoid emergency dispatch language unless the caller reports no usable water, flooding, an active leak, or a safety risk."
      : "- Use no-water/low-pressure/pump/pressure tank, whole-house or partial, since when, address, callback number, people affected, safety risk, equipment context, and on-call dispatch language. Avoid sales quote, softener, RO, filtration, and CSR/sales language.",
    "- companySummary, dispatchAngle, safeDemoScenario, techAlertPreview, and crmPreview must be conservative and operational.",
    "- Equipment mentions are mentions only unless explicit acceptance is directly stated.",
    "- Keep every string under 500 characters.",
    "- Keep arrays to 8 items or fewer.",
    "- Return compact JSON only. Do not include markdown, comments, explanations, or trailing text.",
    "",
    JSON.stringify({
      requested_company_name: companyName,
      website: scrape.website,
      scrape_warnings: scrape.warnings,
      extracted_signals: scrape.extractedSignals,
      scraped_pages: readablePagesFrom(scrape.pages)
        .slice(0, 8)
        .map((page) => ({
          url: page.url,
          title: page.title,
          text_excerpt: page.text.slice(0, 7000),
        })),
    }),
  ].join("\n")
}

function normalizeGeminiProfile(
  parsed: Partial<CompanyProfile & VoiceDemoProfile>,
  fallback: CompanyProfile
): CompanyProfile {
  const score = clampConfidence(Math.max(
    Number(parsed.confidence_score ?? 0),
    fallback.confidence_score
  ))
  const services = sanitizeArray(parsed.services || parsed.detectedServices, fallback.services)
  const detectedServices = sanitizeArray(parsed.detectedServices, services)
  const issueType = sanitizeArray(parsed.equipment_mentions, fallback.equipment_mentions)
  const emergencyServiceMentioned = sanitizeMentionState(parsed.emergency_service_mentioned, fallback.emergency_service_mentioned)
  const serviceAreaMentioned = sanitizeMentionState(
    parsed.service_area_mentioned,
    fallback.service_area_mentioned
  )

    const profile = {
    workflowType: fallback.workflowType,
    company_name: sanitizeString(parsed.company_name || parsed.companyName) || fallback.company_name,
    website: sanitizeString(parsed.website || parsed.websiteUrl) || fallback.website,
    location: sanitizeUnknownString(parsed.location) || fallback.location,
    phone: sanitizeUnknownString(parsed.phone) || fallback.phone,
    services,
    equipment_mentions: issueType,
    emergency_service_language:
      sanitizeString(parsed.emergency_service_language) || fallback.emergency_service_language,
    after_hours_language:
      sanitizeUnknownString(parsed.after_hours_language) || fallback.after_hours_language,
    call_to_action_text: sanitizeArray(parsed.call_to_action_text, fallback.call_to_action_text),
    emergency_service_mentioned: emergencyServiceMentioned,
    service_area_mentioned: serviceAreaMentioned,
    companySummary: sanitizeString(parsed.companySummary, 650) || fallback.companySummary,
    detectedServices,
    dispatchAngle: sanitizeString(parsed.dispatchAngle, 500) || fallback.dispatchAngle,
    safeDemoScenario: fallback.safeDemoScenario,
    voicePrompt: sanitizeString(parsed.voicePrompt, 1200) || fallback.voicePrompt,
    techAlertPreview:
      sanitizeString(parsed.techAlertPreview, 700) || fallback.techAlertPreview,
    crmPreview: sanitizeString(parsed.crmPreview, 700) || fallback.crmPreview,
    safe_voice_context: sanitizeString(parsed.safe_voice_context, 900),
    factual_snippets: fallback.factual_snippets,
    confidence_score: score,
    confidence_level: confidenceLevel(score),
    warnings: uniqueStrings([
      ...sanitizeArray(parsed.warnings, []),
      ...fallback.warnings,
    ]).slice(0, 8),
    fallback_used: score < 45,
  }

  return {
    ...profile,
    safe_voice_context:
      profile.safe_voice_context ||
      buildSafeVoiceContext({
        companyName: profile.company_name,
        services,
        issueType,
        emergencyServiceMentioned,
        serviceAreaMentioned,
        workflowType: profile.workflowType,
      }),
  }
}

function parseGeminiJson(value: string) {
  const cleaned = stripJsonFences(value)
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error("Gemini response was not valid JSON.")
  }
}

function stripJsonFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
}

function collectTermEvidence(lines: string[], terms: string[]) {
  const found = new Set<string>()
  const lowerText = lines.join("\n").toLowerCase()

  for (const term of terms) {
    if (lowerText.includes(term.toLowerCase())) found.add(term)
  }

  return Array.from(found).slice(0, 10)
}

function collectLines(lines: string[], terms: string[]) {
  return uniqueStrings(
    lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term))).map(trimSnippet)
  ).slice(0, 8)
}

function bestSummaryLine(lines: string[], workflowType: DemoWorkflowType) {
  const terms =
    workflowType === "water_treatment"
      ? [
          "water treatment",
          "water softener",
          "water filtration",
          "reverse osmosis",
          "water testing",
          "hard water",
          "whole-house",
          "whole house",
        ]
      : [
          "well pump",
          "water well",
          "pressure tank",
          "emergency service",
          "no water",
          "low pressure",
          "after hours",
        ]

  return (
    lines
      .map((line) => ({
        line,
        score: terms.reduce(
          (score, term) => score + (line.toLowerCase().includes(term) ? 1 : 0),
          0
        ),
      }))
      .filter((item) => item.score > 0 && isUsableSummaryLine(item.line))
      .sort((a, b) => b.score - a.score || a.line.length - b.line.length)[0]?.line || ""
  )
}

function isUsableSummaryLine(line: string) {
  const normalized = line.trim()
  if (!normalized) return false
  if (normalized.endsWith("?")) return false
  if (/^\d{1,2}\s+/.test(normalized)) return false
  if (/^(faq|does|can|what|how|why|when|where|is|are)\b/i.test(normalized)) return false
  return normalized.length >= 45
}

function findPhone(text: string) {
  const match = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)
  return match ? match[0].trim() : null
}

function findLocationCandidate(lines: string[]) {
  const line = lines.find((candidate) => STATE_PATTERN.test(candidate) && /\d{5}/.test(candidate))
  if (!line) {
    const cityState = lines.find((candidate) => STATE_PATTERN.test(candidate))
    return cityState ? trimSnippet(cityState, 120) : null
  }
  return trimSnippet(line, 120)
}

function textMentionState(text: string, term: string): MentionState {
  if (!text.trim()) return "unknown"
  const terms = term.split("|").map((item) => item.trim().toLowerCase()).filter(Boolean)
  return terms.some((item) => text.toLowerCase().includes(item)) ? "yes" : "unknown"
}

function sanitizeArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  return uniqueStrings(value.map((item) => sanitizeString(item)).filter(Boolean)).slice(0, 12)
}

function sanitizeString(value: unknown, length = 260) {
  return typeof value === "string" ? trimSnippet(value, length) : ""
}

function sanitizeUnknownString(value: unknown) {
  const sanitized = sanitizeString(value)
  return sanitized || "unknown"
}

function sanitizeMentionState(value: unknown, fallback: MentionState): MentionState {
  return value === "yes" || value === "no" || value === "unknown" ? value : fallback
}

function trimSnippet(value: string, length = 220) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1).trim()}...` : normalized
}

function buildSafeVoiceContext({
  companyName,
  services,
  issueType,
  emergencyServiceMentioned,
  serviceAreaMentioned,
  workflowType,
}: {
  companyName: string
  services: string[]
  issueType: string[]
  emergencyServiceMentioned: MentionState
  serviceAreaMentioned: MentionState
  workflowType: DemoWorkflowType
}) {
  const workflowInstruction =
    workflowType === "water_treatment"
      ? "Collect caller, callback, address or service area, water source, water concern, system interest, timeline, and callback preference. Hand off to the CSR or sales team."
      : "Collect caller, callback, service address, no-water or low-pressure issue, whole-house or partial scope, when it started, people affected, safety risk, and known equipment context. Hand off to the on-call team."

  return [
    `Company: ${companyName}.`,
    services.length
      ? `Website-mentioned services: ${services.join(", ")}.`
      : "Website-mentioned services: unknown.",
    issueType.length
      ? `Website-mentioned equipment: ${issueType.join(", ")}. Do not invent repair capabilities.`
      : "Website-mentioned equipment: unknown.",
    `Emergency service mentioned: ${emergencyServiceMentioned}.`,
    `Service area mentioned: ${serviceAreaMentioned}.`,
    workflowInstruction,
  ].join(" ")
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function clampConfidence(value: number) {
  const numeric = Number(value)
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? Math.round(numeric) : 35))
}

function confidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 72) return "high"
  if (score >= 45) return "medium"
  return "low"
}
