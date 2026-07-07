import { NextResponse } from "next/server"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { lookupWater, WaterLookupError } from "@/lib/lifecycle/water-data"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  const requestId = Math.random().toString(36).slice(2, 9)
  const startTime = Date.now()
  try {
    const limited = rateLimit(request, { name: "lifecycle-water", limit: 20, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<{ zip?: string }>(request, 2_000)
    const zip = cleanString(body.zip, 10)
    if (!/^\d{5}$/.test(zip)) {
      console.info("[WATER_LOOKUP]", {
        requestId,
        zip,
        status: "invalid_zip",
        durationMs: Date.now() - startTime,
      })
      return NextResponse.json({ error: "Enter a 5-digit US ZIP code." }, { status: 400 })
    }

    const water = await lookupWater(zip)
    const durationMs = Date.now() - startTime
    console.info("[WATER_LOOKUP]", {
      requestId,
      zip,
      city: water.city,
      stateCode: water.stateCode,
      hardnessSource: water.hardnessSource,
      hardnessMgL: water.hardnessMgL,
      ironSource: water.ironSource,
      ironMgL: water.ironMgL,
      hasPws: Boolean(water.pws),
      pwsViolations5yr: water.pws?.violations5yr ?? null,
      hardnessSampleCount: water.hardnessSampleCount,
      ironSampleCount: water.ironSampleCount,
      warningCount: water.warnings.length,
      status: "success",
      durationMs,
    })
    return NextResponse.json({ water })
  } catch (error) {
    const durationMs = Date.now() - startTime
    if (error instanceof ApiRequestError) {
      console.info("[WATER_LOOKUP]", {
        requestId,
        error: error.message,
        status: "api_request_error",
        durationMs,
      })
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof WaterLookupError) {
      console.info("[WATER_LOOKUP]", {
        requestId,
        error: error.message,
        status: "lookup_error",
        durationMs,
      })
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error("[WATER_LOOKUP]", {
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
      status: "lookup_failed",
      durationMs,
    })
    return NextResponse.json(
      { error: "The public water records are responding slowly. Try again, or run the sample household." },
      { status: 502 }
    )
  }
}
