// Server-side area quoting: the same water → sizing → price engine the
// lifecycle demo runs, packaged for the live voice agent. The returned
// variables ship straight into Vapi variableValues so the assistant prompt
// can quote real numbers — {{quote_range}}, {{area_hardness_gpg}}, etc.

import { buildLtvLedger, buildQuote, money, TIER_DEFINITIONS, type PricingTier } from "@/lib/lifecycle/pricing"
import { computeSizing } from "@/lib/lifecycle/sizing"
import { lookupWater } from "@/lib/lifecycle/water-data"
import type { QuoteSnapshot } from "@/lib/memory/household"

export async function buildAreaQuote(input: {
  zip: string
  tier: PricingTier
  householdSize: number
  onWell: boolean
}): Promise<QuoteSnapshot | null> {
  try {
    const water = await lookupWater(input.zip)
    const sizing = computeSizing({
      hardnessGpg: water.hardnessGpg,
      ironMgL: water.ironMgL,
      householdSize: input.householdSize,
      hasSulfurConcern: input.onWell,
    })
    const quote = buildQuote(sizing, input.tier)
    const ledger = buildLtvLedger(quote)
    const definition = TIER_DEFINITIONS[input.tier]

    const dataSource =
      water.hardnessSource === "nearby_wells"
        ? `median of ${water.hardnessSampleCount} well samples within 25 miles of ${water.city}`
        : `${water.state} groundwater records`
    const sizingSummary = `${input.householdSize}-person household on ${sizing.hardnessGpg} gpg water (${dataSource}) → ${quote.packageName}`

    return {
      zip: input.zip,
      city: water.city,
      stateCode: water.stateCode,
      hardnessGpg: sizing.hardnessGpg,
      ironMgL: sizing.ironMgL,
      dataSource,
      packageName: quote.packageName,
      quoteLow: quote.rangeLow,
      quoteHigh: quote.rangeHigh,
      tier: input.tier,
      tierLabel: definition.label,
      planMonthly: ledger.planMonthly,
      saltDelivery: ledger.saltDelivery,
      sizingSummary,
      variables: {
        quoting_enabled: "true",
        service_area_zip: input.zip,
        service_area_city: `${water.city}, ${water.stateCode}`,
        area_hardness_gpg: String(sizing.hardnessGpg),
        area_iron_ppm: String(sizing.ironMgL),
        area_water_source: dataSource,
        recommended_package: quote.packageName,
        quote_low: String(quote.rangeLow),
        quote_high: String(quote.rangeHigh),
        quote_range: `${money(quote.rangeLow)} to ${money(quote.rangeHigh)} installed`,
        pricing_tier: definition.label,
        plan_monthly: `$${definition.planMonthly} per month`,
        salt_delivery_price: `$${definition.saltDelivery} per delivery`,
        sizing_summary: sizingSummary,
      },
    }
  } catch {
    return null
  }
}
