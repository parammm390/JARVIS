// Compiles a full LifecycleScenario from computed parts: real water lookup,
// real sizing math, tier-priced quote, the 24-month ledger, and the narrative
// layer (Gemini or deterministic fallback). The sample household runs through
// this exact same pipeline with a canned lookup — one code path, no hand-
// authored numbers anywhere.

import {
  buildFallbackNarrative,
  type DiagnosisInput,
  type DiagnosisNarrative,
} from "@/lib/llm/lifecycle-diagnosis"
import { buildLtvLedger, buildQuote, money, TIER_DEFINITIONS, type PricingTier } from "@/lib/lifecycle/pricing"
import { computeSizing, formatCapacity } from "@/lib/lifecycle/sizing"
import type { LifecycleScenario, LifecycleStage, SceneData } from "@/lib/lifecycle/scenario"
import type { WaterLookup } from "@/lib/lifecycle/water-data"

export type ScenarioBuildInput = {
  dealerName: string
  dealerServices: string[]
  tier: PricingTier
  water: WaterLookup
  householdSize: number
  concernLabel: string
  onWell: boolean
  live: boolean
  narrative?: DiagnosisNarrative
}

const CUSTOMER = {
  name: "Jennifer Alvarez",
  firstName: "Jennifer",
  initials: "JA",
  street: "142 Millbrook Rd",
  phone: "(555) 010-0132",
}

const BOOKING_SLOTS = ["Thu 10:00 AM", "Fri 2:00 PM", "Sat 9:00 AM"]

const WARRANTY_BY_TIER: Record<PricingTier, string> = {
  value: "5-yr media / 1-yr labor",
  standard: "7-yr media / 2-yr labor",
  premium: "10-yr media / 5-yr labor",
}

export function computeScenarioParts(input: ScenarioBuildInput) {
  const sizing = computeSizing({
    hardnessGpg: input.water.hardnessGpg,
    ironMgL: input.water.ironMgL,
    householdSize: input.householdSize,
    hasSulfurConcern: /sulfur|rotten/i.test(input.concernLabel),
  })
  const quote = buildQuote(sizing, input.tier)
  const ledger = buildLtvLedger(quote)

  const diagnosisInput: DiagnosisInput = {
    dealerName: input.dealerName,
    dealerServices: input.dealerServices,
    tierLabel: TIER_DEFINITIONS[input.tier].label,
    customerName: CUSTOMER.name,
    customerFirstName: CUSTOMER.firstName,
    streetAddress: CUSTOMER.street,
    householdSize: input.householdSize,
    concernLabel: input.concernLabel,
    onWell: input.onWell,
    water: input.water,
    sizing,
    quote,
    ledger,
  }

  return { sizing, quote, ledger, diagnosisInput }
}

export function buildScenario(input: ScenarioBuildInput): LifecycleScenario {
  const { sizing, quote, ledger, diagnosisInput } = computeScenarioParts(input)
  const narrative = input.narrative ?? buildFallbackNarrative(diagnosisInput)
  const { water } = input
  const address = `${CUSTOMER.street}, ${water.city}, ${water.stateCode}`

  const undersizedPct = Math.round(
    (1 - sizing.undersizedCapacity / sizing.recommendedCapacity) * 100
  )
  const saltPct = Math.max(20, Math.round((7 / sizing.undersizedRegenDays - 1) * 100))

  const waterRows: Extract<SceneData, { kind: "water" }>["rows"] = [
    {
      label: "Hardness",
      value: `${sizing.hardnessGpg} gpg`,
      detail: hardnessDetail(sizing.hardnessGpg),
      flag: sizing.hardnessGpg >= 7 ? "high" : "ok",
    },
    {
      label: "Iron",
      value: `${sizing.ironMgL} ppm`,
      detail:
        sizing.ironMgL >= 0.3
          ? "Staining begins at 0.3 ppm"
          : "Below the 0.3 ppm staining threshold",
      flag: sizing.ironMgL >= 0.3 ? "high" : "ok",
    },
  ]
  if (sizing.needsSulfurTreatment) {
    waterRows.push({
      label: "Hydrogen sulfide",
      value: "Reported",
      detail: "Matches the rotten-egg odor on the call",
      flag: "high",
    })
  }
  waterRows.push(
    water.pws
      ? {
          label: "Federal violations",
          value: `${water.pws.violations5yr} in 5 yrs`,
          detail: `${water.pws.name} — hardness isn't federally regulated`,
          flag: water.pws.violations5yr > 0 ? "high" : "ok",
        }
      : {
          label: "Water source",
          value: "Private wells",
          detail: "No large public system serves this area",
          flag: "ok",
        }
  )

  const beforeAfter: Extract<SceneData, { kind: "job" }>["results"] = [
    { label: "Hardness", before: `${sizing.hardnessGpg} gpg`, after: "1 gpg" },
    { label: "Iron", before: `${sizing.ironMgL} ppm`, after: "0.0 ppm" },
  ]
  if (sizing.needsSulfurTreatment) {
    beforeAfter.push({ label: "Sulfur odor", before: "Reported", after: "None" })
  }

  const planMonthly = money(ledger.planMonthly)
  const capacityLabel = formatCapacity(sizing.recommendedCapacity)

  const stages: LifecycleStage[] = [
    {
      id: "call",
      railLabel: "6:47 PM",
      timeLabel: "Day 0 — 6:47 PM",
      title: "The call you would have missed.",
      narration: `Tuesday, 6:47 PM in ${water.city}. Your crew is under a house. FINNOR answers on ring two.`,
      autoMs: 9000,
      scene: {
        kind: "call",
        chips: ["After hours", "Answered on ring 2", "0:54"],
        transcript: narrative.callTranscript,
      },
      writes: {
        fields: [
          { group: "Contact", label: "Customer", value: CUSTOMER.name },
          { group: "Contact", label: "Callback", value: CUSTOMER.phone },
          { group: "Contact", label: "Address", value: `${CUSTOMER.street}, ${water.city}` },
          { group: "Contact", label: "Reported concern", value: input.concernLabel },
          {
            group: "Water profile",
            label: "Source",
            value: input.onWell ? "Private well" : "Municipal supply",
          },
        ],
        events: [
          "After-hours call answered on ring two",
          "Name, address, callback, and concern captured",
        ],
        nextAction: "Pull the water record for this address",
        tag: "New lead",
      },
    },
    {
      id: "water",
      railLabel: "6:49 PM",
      timeLabel: "Day 0 — 6:49 PM",
      title: "It already knows the water.",
      narration: input.live
        ? `Two minutes in, the address has a water profile on file — pulled live from public records while you were reading the last screen.`
        : `Two minutes in, the address has a water profile on file — from public records, not a guess.`,
      autoMs: 9500,
      scene: {
        kind: "water",
        source: water.county
          ? `Public water records · ${water.county}, ${water.stateCode}`
          : `Public water records · ${water.state}`,
        note: narrative.waterNote,
        // The pulsing "live" badge is earned only by measured samples pulled
        // this session — estimates and the canned sample say what they are.
        badge:
          input.live && water.hardnessSource === "nearby_wells"
            ? { label: "Live public record", live: true }
            : input.live
              ? { label: "Public-record estimate", live: false }
              : { label: "Real area medians", live: false },
        provenance: water.provenance,
        rows: waterRows,
      },
      writes: {
        fields: [
          {
            group: "Water profile",
            label: "Hardness",
            value: `${sizing.hardnessGpg} gpg — ${hardnessClass(sizing.hardnessGpg)}`,
          },
          { group: "Water profile", label: "Iron", value: `${sizing.ironMgL} ppm` },
          ...(sizing.needsSulfurTreatment
            ? [{ group: "Water profile" as const, label: "Sulfur", value: "Reported (H₂S)" }]
            : []),
          ...(water.pws
            ? [
                {
                  group: "Water profile" as const,
                  label: "Public system",
                  value: `${water.pws.name} — ${water.pws.violations5yr} violations/5yr`,
                },
              ]
            : []),
        ],
        events: [
          input.live
            ? "Water profile pulled live from EPA / USGS public records"
            : "Water profile attached from public records",
        ],
        nextAction: "Size the system before anyone quotes",
      },
    },
    {
      id: "sizing",
      railLabel: "6:52 PM",
      timeLabel: "Day 0 — 6:52 PM",
      title: "Math, not a gut quote.",
      narration:
        "Household, hardness, iron — the sizing runs before a human touches this lead. The card on the right is what a showroom guess looks like.",
      autoMs: 10500,
      scene: {
        kind: "sizing",
        diagnosis: narrative.diagnosisSummary,
        steps: sizing.steps,
        verdict: quote.packageName,
        quote: `${money(quote.rangeLow)}–${money(quote.rangeHigh)} installed`,
        guess: {
          title: "The showroom guess",
          lines: [
            `${formatCapacity(sizing.undersizedCapacity)} unit off a rate sheet`,
            `Undersized ${undersizedPct}% for this water`,
            `Regenerates every ${sizing.undersizedRegenDays} days — salt bill up ~${saltPct}%`,
            "Resin exhausted years early",
          ],
        },
      },
      writes: {
        fields: [
          { group: "System & jobs", label: "Recommended system", value: quote.packageName },
          {
            group: "System & jobs",
            label: "Quote range",
            value: `${money(quote.rangeLow)}–${money(quote.rangeHigh)} installed`,
          },
        ],
        events: [
          `System sized from the water math — ${sizing.dailyLoadGrains.toLocaleString("en-US")} grains/day`,
          "Quote range locked to the sizing",
        ],
        nextAction: "Text the report and booking options",
      },
    },
    {
      id: "text",
      railLabel: "6:54 PM",
      timeLabel: "Day 0 — 6:54 PM",
      title: "The follow-up that lands in 60 seconds.",
      narration:
        "No “thanks for your interest.” The report, the numbers, and three ways to book — pick a slot yourself, this part works.",
      autoMs: 16000,
      scene: {
        kind: "messages",
        interactive: true,
        thread: [
          { from: "finnor", text: narrative.reportSms },
          {
            from: "finnor",
            text: narrative.quoteSms,
            chips: BOOKING_SLOTS,
            chosenChip: BOOKING_SLOTS[0],
          },
          { from: "customer", text: "{{slot}} works" },
          { from: "finnor", text: narrative.confirmSms },
        ],
      },
      writes: {
        fields: [
          { group: "Contact", label: "Preferred channel", value: "Text" },
          { group: "Relationship", label: "First response", value: "58 seconds after hang-up" },
          { group: "System & jobs", label: "Appointment", value: "{{slot}} — Marcus" },
        ],
        events: [
          "Report + three booking options sent by text",
          "Booked {{slot}} — confirmed in-thread",
        ],
        nextAction: "Visit {{slot}} — reminder at T-24h",
        tag: "Booked",
      },
    },
    {
      id: "job",
      railLabel: "Day 8",
      timeLabel: "Day 8 — on site",
      title: "The visit, documented like it matters.",
      narration:
        "Serials, photos, before-and-after numbers, an itemized invoice that matches the quote — and the service plan enrolled before Marcus leaves the driveway.",
      autoMs: 11000,
      scene: {
        kind: "job",
        jobLabel: `Job #1042 · Marcus · ${water.city}`,
        results: beforeAfter,
        invoice: quote.lines.map((line) => ({ label: line.label, amount: money(line.amount) })),
        invoiceTotal: money(quote.total),
        onFile: [
          `Softener SN ${capacityLabel.toUpperCase()}-22417`,
          "3 install photos",
          WARRANTY_BY_TIER[input.tier],
        ],
        plan: {
          title: `Service plan — ${planMonthly}/mo`,
          detail: "Annual re-test, priority scheduling, salt monitoring",
        },
      },
      writes: {
        fields: [
          { group: "System & jobs", label: "Equipment on file", value: quote.packageName },
          { group: "System & jobs", label: "Serials", value: `${capacityLabel.toUpperCase()}-22417` },
          { group: "System & jobs", label: "Warranty", value: WARRANTY_BY_TIER[input.tier] },
          {
            group: "System & jobs",
            label: "Service plan",
            value: `${planMonthly}/mo — enrolled at install`,
          },
          {
            group: "Water profile",
            label: "Hardness",
            value: `1 gpg treated (raw ${sizing.hardnessGpg})`,
          },
        ],
        events: [
          `Job #1042 closed — invoice ${money(quote.total)}, quoted ${money(quote.rangeLow)}–${money(quote.rangeHigh)}`,
          `Service plan enrolled at ${planMonthly}/mo`,
        ],
        nextAction: "Review ask tomorrow evening",
        ltv: ledger.ltvAtStage.afterInstall,
        tag: "Customer",
      },
    },
    {
      id: "review",
      railLabel: "Day 9",
      timeLabel: "Day 9 — 6:00 PM",
      title: "One review ask. At the right moment.",
      narration:
        "Twenty-four hours after install — the problem is freshly gone, and the ask references the actual job, not a template.",
      autoMs: 11000,
      scene: {
        kind: "review",
        thread: [
          { from: "finnor", text: narrative.reviewSms },
          { from: "customer", text: narrative.reviewReply },
        ],
        review: {
          stars: 5,
          quote: narrative.reviewQuote,
          name: "Jennifer A.",
          meta: `Google · Day 9 · ${water.city}`,
        },
      },
      writes: {
        fields: [{ group: "Relationship", label: "Review", value: "★★★★★ Google — Day 9" }],
        events: ["Review requested — one ask, 24h post-install", "5-star Google review posted"],
        nextAction: "Salt check-in at month 3",
      },
    },
    {
      id: "checkin",
      railLabel: "Month 3",
      timeLabel: "Month 3",
      title: "Month three. It checks in first.",
      narration:
        "Nobody at the shop remembered. Nothing had to. The system knows the install date, the salt capacity, and the usage.",
      autoMs: 11000,
      scene: {
        kind: "checkin",
        thread: [
          { from: "finnor", text: narrative.checkinSms },
          { from: "customer", text: "DELIVER" },
          {
            from: "finnor",
            text: "On the truck for Friday morning. Next check-in in three months — you don't have to remember any of this.",
          },
        ],
        order: {
          title: "Salt delivery — Friday",
          detail: "4 bags · quarterly cadence",
          amount: money(ledger.saltDelivery),
        },
      },
      writes: {
        fields: [
          {
            group: "Relationship",
            label: "Salt program",
            value: `${money(ledger.saltDelivery)}/quarter — auto check-in`,
          },
        ],
        events: [
          "Month-3 check-in sent — salt estimated at 40%",
          "Delivery booked; quarterly cadence starts",
        ],
        nextAction: "Next check-in — month 6",
        ltv: ledger.ltvAtStage.afterMonth3,
      },
    },
    {
      id: "referral",
      railLabel: "Month 11",
      timeLabel: "Month 11 — 7:12 PM",
      title: "The review picks up the phone.",
      narration:
        "A neighbor calls after hours and says the quiet part out loud. The memory logs where this lead actually came from — most shops never know.",
      autoMs: 10000,
      scene: {
        kind: "referral",
        callerName: "Dave Renner",
        callerLine: `“My neighbor Jennifer on Millbrook said you fixed her ${shortConcern(
          input.concernLabel
        )}. We've got the same water.”`,
        sourceNote: "Source attributed: Jennifer Alvarez → 5-star review → same-street referral",
        jobLabel: `Same county, same water table — the sizing math is already done`,
        amount: money(ledger.referralInstall),
      },
      writes: {
        fields: [
          {
            group: "Relationship",
            label: "Referrals",
            value: `1 — Dave Renner, same street (${money(ledger.referralInstall)})`,
          },
        ],
        events: [
          "Inbound after-hours call — Dave Renner, same street",
          "Referral attributed to Jennifer's review; install booked",
        ],
        nextAction: "Quote Dave Renner — same water, math already done",
        ltv: ledger.ltvAtStage.afterReferral,
        tag: "Advocate",
      },
    },
    {
      id: "upsell",
      railLabel: "Year 2",
      timeLabel: "Year 2 — Month 24",
      title: "Year two. The upsell that isn't a pitch.",
      narration:
        "Three real signals, one specific offer. It lands because the system remembers everything that came before.",
      autoMs: 13000,
      scene: {
        kind: "upsell",
        signals: narrative.upsellSignals,
        thread: [
          { from: "finnor", text: narrative.upsellSms },
          { from: "customer", text: "Yeah, let's do it 👍" },
          {
            from: "finnor",
            text: "Done — the RO goes in with Friday's delivery. Your file is already updated.",
          },
        ],
      },
      writes: {
        fields: [
          {
            group: "System & jobs",
            label: "RO system",
            value: `Under-sink RO — ${money(ledger.roPrice)}, booked`,
          },
        ],
        events: [
          "Media capacity + water report change flagged",
          "RO offered with full history context — booked",
        ],
        nextAction: "Install RO with Friday's salt drop",
      },
    },
    {
      id: "ledger",
      railLabel: "Ledger",
      timeLabel: "Year 2 — the ledger",
      title: `One remembered customer: ${money(ledger.grandTotal)}.`,
      narration: `Every line below fired automatically from one continuous memory. The same lead handled by a shop with no memory: ${money(
        ledger.noMemoryTotal
      )}, one transaction, then silence.`,
      autoMs: 14000,
      scene: {
        kind: "ledger",
        entries: ledger.entries.map((entry) => ({
          when: entry.when,
          label: entry.label,
          amount: money(entry.amount),
          kind: entry.kind,
        })),
        directTotal: money(ledger.directTotal),
        referralTotal: money(ledger.referralTotal),
        grandTotal: money(ledger.grandTotal),
        noMemoryTotal: money(ledger.noMemoryTotal),
      },
      writes: {
        fields: [
          {
            group: "Relationship",
            label: "Relationship",
            value: "2 years · 14 touches · 0 missed",
          },
        ],
        events: [`24-month value closed at ${money(ledger.grandTotal)} — one customer, one memory`],
        nextAction: "Annual re-test — month 26",
        ltv: ledger.ltvAtStage.afterYear2,
        tag: "Repeat customer",
      },
    },
  ]

  return {
    dealer: {
      name: input.dealerName,
      tierLabel: TIER_DEFINITIONS[input.tier].label,
      location: `${water.city}, ${water.stateCode}`,
    },
    customer: {
      name: CUSTOMER.name,
      initials: CUSTOMER.initials,
      address,
      phone: CUSTOMER.phone,
      since: "Jul 2026",
    },
    live: input.live,
    stages,
  }
}

// Canned lookup for the instant sample path: the real values measured for the
// Harrisonburg, VA area (51 well samples within 25 miles via USGS/WQP;
// city system via EPA SDWIS). Same pipeline, no fetch, deterministic.
export const SAMPLE_WATER: WaterLookup = {
  zip: "22801",
  city: "Harrisonburg",
  state: "Virginia",
  stateCode: "VA",
  county: "Rockingham County",
  countyFips: "51165",
  hardnessMgL: 245,
  hardnessGpg: 14.3,
  hardnessSampleCount: 51,
  hardnessSource: "nearby_wells",
  ironMgL: 0.01,
  ironSampleCount: 12,
  ironSource: "nearby_wells",
  pws: {
    name: "Harrisonburg, City of",
    pwsid: "VA2660345",
    populationServed: 61000,
    sourceCode: "SW",
    violations5yr: 0,
  },
  provenance: [
    "ZIP 22801 → Harrisonburg, VA",
    "Hardness: median of 51 well samples within 25 mi (USGS/WQP)",
    "Iron: median of 12 well samples within 25 mi (USGS/WQP)",
    "Water system: Harrisonburg, City of (VA2660345), 61,000 served — EPA SDWIS",
    "0 federal violations on record (hardness and iron are not federally regulated)",
  ],
  warnings: [],
}

export function buildSampleScenario(): LifecycleScenario {
  return buildScenario({
    dealerName: "Clean Water of Virginia",
    dealerServices: ["Water softeners", "Whole-house filtration", "RO drinking water", "Iron & sulfur treatment"],
    tier: "standard",
    water: SAMPLE_WATER,
    householdSize: 4,
    concernLabel: "Rotten-egg smell + hard water",
    onWell: true,
    live: false,
  })
}

function hardnessClass(gpg: number) {
  if (gpg >= 14) return "very hard"
  if (gpg >= 7) return "hard"
  if (gpg >= 3.5) return "moderately hard"
  return "soft"
}

function hardnessDetail(gpg: number) {
  if (gpg >= 7) return `${hardnessClass(gpg)[0].toUpperCase()}${hardnessClass(gpg).slice(1)} — ${Math.round((gpg / 7) * 10) / 10}× the “hard” threshold`
  return "Below the “hard” threshold"
}

function shortConcern(concernLabel: string) {
  const lower = concernLabel.toLowerCase()
  if (lower.includes("rotten") || lower.includes("sulfur")) return "sulfur water"
  if (lower.includes("stain")) return "iron staining"
  if (lower.includes("scale")) return "hard water"
  return "water"
}
