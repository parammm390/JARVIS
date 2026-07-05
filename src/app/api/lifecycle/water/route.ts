import { NextResponse } from "next/server"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { lookupWater, WaterLookupError } from "@/lib/lifecycle/water-data"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "lifecycle-water", limit: 20, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<{ zip?: string }>(request, 2_000)
    const zip = cleanString(body.zip, 10)
    if (!/^\d{5}$/.test(zip)) {
      return NextResponse.json({ error: "Enter a 5-digit US ZIP code." }, { status: 400 })
    }

    const water = await lookupWater(zip)
    return NextResponse.json({ water })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof WaterLookupError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error("Lifecycle water lookup error:", error)
    return NextResponse.json(
      { error: "The public water records are responding slowly. Try again, or run the sample household." },
      { status: 502 }
    )
  }
}
