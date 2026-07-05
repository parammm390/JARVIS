import { NextResponse } from "next/server"
import type { DemoLeadInsert } from "@/lib/demo/types"
import { normalizeCompanyName, normalizeWebsiteDomain, requestIpHash } from "@/lib/demo/identity"
import { toVoiceDemoProfile } from "@/lib/demo/voice-profile"
import { insertDemoLead } from "@/lib/leads/supabase"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "demo-leads", limit: 30, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<Partial<DemoLeadInsert>>(request, 80_000)

    if (!body.company_name || !body.website_url || !body.generated_profile) {
      return NextResponse.json(
        { error: "company_name, website_url, and generated_profile are required." },
        { status: 400 }
      )
    }

    const companyName = cleanString(body.company_name, 120)
    const websiteUrl = cleanString(body.website_url, 260)
    const leadId = await insertDemoLead(
      {
        company_name: companyName,
        website_url: websiteUrl,
        generated_profile: body.generated_profile,
        voice_profile: body.voice_profile || toVoiceDemoProfile(body.generated_profile),
        confidence_score: Number(body.confidence_score || 0),
        source_path: body.source_path || "/demo",
        notes: body.notes || null,
      },
      request,
      {
        normalizedDomain: normalizeWebsiteDomain(websiteUrl),
        normalizedCompanyName: normalizeCompanyName(companyName),
        ipHash: requestIpHash(request),
      }
    )

    return NextResponse.json({ lead_id: leadId })
  } catch (error) {
    console.error("Demo lead insert error:", error)
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ lead_id: null }, { status: 200 })
  }
}
