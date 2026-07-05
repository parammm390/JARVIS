import { NextResponse } from "next/server"
import { buildGeminiCompanyProfile } from "@/lib/llm/gemini"
import { scrapeCompanyWebsite } from "@/lib/scrape/scrape-site"
import { toVoiceDemoProfile } from "@/lib/demo/voice-profile"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { isDemoWorkflowType } from "@/lib/demo/workflows"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "demo-profile", limit: 12, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<{
      companyName?: string
      websiteUrl?: string
      workflowType?: string
    }>(request, 12_000)
    const companyName = cleanString(body.companyName, 100)
    const websiteUrl = cleanString(body.websiteUrl, 220)

    const workflowType = isDemoWorkflowType(body.workflowType) ? body.workflowType : null

    if (!companyName || !websiteUrl || !workflowType) {
      return NextResponse.json(
        { error: "Company name, website URL, and workflow type are required." },
        { status: 400 }
      )
    }

    const scrape = await scrapeCompanyWebsite(websiteUrl)
    const profile = await buildGeminiCompanyProfile(companyName, scrape, workflowType)

    return NextResponse.json(toVoiceDemoProfile(profile))
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message =
      error instanceof Error
        ? error.message
        : "The demo profile endpoint could not complete the scrape."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
