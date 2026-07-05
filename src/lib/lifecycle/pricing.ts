import { formatCapacity, type SizingResult } from "@/lib/lifecycle/sizing"

export const PRICING_TIERS = ["value", "standard", "premium"] as const
export type PricingTier = (typeof PRICING_TIERS)[number]

export type QuoteLine = { label: string; amount: number }

export type Quote = {
  tier: PricingTier
  tierLabel: string
  lines: QuoteLine[]
  total: number
  rangeLow: number
  rangeHigh: number
  packageName: string
}

export type LedgerEntry = {
  when: string
  label: string
  amount: number
  kind: "install" | "recurring" | "consumable" | "service" | "upsell" | "referral"
}

export type LtvLedger = {
  entries: LedgerEntry[]
  directTotal: number
  referralTotal: number
  grandTotal: number
  noMemoryTotal: number
  planMonthly: number
  saltDelivery: number
  roPrice: number
  rebedPrice: number
  referralInstall: number
  ltvAtStage: {
    afterInstall: number
    afterMonth3: number
    afterReferral: number
    afterYear2: number
  }
}

export const TIER_DEFINITIONS: Record<
  PricingTier,
  {
    label: string
    band: string
    softenerByCapacity: Record<number, number>
    sulfurFilter: number
    ironFilter: number
    laborInstall: number
    saltFill: number
    ro: number
    planMonthly: number
    saltDelivery: number
    rebed: number
  }
> = {
  value: {
    label: "Value-focused",
    band: "$1,800–$2,800 typical install",
    softenerByCapacity: { 24000: 1150, 32000: 1350, 40000: 1550, 48000: 1750, 64000: 2050, 80000: 2400 },
    sulfurFilter: 950,
    ironFilter: 900,
    laborInstall: 350,
    saltFill: 45,
    ro: 325,
    planMonthly: 19,
    saltDelivery: 52,
    rebed: 320,
  },
  standard: {
    label: "Standard",
    band: "$2,800–$4,500 typical install",
    softenerByCapacity: { 24000: 1650, 32000: 1850, 40000: 2100, 48000: 2350, 64000: 2750, 80000: 3200 },
    sulfurFilter: 1350,
    ironFilter: 1250,
    laborInstall: 450,
    saltFill: 45,
    ro: 425,
    planMonthly: 24,
    saltDelivery: 58,
    rebed: 380,
  },
  premium: {
    label: "Premium",
    band: "$4,500–$7,000 typical install",
    softenerByCapacity: { 24000: 2400, 32000: 2700, 40000: 3000, 48000: 3400, 64000: 3900, 80000: 4500 },
    sulfurFilter: 1900,
    ironFilter: 1800,
    laborInstall: 650,
    saltFill: 60,
    ro: 650,
    planMonthly: 34,
    saltDelivery: 64,
    rebed: 520,
  },
}

export function isPricingTier(value: unknown): value is PricingTier {
  return typeof value === "string" && (PRICING_TIERS as readonly string[]).includes(value)
}

export function buildQuote(sizing: SizingResult, tier: PricingTier): Quote {
  const definition = TIER_DEFINITIONS[tier]
  const capacityLabel = formatCapacity(sizing.recommendedCapacity)
  const lines: QuoteLine[] = [
    {
      label: `${capacityLabel.replace("k", ",000")}-grain softener`,
      amount:
        definition.softenerByCapacity[sizing.recommendedCapacity] ??
        definition.softenerByCapacity[48000],
    },
  ]

  const treatments: string[] = []
  if (sizing.needsSulfurTreatment) {
    lines.push({ label: "Air-injection sulfur filter", amount: definition.sulfurFilter })
    treatments.push("air-injection sulfur filter")
  } else if (sizing.needsIronTreatment) {
    lines.push({ label: "Iron reduction filter", amount: definition.ironFilter })
    treatments.push("iron reduction filter")
  }

  lines.push({ label: "Installation labor", amount: definition.laborInstall })
  lines.push({ label: "Salt fill (4 bags)", amount: definition.saltFill })

  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const packageName = treatments.length
    ? `${capacityLabel} softener + ${treatments.join(" + ")}`
    : `${capacityLabel} softener`

  return {
    tier,
    tierLabel: definition.label,
    lines,
    total,
    rangeLow: roundTo50(total * 0.96),
    rangeHigh: roundTo50(total * 1.08),
    packageName,
  }
}

// The 24-month ledger: what one remembered customer produces when every
// follow-up actually fires. Referral revenue is attributed, not direct —
// the ledger labels it that way and the UI keeps the two totals separate.
export function buildLtvLedger(quote: Quote): LtvLedger {
  const definition = TIER_DEFINITIONS[quote.tier]
  const planTotal = definition.planMonthly * 24
  const saltCount = 8
  const saltTotal = definition.saltDelivery * saltCount
  const referralInstall = roundTo50(quote.total * 0.95)

  const entries: LedgerEntry[] = [
    { when: "Day 8", label: `Install — ${quote.packageName}`, amount: quote.total, kind: "install" },
    {
      when: "Day 8",
      label: `Service plan — $${definition.planMonthly}/mo × 24 months`,
      amount: planTotal,
      kind: "recurring",
    },
    {
      when: "Mo 3–24",
      label: `Salt program — ${saltCount} deliveries × $${definition.saltDelivery}`,
      amount: saltTotal,
      kind: "consumable",
    },
    { when: "Month 11", label: "Referral install — neighbor, attributed to review", amount: referralInstall, kind: "referral" },
    { when: "Month 22", label: "Filter media rebed", amount: definition.rebed, kind: "service" },
    { when: "Year 2", label: "Under-sink RO — drinking water", amount: definition.ro, kind: "upsell" },
  ]

  const directTotal = entries
    .filter((entry) => entry.kind !== "referral")
    .reduce((sum, entry) => sum + entry.amount, 0)
  const referralTotal = referralInstall
  const grandTotal = directTotal + referralTotal

  return {
    entries,
    directTotal,
    referralTotal,
    grandTotal,
    noMemoryTotal: quote.total,
    planMonthly: definition.planMonthly,
    saltDelivery: definition.saltDelivery,
    roPrice: definition.ro,
    rebedPrice: definition.rebed,
    referralInstall,
    // Cash-basis cumulative value at each timeline stage — the memory panel
    // counter climbs as revenue actually lands, not as it gets committed.
    ltvAtStage: {
      afterInstall: quote.total,
      afterMonth3: quote.total + definition.planMonthly * 3 + definition.saltDelivery,
      afterReferral:
        quote.total + definition.planMonthly * 11 + definition.saltDelivery * 3 + referralInstall,
      afterYear2: grandTotal,
    },
  }
}

export function money(amount: number) {
  return `$${Math.round(amount).toLocaleString("en-US")}`
}

function roundTo50(value: number) {
  return Math.round(value / 50) * 50
}
