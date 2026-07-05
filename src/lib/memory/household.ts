// The unified backend concept behind every FINNOR demo:
// every lead becomes a household memory record, every record carries a next
// revenue action, every action is tracked to LTV. The call demo creates
// records at month zero, the lifecycle demo plays them forward two years —
// same shape, same engine, one spine. Client-safe: no server imports.

export type HouseholdStage = "lead" | "quoted" | "booked" | "installed" | "active" | "advocate"

export type RevenueEvent = {
  when: string
  label: string
  amount: number
  kind: "install" | "recurring" | "consumable" | "service" | "upsell" | "referral"
}

export type NextRevenueAction = {
  key: string
  label: string
  due: string
  revenue: number | null
}

export type QuoteSnapshot = {
  zip: string
  city: string
  stateCode: string
  hardnessGpg: number
  ironMgL: number
  dataSource: string
  packageName: string
  quoteLow: number
  quoteHigh: number
  tier: string
  tierLabel: string
  planMonthly: number
  saltDelivery: number
  sizingSummary: string
  variables: Record<string, string>
}

export type HouseholdRecord = {
  id: string | null
  source: "call_demo" | "lifecycle_demo"
  createdAt: string
  dealer: {
    name: string
    zip: string
    tier: string
    tierLabel: string
    services: string[]
  }
  customer: {
    name: string
    phone: string
    address: string
    concern: string
  }
  water: {
    city: string
    stateCode: string
    hardnessGpg: number
    ironMgL: number
    source: string
  } | null
  quote: {
    packageName: string
    low: number
    high: number
    planMonthly: number
    saltDelivery: number
  } | null
  appointment: string
  stage: HouseholdStage
  monthsElapsed: number
  ledger: RevenueEvent[]
  ltv: number
  nextAction: NextRevenueAction
}

export function computeLtv(ledger: RevenueEvent[]) {
  return ledger.reduce((sum, event) => sum + event.amount, 0)
}

export function computeStage(record: Omit<HouseholdRecord, "nextAction" | "stage" | "ltv">): HouseholdStage {
  const hasReferral = record.ledger.some((event) => event.kind === "referral")
  const hasInstall = record.ledger.some((event) => event.kind === "install")
  if (hasReferral) return "advocate"
  if (hasInstall && record.monthsElapsed >= 1) return "active"
  if (hasInstall) return "installed"
  if (record.appointment) return "booked"
  if (record.quote) return "quoted"
  return "lead"
}

// The revenue ladder: given what the record knows and how far time has run,
// what fires next and what is it worth. This is the one function all three
// demos agree on.
export function computeNextAction(
  record: Omit<HouseholdRecord, "nextAction" | "stage" | "ltv">
): NextRevenueAction {
  const plan = record.quote?.planMonthly ?? 24
  const salt = record.quote?.saltDelivery ?? 58

  if (!record.water) {
    return {
      key: "pull_water",
      label: "Pull the water record for this address",
      due: "Now — before anyone quotes",
      revenue: null,
    }
  }
  if (!record.quote) {
    return {
      key: "size_quote",
      label: "Run the sizing math and lock the quote range",
      due: "Within the minute",
      revenue: null,
    }
  }
  if (!record.appointment) {
    return {
      key: "book",
      label: "Text the report and booking options",
      due: "Within 60 seconds of hang-up",
      revenue: Math.round((record.quote.low + record.quote.high) / 2),
    }
  }
  const installed = record.ledger.some((event) => event.kind === "install")
  if (!installed) {
    return {
      key: "confirm_visit",
      label: `Confirm the visit — ${record.appointment}`,
      due: "Reminder at T-24h",
      revenue: Math.round((record.quote.low + record.quote.high) / 2),
    }
  }
  const reviewed = record.ledger.some((event) => event.label.toLowerCase().includes("review"))
  if (!reviewed && record.monthsElapsed < 1) {
    return {
      key: "review_ask",
      label: "Review ask — tomorrow, 6:00 PM",
      due: "24h after install",
      revenue: null,
    }
  }
  if (record.monthsElapsed < 22) {
    const nextQuarter = Math.max(3, (Math.floor(record.monthsElapsed / 3) + 1) * 3)
    return {
      key: "salt_checkin",
      label: `Salt check-in — month ${nextQuarter}`,
      due: `Plan running at $${plan}/mo`,
      revenue: salt,
    }
  }
  if (record.monthsElapsed < 24) {
    return {
      key: "media_rebed",
      label: "Filter media rebed — capacity flagged",
      due: "Month 22",
      revenue: 380,
    }
  }
  return {
    key: "retest_upsell",
    label: "Annual re-test + RO drinking-water offer",
    due: "Month 24 — with the next salt drop",
    revenue: 425,
  }
}

export function finalizeRecord(
  record: Omit<HouseholdRecord, "nextAction" | "stage" | "ltv">
): HouseholdRecord {
  return {
    ...record,
    stage: computeStage(record),
    ltv: computeLtv(record.ledger),
    nextAction: computeNextAction(record),
  }
}

export function buildCallDemoRecord(input: {
  dealerName: string
  zip: string
  tier: string
  tierLabel: string
  services: string[]
  quote: QuoteSnapshot | null
}): HouseholdRecord {
  return finalizeRecord({
    id: null,
    source: "call_demo",
    createdAt: new Date().toISOString(),
    dealer: {
      name: input.dealerName,
      zip: input.zip,
      tier: input.tier,
      tierLabel: input.tierLabel,
      services: input.services,
    },
    customer: { name: "", phone: "", address: "", concern: "" },
    water: input.quote
      ? {
          city: input.quote.city,
          stateCode: input.quote.stateCode,
          hardnessGpg: input.quote.hardnessGpg,
          ironMgL: input.quote.ironMgL,
          source: input.quote.dataSource,
        }
      : null,
    quote: input.quote
      ? {
          packageName: input.quote.packageName,
          low: input.quote.quoteLow,
          high: input.quote.quoteHigh,
          planMonthly: input.quote.planMonthly,
          saltDelivery: input.quote.saltDelivery,
        }
      : null,
    appointment: "",
    monthsElapsed: 0,
    ledger: [],
  })
}

export function mergeIntakeIntoRecord(
  record: HouseholdRecord,
  intake: { callerName?: string; callbackNumber?: string; facilityName?: string; mainConcern?: string }
): HouseholdRecord {
  const captured = (value?: string) =>
    value && !/^(needs confirmation|not captured|unknown|waiting)/i.test(value) ? value : ""

  return finalizeRecord({
    ...record,
    customer: {
      name: captured(intake.callerName) || record.customer.name,
      phone: captured(intake.callbackNumber) || record.customer.phone,
      address: captured(intake.facilityName) || record.customer.address,
      concern: captured(intake.mainConcern) || record.customer.concern,
    },
  })
}
