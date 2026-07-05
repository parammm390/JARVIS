import { NextResponse } from "next/server"
import type { CompanyProfile, DemoIntakeHandoff, NormalizedTranscriptItem } from "@/lib/demo/types"
import {
  buildDemoPreviewHandoff,
  extractIntakeDeterministic,
  normalizeIntake,
} from "@/lib/demo/intake-extraction"
import { isDemoMockMode, serverEnv } from "@/lib/env"
import { ApiRequestError, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import {
  DEFAULT_WORKFLOW_TYPE,
  getWorkflowDefinition,
  isDemoWorkflowType,
  type DemoWorkflowType,
} from "@/lib/demo/workflows"

export const runtime = "nodejs"
export const maxDuration = 30

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>
  }
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
}

const GEMINI_TIMEOUT_MS = 12_000
const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
]

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "extract-intake", limit: 40, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<{
      transcript?: NormalizedTranscriptItem[]
      companyProfile?: Partial<CompanyProfile>
      safeDemoScenario?: string
      workflowType?: DemoWorkflowType
    }>(request, 80_000)
    const transcript = normalizeTranscript(body.transcript)
    const companyProfile = body.companyProfile || {}
    const safeDemoScenario = typeof body.safeDemoScenario === "string" ? body.safeDemoScenario : ""
    const workflowType = isDemoWorkflowType(body.workflowType)
      ? body.workflowType
      : isDemoWorkflowType(companyProfile.workflowType)
        ? companyProfile.workflowType
        : DEFAULT_WORKFLOW_TYPE
    const companyName =
      companyProfile.company_name ||
      (companyProfile as { companyName?: string }).companyName ||
      "Generated company"

    if (!transcript.length) {
      return NextResponse.json(buildDemoPreviewHandoff(companyName, safeDemoScenario, workflowType))
    }

    const deterministic = extractIntakeDeterministic({
      transcript,
      companyProfile,
      safeDemoScenario,
      workflowType,
    })

    if (isDemoMockMode() || !serverEnv.geminiApiKey) {
      return NextResponse.json(deterministic)
    }

    const geminiIntake = await extractWithGemini({
      transcript,
      companyProfile,
      safeDemoScenario,
      deterministic,
      workflowType,
    })

    return NextResponse.json(geminiIntake)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      buildDemoPreviewHandoff("Generated company"),
      { status: 200 }
    )
  }
}

async function extractWithGemini({
  transcript,
  companyProfile,
  safeDemoScenario,
  deterministic,
  workflowType,
}: {
  transcript: NormalizedTranscriptItem[]
  companyProfile: Partial<CompanyProfile>
  safeDemoScenario: string
  deterministic: DemoIntakeHandoff
  workflowType: DemoWorkflowType
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const payload = await generateGeminiContent({
      apiKey: serverEnv.geminiApiKey,
      signal: controller.signal,
      body: {
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1600,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildExtractionPrompt(
                  transcript,
                  companyProfile,
                  safeDemoScenario,
                  deterministic,
                  workflowType
                ),
              },
            ],
          },
        ],
      },
    })
    const rawText =
      payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || ""
    const parsed = JSON.parse(stripJsonFences(rawText)) as Partial<DemoIntakeHandoff>
    const normalized = normalizeIntake({
      ...deterministic,
      ...parsed,
      workflowType,
      companyName: parsed.companyName || deterministic.companyName,
      isPreview: false,
      previewReason: "",
    })

    return normalized
  } catch {
    return deterministic
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

    if (![429, 500, 502, 503, 504, 404].includes(response.status)) {
      break
    }
  }

  throw new Error("Gemini extraction request failed.")
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function buildExtractionPrompt(
  transcript: NormalizedTranscriptItem[],
  companyProfile: Partial<CompanyProfile>,
  safeDemoScenario: string,
  deterministic: DemoIntakeHandoff,
  workflowType: DemoWorkflowType
) {
  const workflow = getWorkflowDefinition(workflowType)
  return [
    `Extract a conservative ${workflow.label} booking or urgent route from this demo transcript.`,
    "Return only strict JSON with exactly these fields:",
    JSON.stringify(
      {
        workflowType,
        callerName: "",
        facilityName: "",
        mainConcern: "",
        issueType: "",
        immediateDanger: "",
        callbackNumber: "",
        status: "",
        callerIdentity: "",
        clientContext: "",
        equipmentContext: "",
        safetyScreen: "",
        followUpPath: "",
        leadType: workflow.leadType,
        priority: workflow.priority,
        companyName: "",
        dispatchAlertText: "",
        crmSummary: "",
        waterSource: "",
        systemInterest: "",
        timeline: "",
        callbackPreference: "",
        wholeHouseOrPartial: "",
        sinceWhen: "",
        peopleAffected: "",
      },
      null,
      2
    ),
    "Rules:",
    "- Do not diagnose repairs, quote jobs, guarantee ETAs, or promise equipment capabilities.",
    "- If a field was not confirmed, use Needs confirmation or Not confirmed during call.",
    "- Never use Unknown.",
    "- Keep alert and booking-route copy concise and operational.",
    "- Immediate danger must be Yes, No, or Needs confirmation.",
    workflowType === "water_treatment"
      ? "- Extract water source, water concern, system interest, timeline, callback preference, and CSR/sales follow-up. Avoid emergency dispatch wording unless the caller reports no usable water, flooding, an active leak, or a safety risk."
      : "- Extract no-water or low-pressure issue, whole-house or partial scope, since when, service address, callback, people affected, safety screen, equipment context, and on-call dispatch. Avoid sales quote, softener, RO, filtration, and CSR/sales wording.",
    "",
    "Company profile:",
    JSON.stringify(
      {
        companyName: companyProfile.company_name || deterministic.companyName,
        websiteUrl: companyProfile.website,
        companySummary: companyProfile.companySummary,
        detectedServices: companyProfile.detectedServices,
        safeDemoScenario,
      },
      null,
      2
    ),
    "",
    "Deterministic baseline to preserve unless transcript clearly says otherwise:",
    JSON.stringify(deterministic, null, 2),
    "",
    "Transcript:",
    JSON.stringify(transcript, null, 2),
  ].join("\n")
}

function normalizeTranscript(value: unknown): NormalizedTranscriptItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const record = item as { role?: unknown; text?: unknown; timestamp?: unknown }
      const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null
      const text = typeof record.text === "string" ? record.text.replace(/\s+/g, " ").trim() : ""
      if (!role || !text) return null
      return {
        role,
        text,
        timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
      }
    })
    .filter((item): item is NormalizedTranscriptItem => Boolean(item))
}

function stripJsonFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
}
