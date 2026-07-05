import { NextResponse } from "next/server"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { buildScenario, computeScenarioParts, type ScenarioBuildInput } from "@/lib/lifecycle/build-scenario"
import { isPricingTier, type PricingTier } from "@/lib/lifecycle/pricing"
import type { WaterLookup } from "@/lib/lifecycle/water-data"
import { buildDiagnosisNarrative } from "@/lib/llm/lifecycle-diagnosis"
import { getSupabaseServiceClient } from "@/lib/leads/supabase"
import { finalizeRecord } from "@/lib/memory/household"
import { saveHouseholdRecord } from "@/lib/memory/store"
import { TIER_DEFINITIONS } from "@/lib/lifecycle/pricing"

export const runtime = "nodejs"
export const maxDuration = 60

type DiagnoseRequest = {
  water?: WaterLookup
  dealerName?: string
  services?: string[]
  tier?: string
  householdSize?: number
  concernLabel?: string
  onWell?: boolean
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "lifecycle-diagnose", limit: 12, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<DiagnoseRequest>(request, 24_000)
    const water = body.water
    if (!water || typeof water !== "object" || !water.city || !water.stateCode) {
      return NextResponse.json({ error: "Run the water lookup first." }, { status: 400 })
    }

    const tier: PricingTier = isPricingTier(body.tier) ? body.tier : "standard"
    const services = (Array.isArray(body.services) ? body.services : [])
      .map((service) => cleanString(service, 60))
      .filter(Boolean)
      .slice(0, 8)
    const householdSize = [2, 4, 6].includes(Number(body.householdSize))
      ? Number(body.householdSize)
      : 4
    const dealerName =
      cleanString(body.dealerName, 80) || `Clean Water of ${water.state || water.stateCode}`
    const concernLabel = cleanString(body.concernLabel, 60) || "Hard water scale"
    const onWell = body.onWell !== false

    const buildInput: ScenarioBuildInput = {
      dealerName,
      dealerServices: services.length ? services : ["Water softeners", "Whole-house filtration"],
      tier,
      water: sanitizeWater(water),
      householdSize,
      concernLabel,
      onWell,
      live: true,
    }

    const { sizing, quote, ledger, diagnosisInput } = computeScenarioParts(buildInput)
    const narrative = await buildDiagnosisNarrative(diagnosisInput)
    const scenario = buildScenario({ ...buildInput, narrative })

    void captureLifecycleLead(buildInput, narrative.fallbackUsed)

    // The projected two-year relationship is itself a household memory record
    // on the unified spine: full ledger, LTV, and the month-24 next action.
    void saveHouseholdRecord(
      finalizeRecord({
        id: null,
        source: "lifecycle_demo",
        createdAt: new Date().toISOString(),
        dealer: {
          name: dealerName,
          zip: buildInput.water.zip,
          tier,
          tierLabel: TIER_DEFINITIONS[tier].label,
          services: buildInput.dealerServices,
        },
        customer: {
          name: "Jennifer Alvarez (composite)",
          phone: "",
          address: `142 Millbrook Rd, ${buildInput.water.city}`,
          concern: concernLabel,
        },
        water: {
          city: buildInput.water.city,
          stateCode: buildInput.water.stateCode,
          hardnessGpg: sizing.hardnessGpg,
          ironMgL: sizing.ironMgL,
          source: buildInput.water.hardnessSource,
        },
        quote: {
          packageName: quote.packageName,
          low: quote.rangeLow,
          high: quote.rangeHigh,
          planMonthly: ledger.planMonthly,
          saltDelivery: ledger.saltDelivery,
        },
        appointment: "Completed — installed day 8",
        monthsElapsed: 24,
        ledger: ledger.entries.map((entry) => ({
          when: entry.when,
          label: entry.label,
          amount: entry.amount,
          kind: entry.kind,
        })),
      })
    )

    return NextResponse.json({ scenario, narrativeSource: narrative.fallbackUsed ? "computed" : "ai" })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Lifecycle diagnose error:", error)
    return NextResponse.json(
      { error: "The diagnosis could not be generated. Try again, or run the sample household." },
      { status: 500 }
    )
  }
}

// Untrusted client payload → clamp every number into a sane range before it
// touches the math or the model prompt.
function sanitizeWater(water: WaterLookup): WaterLookup {
  const clamp = (value: number, low: number, high: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

  return {
    ...water,
    zip: cleanString(water.zip, 10),
    city: cleanString(water.city, 60) || "Your Area",
    state: cleanString(water.state, 40),
    stateCode: cleanString(water.stateCode, 2).toUpperCase() || "US",
    county: cleanString(water.county, 60),
    countyFips: cleanString(water.countyFips, 5),
    hardnessMgL: clamp(Number(water.hardnessMgL), 10, 3000, 170),
    hardnessGpg: clamp(Number(water.hardnessGpg), 0.5, 175, 10),
    hardnessSampleCount: clamp(Number(water.hardnessSampleCount), 0, 100000, 0),
    ironMgL: clamp(Number(water.ironMgL), 0, 15, 0.2),
    ironSampleCount: clamp(Number(water.ironSampleCount), 0, 100000, 0),
    pws: water.pws
      ? {
          name: cleanString(water.pws.name, 80),
          pwsid: cleanString(water.pws.pwsid, 12),
          populationServed: clamp(Number(water.pws.populationServed), 0, 20_000_000, 0),
          sourceCode: cleanString(water.pws.sourceCode, 4),
          violations5yr: clamp(Number(water.pws.violations5yr), 0, 500, 0),
        }
      : null,
    provenance: (Array.isArray(water.provenance) ? water.provenance : [])
      .map((line) => cleanString(line, 160))
      .filter(Boolean)
      .slice(0, 8),
    warnings: (Array.isArray(water.warnings) ? water.warnings : [])
      .map((line) => cleanString(line, 160))
      .filter(Boolean)
      .slice(0, 4),
  }
}

async function captureLifecycleLead(input: ScenarioBuildInput, fallbackUsed: boolean) {
  try {
    const supabase = getSupabaseServiceClient()
    if (!supabase) return

    await supabase.from("demo_leads").insert({
      normalized_domain: `lifecycle:${input.water.zip}`,
      normalized_company_name: input.dealerName.toLowerCase(),
      website_url: "",
      company_name: input.dealerName,
      profile_json: {
        source: "lifecycle_demo",
        zip: input.water.zip,
        city: input.water.city,
        state: input.water.stateCode,
        tier: input.tier,
        services: input.dealerServices,
        householdSize: input.householdSize,
        concern: input.concernLabel,
        hardnessGpg: input.water.hardnessGpg,
        ironMgL: input.water.ironMgL,
        narrative: fallbackUsed ? "computed" : "ai",
      },
      confidence_score: 100,
      status: "lifecycle_generated",
      error_message: null,
      call_started: false,
    })
  } catch {
    // Lead capture must never interrupt the demo.
  }
}
