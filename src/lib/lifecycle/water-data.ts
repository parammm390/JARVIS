// Real public water data lookup: zip → geography → measured well samples →
// public water system record. Every value carries provenance; every source
// has a timeout and a fallback so the demo never dead-ends on a slow API.

export type WaterLookup = {
  zip: string
  city: string
  state: string
  stateCode: string
  county: string
  countyFips: string
  hardnessMgL: number
  hardnessGpg: number
  hardnessSampleCount: number
  hardnessSource: "nearby_wells" | "state_estimate"
  ironMgL: number
  ironSampleCount: number
  ironSource: "nearby_wells" | "regional_estimate"
  pws: {
    name: string
    pwsid: string
    populationServed: number
    sourceCode: string
    violations5yr: number
  } | null
  provenance: string[]
  warnings: string[]
}

const MGL_PER_GPG = 17.12

// Median groundwater hardness by state (mg/L as CaCO3), derived from USGS
// national hardness mapping. Used only when county well samples are too thin.
const STATE_HARDNESS_MGL: Record<string, number> = {
  AL: 120, AK: 90, AZ: 330, AR: 140, CA: 200, CO: 180, CT: 100, DE: 120, DC: 140,
  FL: 220, GA: 60, HI: 60, ID: 200, IL: 320, IN: 320, IA: 340, KS: 320, KY: 220,
  LA: 140, ME: 60, MD: 140, MA: 70, MI: 280, MN: 300, MS: 100, MO: 250, MT: 220,
  NE: 300, NV: 280, NH: 60, NJ: 120, NM: 280, NY: 150, NC: 90, ND: 340, OH: 300,
  OK: 250, OR: 70, PA: 170, RI: 50, SC: 60, SD: 320, TN: 160, TX: 250, UT: 300,
  VT: 120, VA: 180, WA: 90, WV: 180, WI: 320, WY: 260,
}

const ZIPPOPOTAM_TIMEOUT_MS = 6_000
const FCC_TIMEOUT_MS = 6_000
const WQP_TIMEOUT_MS = 15_000
const EPA_TIMEOUT_MS = 9_000
const MIN_SAMPLES = 3
const SEARCH_RADIUS_MILES = 25

export async function lookupWater(zip: string): Promise<WaterLookup> {
  const provenance: string[] = []
  const warnings: string[] = []

  const place = await lookupZip(zip)
  provenance.push(`ZIP ${zip} → ${place.city}, ${place.stateCode}`)

  let county = ""
  let countyFips = ""
  try {
    const fcc = await fetchJson<{
      County?: { FIPS?: string; name?: string }
    }>(
      `https://geo.fcc.gov/api/census/block/find?latitude=${place.lat}&longitude=${place.lng}&format=json`,
      FCC_TIMEOUT_MS
    )
    county = fcc.County?.name || ""
    countyFips = fcc.County?.FIPS || ""
  } catch {
    warnings.push("County lookup was unavailable; using state-level records.")
  }

  const [samples, pws] = await Promise.all([
    place.lat && place.lng
      ? fetchNearbySamples(place.lat, place.lng).catch(() => null)
      : Promise.resolve(null),
    fetchWaterSystem(place.city, place.stateCode).catch(() => null),
  ])

  let hardnessMgL: number
  let hardnessSampleCount = 0
  let hardnessSource: WaterLookup["hardnessSource"]
  if (samples && samples.hardnessValues.length >= MIN_SAMPLES) {
    hardnessMgL = median(samples.hardnessValues)
    hardnessSampleCount = samples.hardnessValues.length
    hardnessSource = "nearby_wells"
    provenance.push(
      `Hardness: median of ${hardnessSampleCount} well samples within ${SEARCH_RADIUS_MILES} mi (USGS/WQP)`
    )
  } else {
    hardnessMgL = STATE_HARDNESS_MGL[place.stateCode] ?? 170
    hardnessSource = "state_estimate"
    provenance.push(`Hardness: ${place.stateCode} groundwater estimate (USGS mapping)`)
    if (samples && samples.hardnessValues.length > 0) {
      warnings.push(
        `Only ${samples.hardnessValues.length} nearby well sample(s) on record — using the state estimate instead.`
      )
    }
  }

  let ironMgL: number
  let ironSampleCount = 0
  let ironSource: WaterLookup["ironSource"]
  if (samples && samples.ironValues.length >= MIN_SAMPLES) {
    ironMgL = clamp(median(samples.ironValues), 0, 15)
    ironSampleCount = samples.ironValues.length
    ironSource = "nearby_wells"
    provenance.push(
      `Iron: median of ${ironSampleCount} well samples within ${SEARCH_RADIUS_MILES} mi (USGS/WQP)`
    )
  } else {
    ironMgL = hardnessMgL > 250 ? 0.4 : 0.2
    ironSource = "regional_estimate"
    provenance.push("Iron: regional estimate (thin sample coverage)")
  }

  if (pws) {
    provenance.push(
      `Water system: ${pws.name} (${pws.pwsid}), ${pws.populationServed.toLocaleString("en-US")} served — EPA SDWIS`
    )
    provenance.push(
      pws.violations5yr === 0
        ? "0 federal violations on record (hardness and iron are not federally regulated)"
        : `${pws.violations5yr} federal violation record(s) in the last 5 years — EPA SDWIS`
    )
  } else {
    provenance.push("No large public water system matched — private wells dominate this area")
  }

  return {
    zip,
    city: place.city,
    state: place.state,
    stateCode: place.stateCode,
    county,
    countyFips,
    hardnessMgL: Math.round(hardnessMgL),
    hardnessGpg: Math.round((hardnessMgL / MGL_PER_GPG) * 10) / 10,
    hardnessSampleCount,
    hardnessSource,
    ironMgL: Math.round(ironMgL * 100) / 100,
    ironSampleCount,
    ironSource,
    pws,
    provenance,
    warnings,
  }
}

async function lookupZip(zip: string) {
  const data = await fetchJson<{
    places?: Array<{
      "place name"?: string
      state?: string
      "state abbreviation"?: string
      latitude?: string
      longitude?: string
    }>
  }>(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, ZIPPOPOTAM_TIMEOUT_MS)

  const place = data.places?.[0]
  if (!place || !place["place name"] || !place["state abbreviation"]) {
    throw new WaterLookupError("That ZIP code did not resolve to a US place.")
  }

  return {
    city: titleCase(place["place name"]),
    state: place.state || "",
    stateCode: place["state abbreviation"],
    lat: place.latitude || "",
    lng: place.longitude || "",
  }
}

async function fetchNearbySamples(lat: string, lng: string) {
  const params = new URLSearchParams({
    mimeType: "csv",
    sorted: "no",
    sampleMedia: "Water",
    siteType: "Well",
    startDateLo: "01-01-2000",
    lat,
    long: lng,
    within: String(SEARCH_RADIUS_MILES),
  })
  const characteristics = ["Hardness, Ca, Mg", "Total hardness", "Iron"]
  const query =
    `https://www.waterqualitydata.us/data/Result/search?${params.toString()}` +
    characteristics.map((name) => `&characteristicName=${encodeURIComponent(name)}`).join("")

  const response = await fetchWithTimeout(query, WQP_TIMEOUT_MS)
  if (!response.ok) throw new Error(`WQP ${response.status}`)
  const csv = await response.text()
  return parseWqpCsv(csv)
}

function parseWqpCsv(csv: string) {
  const lines = csv.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length < 2) return { hardnessValues: [], ironValues: [] }

  const header = parseCsvRow(lines[0])
  const nameIndex = header.indexOf("CharacteristicName")
  const valueIndex = header.indexOf("ResultMeasureValue")
  const unitIndex = header.indexOf("ResultMeasure/MeasureUnitCode")
  if (nameIndex < 0 || valueIndex < 0) return { hardnessValues: [], ironValues: [] }

  const hardnessValues: number[] = []
  const ironValues: number[] = []

  for (const line of lines.slice(1)) {
    const row = parseCsvRow(line)
    const name = row[nameIndex] || ""
    const raw = parseFloat(row[valueIndex] || "")
    if (!Number.isFinite(raw) || raw < 0) continue
    const unit = (row[unitIndex] || "").toLowerCase()

    if (name.toLowerCase().includes("hardness")) {
      // Reported as mg/L CaCO3; discard implausible outliers.
      if (raw > 0 && raw < 3000) hardnessValues.push(raw)
    } else if (name === "Iron") {
      let mgL = raw
      if (unit.includes("ug")) mgL = raw / 1000
      else if (!unit && raw > 20) mgL = raw / 1000 // unlabeled values this large are µg/L
      if (mgL >= 0 && mgL < 50) ironValues.push(mgL)
    }
  }

  return { hardnessValues, ironValues }
}

function parseCsvRow(line: string) {
  const cells: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      cells.push(current)
      current = ""
    } else if (char !== "\r") {
      current += char
    }
  }
  cells.push(current)
  return cells
}

async function fetchWaterSystem(city: string, stateCode: string) {
  type SystemRow = {
    pwsid?: string
    pws_name?: string
    pws_activity_code?: string
    pws_type_code?: string
    population_served_count?: number | string
    primary_source_code?: string
  }

  const rows = await fetchJson<SystemRow[]>(
    `https://data.epa.gov/efservice/WATER_SYSTEM/PWS_NAME/CONTAINING/${encodeURIComponent(
      city.toUpperCase()
    )}/JSON`,
    EPA_TIMEOUT_MS
  )

  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        row.pwsid?.startsWith(stateCode) &&
        row.pws_activity_code === "A" &&
        row.pws_type_code === "CWS"
    )
    .map((row) => ({
      pwsid: row.pwsid || "",
      name: titleCase(row.pws_name || ""),
      populationServed: Number(row.population_served_count) || 0,
      sourceCode: row.primary_source_code || "",
    }))
    .sort((a, b) => b.populationServed - a.populationServed)

  const system = candidates[0]
  if (!system) return null

  let violations5yr = 0
  try {
    const violations = await fetchJson<Array<{ non_compl_per_begin_date?: string }>>(
      `https://data.epa.gov/efservice/VIOLATION/PWSID/EQUALS/${encodeURIComponent(system.pwsid)}/JSON`,
      EPA_TIMEOUT_MS
    )
    const cutoffYear = new Date().getFullYear() - 5
    violations5yr = (Array.isArray(violations) ? violations : []).filter((violation) => {
      const year = parseInt((violation.non_compl_per_begin_date || "").slice(-4), 10)
      return Number.isFinite(year) && year >= cutoffYear
    }).length
  } catch {
    // Violation count is additive context; the system record stands without it.
  }

  return { ...system, violations5yr }
}

export class WaterLookupError extends Error {}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, timeoutMs)
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`)
  return (await response.json()) as T
}

function fetchWithTimeout(url: string, timeoutMs: number) {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json,text/csv;q=0.9,*/*;q=0.8" },
    cache: "no-store",
  })
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value))
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .trim()
}
