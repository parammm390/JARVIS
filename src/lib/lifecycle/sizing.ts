export type SizingInput = {
  hardnessGpg: number
  ironMgL: number
  householdSize: number
  hasSulfurConcern: boolean
  gallonsPerPersonPerDay?: number
}

export type SizingResult = {
  hardnessGpg: number
  ironMgL: number
  compensatedGpg: number
  dailyGallons: number
  dailyLoadGrains: number
  weeklyLoadGrains: number
  recommendedCapacity: number
  needsIronTreatment: boolean
  needsSulfurTreatment: boolean
  undersizedCapacity: number
  undersizedRegenDays: number
  steps: Array<{ label: string; value: string }>
}

// Standard residential softener ladder. Sizing targets one regeneration every
// ~7 days with 20% capacity headroom at an efficient salt dose.
const CAPACITY_LADDER = [24000, 32000, 40000, 48000, 64000, 80000]
const USABLE_FRACTION = 0.8
const IRON_COMPENSATION_GPG_PER_MGL = 4

export function computeSizing(input: SizingInput): SizingResult {
  const gallonsPerPerson = input.gallonsPerPersonPerDay ?? 75
  const hardnessGpg = round1(Math.max(1, input.hardnessGpg))
  const ironMgL = round2(Math.max(0, input.ironMgL))
  const compensatedGpg = round1(hardnessGpg + ironMgL * IRON_COMPENSATION_GPG_PER_MGL)
  const dailyGallons = input.householdSize * gallonsPerPerson
  const dailyLoadGrains = Math.round(dailyGallons * compensatedGpg)
  const weeklyLoadGrains = dailyLoadGrains * 7

  const recommendedCapacity =
    CAPACITY_LADDER.find((capacity) => weeklyLoadGrains <= capacity * USABLE_FRACTION) ??
    CAPACITY_LADDER[CAPACITY_LADDER.length - 1]

  const ladderIndex = CAPACITY_LADDER.indexOf(recommendedCapacity)
  const undersizedCapacity = CAPACITY_LADDER[Math.max(0, ladderIndex - 1)]
  const undersizedRegenDays = Math.max(
    2,
    Math.floor((undersizedCapacity * USABLE_FRACTION) / dailyLoadGrains)
  )

  return {
    hardnessGpg,
    ironMgL,
    compensatedGpg,
    dailyGallons,
    dailyLoadGrains,
    weeklyLoadGrains,
    recommendedCapacity,
    needsIronTreatment: ironMgL >= 0.3,
    needsSulfurTreatment: input.hasSulfurConcern,
    undersizedCapacity,
    undersizedRegenDays,
    steps: [
      {
        label: "Household demand",
        value: `${input.householdSize} people × ${gallonsPerPerson} gal/day = ${dailyGallons} gal/day`,
      },
      {
        label: "Compensated hardness",
        value:
          ironMgL > 0
            ? `${hardnessGpg} gpg + (${ironMgL} ppm iron × ${IRON_COMPENSATION_GPG_PER_MGL}) = ${compensatedGpg} gpg`
            : `${hardnessGpg} gpg (no iron compensation needed)`,
      },
      {
        label: "Daily softening load",
        value: `${dailyGallons} gal × ${compensatedGpg} gpg = ${dailyLoadGrains.toLocaleString("en-US")} grains/day`,
      },
      {
        label: "7-day regeneration target",
        value: `${dailyLoadGrains.toLocaleString("en-US")} × 7 = ${weeklyLoadGrains.toLocaleString("en-US")} grains`,
      },
    ],
  }
}

export function formatCapacity(capacity: number) {
  return `${Math.round(capacity / 1000)}k`
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
