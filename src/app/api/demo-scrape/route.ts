import { NextResponse } from "next/server"
import { readablePagesFrom, scrapeCompanyWebsite, UnsafeScrapeUrlError } from "@/lib/scrape/scrape-site"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "demo-scrape", limit: 20, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<{ websiteUrl?: string }>(request, 8_000)
    const websiteUrl = cleanString(body.websiteUrl, 220)

    if (!websiteUrl) {
      return NextResponse.json({ error: "websiteUrl is required." }, { status: 400 })
    }

    const scrape = await scrapeCompanyWebsite(websiteUrl)

    return NextResponse.json({
      websiteUrl: scrape.website,
      pagesRead: readablePagesFrom(scrape.pages).length,
      sourceUrls: scrape.discoveredUrls,
      extracted: scrape.extractedSignals,
      warnings: scrape.warnings,
    })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof UnsafeScrapeUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const message =
      error instanceof Error ? error.message : "The demo scrape endpoint could not read the site."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
