// The lifecycle quoting agent: turns a real water lookup + real sizing math +
// the dealer's actual pricing tier into the narrative layer of the demo —
// diagnosis, call transcript, and every SMS. Numbers are computed upstream and
// passed in; the model is instructed to use them verbatim, never invent them.
// Falls back to deterministic templates built from the same numbers, so the
// demo works identically without a GEMINI_API_KEY.

import { serverEnv } from "@/lib/env"
import { groqConfigured, groqGenerateJson } from "@/lib/llm/groq"
import { money, type LtvLedger, type Quote } from "@/lib/lifecycle/pricing"
import { formatCapacity, type SizingResult } from "@/lib/lifecycle/sizing"
import type { WaterLookup } from "@/lib/lifecycle/water-data"

export type DiagnosisInput = {
  dealerName: string
  dealerServices: string[]
  tierLabel: string
  customerName: string
  customerFirstName: string
  streetAddress: string
  householdSize: number
  concernLabel: string
  onWell: boolean
  water: WaterLookup
  sizing: SizingResult
  quote: Quote
  ledger: LtvLedger
}

export type DiagnosisNarrative = {
  diagnosisSummary: string
  waterNote: string
  callTranscript: Array<{ role: "ai" | "caller"; text: string }>
  reportSms: string
  quoteSms: string
  confirmSms: string
  reviewSms: string
  reviewReply: string
  reviewQuote: string
  checkinSms: string
  upsellSignals: string[]
  upsellSms: string
  fallbackUsed: boolean
}

const GEMINI_TIMEOUT_MS = 26_000
const FALLBACK_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite"]

const NARRATIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    diagnosis_summary: { type: "STRING" },
    water_note: { type: "STRING" },
    call_transcript: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { role: { type: "STRING" }, text: { type: "STRING" } },
      },
    },
    report_sms: { type: "STRING" },
    quote_sms: { type: "STRING" },
    confirm_sms: { type: "STRING" },
    review_sms: { type: "STRING" },
    review_reply: { type: "STRING" },
    review_quote: { type: "STRING" },
    checkin_sms: { type: "STRING" },
    upsell_signals: { type: "ARRAY", items: { type: "STRING" } },
    upsell_sms: { type: "STRING" },
  },
}

export async function buildDiagnosisNarrative(input: DiagnosisInput): Promise<DiagnosisNarrative> {
  const fallback = buildFallbackNarrative(input)

  if (groqConfigured()) {
    try {
      const parsed = await groqGenerateJson({
        prompt: buildPrompt(input),
        maxTokens: 4096,
        temperature: 0.4,
      })
      return normalizeNarrative(parsed, fallback)
    } catch {
      // Fall through to Gemini, then the deterministic narrative.
    }
  }

  const apiKey = serverEnv.geminiApiKey
  if (!apiKey) return fallback

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const response = await generateContent(apiKey, controller.signal, {
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: NARRATIVE_SCHEMA,
      },
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
    })

    const rawText =
      response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || ""
    const parsed = JSON.parse(rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "")) as Record<
      string,
      unknown
    >
    return normalizeNarrative(parsed, fallback)
  } catch {
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}

function buildPrompt(input: DiagnosisInput) {
  const { water, sizing, quote } = input
  return [
    "You write the narrative layer of a product demo for FINNOR, a lead recovery system for US water treatment dealers.",
    "The demo follows one customer relationship for two years. All numbers below are already computed from real public water data and the dealer's real pricing. Use them VERBATIM. Never invent numbers, contaminants, health claims, or regulations.",
    "",
    "Voice: direct, specific, zero fluff, zero hedging, zero corporate marketing tone. Texts read like a sharp local operator, not a SaaS drip campaign. Never use the word 'receptionist'.",
    "",
    "FACTS (use exactly):",
    `- Dealer: ${input.dealerName}, ${water.city}, ${water.stateCode}. Pricing tier: ${input.tierLabel}. Services: ${input.dealerServices.join(", ")}.`,
    `- Customer: ${input.customerName}, ${input.streetAddress}, ${water.city}. Household of ${input.householdSize}. ${input.onWell ? "Private well." : "Municipal water."}`,
    `- Reported concern: ${input.concernLabel}.`,
    `- Water: hardness ${sizing.hardnessGpg} gpg (${water.hardnessMgL} mg/L), iron ${sizing.ironMgL} ppm. Source: ${water.hardnessSource === "nearby_wells" ? `median of ${water.hardnessSampleCount} real well samples within 25 miles of ${water.city}` : `${water.stateCode} groundwater estimate`}.`,
    water.pws
      ? `- Local public system: ${water.pws.name}, ${water.pws.violations5yr} federal violations in 5 years. Note: hardness and iron are NOT federally regulated — water can be legally fine and still be this hard.`
      : "- No large public system matched; private wells dominate the area.",
    `- Sizing math: ${sizing.steps.map((step) => `${step.label}: ${step.value}`).join(" | ")}`,
    `- Recommendation: ${quote.packageName}. Quote range ${money(quote.rangeLow)}–${money(quote.rangeHigh)} installed.`,
    `- Undersized comparison: a ${formatCapacity(sizing.undersizedCapacity)} unit would regenerate every ${sizing.undersizedRegenDays} days.`,
    `- Salt program: ${money(input.ledger.saltDelivery)} per delivery. Service plan: ${money(input.ledger.planMonthly)}/mo. RO add-on at year 2: ${money(input.ledger.roPrice)} installed with system discount.`,
    "",
    "WRITE (JSON, all fields):",
    "- diagnosis_summary: 2 sentences. What this specific water does to this specific house, and why the recommended package is the right size. Plain words.",
    "- water_note: 1-2 sentences for the water report card. Local, specific, references the real geology/source of the numbers.",
    `- call_transcript: exactly 7 lines alternating, first line role "ai". The AI answers for ${input.dealerName} after hours, captures name (${input.customerFirstName}), address, concern, water source, callback number (555-0132 area code ${water.stateCode}), and closes by promising the water report by text in about a minute. Natural phone speech, short lines. The AI never quotes prices on the call.`,
    `- report_sms: first text to ${input.customerFirstName}. Their actual numbers, one link placeholder like ${linkDomain(input.dealerName)}/report. Under 320 chars.`,
    "- quote_sms: second text. The recommended package and quote range, then ask to book. Under 280 chars. Do NOT list time slots — the UI renders booking buttons.",
    "- confirm_sms: booking confirmation. MUST contain the literal placeholder {{slot}} where the chosen time goes, and the tech's first name Marcus. Under 240 chars.",
    "- review_sms: day-after review ask referencing the actual fix. One link placeholder. Under 240 chars.",
    `- review_reply: ${input.customerFirstName}'s short reply saying the problem is gone and they left 5 stars.`,
    "- review_quote: the public 5-star review text, 25-45 words, references the concern being fixed and the invoice matching the quote.",
    "- checkin_sms: month-3 salt check-in. States salt is likely near 40%, offers a delivery Friday, says reply DELIVER, states the delivery price. Under 260 chars.",
    "- upsell_signals: exactly 3 short strings — real signals from the file (media capacity, usage trend, water report change). No invented contaminants.",
    "- upsell_sms: the year-2 text. References the install date and current soft-water reading, the two relevant signals, offers the RO at its price with the system discount, offers to bring it at the next salt drop. Under 400 chars.",
  ].join("\n")
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

async function generateContent(
  apiKey: string,
  signal: AbortSignal,
  body: Record<string, unknown>
): Promise<GeminiResponse> {
  const models = [...new Set([serverEnv.geminiModel, ...FALLBACK_GEMINI_MODELS])]
  let lastError = "Gemini request failed."

  for (const modelName of models) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    )
    if (response.ok) return (await response.json()) as GeminiResponse
    lastError = `${modelName}: ${response.status}`
    if (![404, 429, 500, 502, 503, 504].includes(response.status)) break
  }

  throw new Error(lastError)
}

function normalizeNarrative(
  parsed: Record<string, unknown>,
  fallback: DiagnosisNarrative
): DiagnosisNarrative {
  const text = (value: unknown, fallbackText: string) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : fallbackText

  const transcriptRaw = Array.isArray(parsed.call_transcript) ? parsed.call_transcript : []
  const transcript = transcriptRaw
    .map((line) => {
      const record = line as { role?: unknown; text?: unknown }
      const role = record.role === "caller" ? "caller" : "ai"
      return typeof record.text === "string" && record.text.trim()
        ? { role: role as "ai" | "caller", text: record.text.trim() }
        : null
    })
    .filter((line): line is { role: "ai" | "caller"; text: string } => line !== null)

  const signalsRaw = Array.isArray(parsed.upsell_signals) ? parsed.upsell_signals : []
  const signals = signalsRaw.filter(
    (signal): signal is string => typeof signal === "string" && signal.trim().length > 0
  )

  const confirmSms = text(parsed.confirm_sms, fallback.confirmSms)

  return {
    diagnosisSummary: text(parsed.diagnosis_summary, fallback.diagnosisSummary),
    waterNote: text(parsed.water_note, fallback.waterNote),
    callTranscript: transcript.length >= 5 ? transcript : fallback.callTranscript,
    reportSms: text(parsed.report_sms, fallback.reportSms),
    quoteSms: text(parsed.quote_sms, fallback.quoteSms),
    confirmSms: confirmSms.includes("{{slot}}") ? confirmSms : fallback.confirmSms,
    reviewSms: text(parsed.review_sms, fallback.reviewSms),
    reviewReply: text(parsed.review_reply, fallback.reviewReply),
    reviewQuote: text(parsed.review_quote, fallback.reviewQuote),
    checkinSms: text(parsed.checkin_sms, fallback.checkinSms),
    upsellSignals: signals.length >= 3 ? signals.slice(0, 3) : fallback.upsellSignals,
    upsellSms: text(parsed.upsell_sms, fallback.upsellSms),
    fallbackUsed: false,
  }
}

export function buildFallbackNarrative(input: DiagnosisInput): DiagnosisNarrative {
  const { water, sizing, quote, ledger } = input
  const first = input.customerFirstName
  const link = linkDomain(input.dealerName)
  const hardnessPhrase = `${sizing.hardnessGpg} gpg hardness`
  const ironPhrase = sizing.ironMgL >= 0.3 ? `, ${sizing.ironMgL} ppm iron` : ""
  const sourcePhrase =
    water.hardnessSource === "nearby_wells"
      ? `the median of ${water.hardnessSampleCount} real well samples within 25 miles`
      : `${water.state} groundwater records`

  return {
    diagnosisSummary: `At ${sizing.compensatedGpg} gpg compensated hardness, a household of ${input.householdSize} pushes ${sizing.dailyLoadGrains.toLocaleString("en-US")} grains through the plumbing every day — scale, spotting, and shortened appliance life. The ${quote.packageName} is sized to carry that load on a 7-day regeneration cycle instead of burning itself out.`,
    waterNote: `These numbers come from ${sourcePhrase} — not a sales sheet. ${
      water.pws && water.pws.violations5yr === 0
        ? "The local system shows zero federal violations, and the water is still this hard: hardness isn't regulated."
        : "Hardness and iron aren't federally regulated, so nobody upstream is fixing this."
    }`,
    callTranscript: [
      {
        role: "ai",
        text: `Thanks for calling ${input.dealerName}. This is Sarah. How can I help with your water today?`,
      },
      {
        role: "caller",
        text: `Hi — we're at ${input.streetAddress} in ${water.city}. ${concernSpeech(input.concernLabel)}`,
      },
      {
        role: "ai",
        text: `That matches what we see around ${water.city}. Are you on a private well or city water?`,
      },
      { role: "caller", text: input.onWell ? "Private well." : "City water." },
      { role: "ai", text: "Got it. What's the best callback number for you?" },
      { role: "caller", text: `555-0132. Evenings are best — this is ${first}.` },
      {
        role: "ai",
        text: `Perfect, ${first}. You'll have your water report and booking options by text in about a minute.`,
      },
    ],
    reportSms: `Hi ${first} — ${input.dealerName}. Your water report for ${input.streetAddress} is ready: ${hardnessPhrase}${ironPhrase}, from ${sourcePhrase}. Full report: ${link}/report`,
    quoteSms: `Based on that water and your household of ${input.householdSize}, the right fit is a ${quote.packageName} — ${money(quote.rangeLow)}–${money(quote.rangeHigh)} installed. Want us out there?`,
    confirmSms: `Booked — {{slot}} with Marcus. You'll get a reminder the day before, and the on-site quote will match the report. No surprises.`,
    reviewSms: `${first} — ${input.dealerName}. The system's been running a day now. Noticing the difference? If we earned it, a quick review helps a local shop more than you'd think: ${link}/review`,
    reviewReply: "Honestly the difference is night and day. Just left 5 stars — thank you!",
    reviewQuote: `New ${quote.packageName.toLowerCase()} — the ${input.concernLabel.toLowerCase()} we'd been living with was gone the same day. The invoice matched the quote.`,
    checkinSms: `Hi ${first} — ${input.dealerName}. Your system's been running about 3 months, which usually puts the salt near 40%. Want a refill Friday? Reply DELIVER — 4 bags, ${money(ledger.saltDelivery)}.`,
    upsellSignals: [
      "Filter media at ~85% of rated capacity",
      `${water.pws ? "Annual water report flagged a treatment change upstream" : "County well data updated since install"}`,
      "Household water use up 18% year over year",
    ],
    upsellSms: `${first} — ${input.dealerName}. Two years since the install at ${input.streetAddress}, still reading 1 gpg — good. Two things worth knowing: your filter media is near end of life, and this year's water report changed. An under-sink RO covers drinking water — ${money(ledger.roPrice)} installed with your system discount. Marcus can bring it with your next salt drop.`,
    fallbackUsed: true,
  }
}

function concernSpeech(concernLabel: string) {
  const lower = concernLabel.toLowerCase()
  if (lower.includes("rotten") || lower.includes("sulfur"))
    return "The water smells like rotten eggs and it's leaving spots on everything."
  if (lower.includes("stain")) return "There's orange staining in every tub and toilet."
  if (lower.includes("scale")) return "There's white scale crusting on every faucet and the dishes come out spotted."
  return "The water tastes off and we don't trust it anymore."
}

function linkDomain(dealerName: string) {
  const compact = dealerName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
  return `${compact || "shop"}.co`
}
