import { NextResponse } from "next/server"
import type { GenerateDemoRequest, GenerateDemoResponse, ScrapeResult } from "@/lib/demo/types"
import {
  DEMO_LIMIT_CALENDLY_URL,
  DEMO_LIMIT_PER_DOMAIN,
  DEMO_LIMIT_REACHED_MESSAGE,
} from "@/lib/demo/limits"
import { hashValue, normalizeCompanyName, normalizeWebsiteDomain, requestIpHash } from "@/lib/demo/identity"
import { buildProofArtifacts } from "@/lib/demo/artifacts"
import { toVoiceDemoProfile } from "@/lib/demo/voice-profile"
import { buildGeminiCompanyProfile } from "@/lib/llm/gemini"
import { buildDemoContext, buildVoiceSystemPrompt } from "@/lib/llm/prompt-builder"
import { readablePagesFrom, scrapeCompanyWebsite } from "@/lib/scrape/scrape-site"
import { isDemoMockMode } from "@/lib/env"
import { ApiRequestError, cleanString, readJsonBody } from "@/lib/api/request"
import { rateLimit } from "@/lib/api/rate-limit"
import { isDemoWorkflowType } from "@/lib/demo/workflows"
import {
  createGenerationLock,
  finalizeGenerationLock,
  findExistingDemo,
  insertDemoLead,
  markGenerationLockError,
} from "@/lib/leads/supabase"

export const runtime = "nodejs"
export const maxDuration = 60

const DEMO_LOCK_COOKIE = "finnor_demo_locks"

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, { name: "generate-demo", limit: 8, windowMs: 10 * 60 * 1000 })
    if (limited) return limited

    const body = await readJsonBody<Partial<GenerateDemoRequest>>(request, 12_000)
    const companyName = cleanString(body.companyName, 100)
    const websiteUrl = cleanString(body.websiteUrl, 220)
    const workflowType = isDemoWorkflowType(body.workflowType) ? body.workflowType : null
    const normalizedDomain = normalizeWebsiteDomain(websiteUrl)
    const normalizedCompanyName = normalizeCompanyName(companyName)
    const browserFingerprintHash = body.browserFingerprint
      ? hashValue(cleanString(body.browserFingerprint, 300)).slice(0, 48)
      : ""
    const accountId = cleanString(body.accountId, 120)
    const ipHash = requestIpHash(request)

    if (!companyName || !websiteUrl || !workflowType) {
      return NextResponse.json(
        { error: "Company name, website URL, and workflow type are required." },
        { status: 400 }
      )
    }

    const identity = {
      accountId,
      normalizedDomain,
      normalizedCompanyName,
      browserFingerprintHash,
      ipHash,
    }
    const existing = await findExistingDemo(identity)
    if (existing.found) {
      return duplicateResponse()
    }

    const browserLock = buildBrowserLock(identity)
    if (hasBrowserLock(request, normalizedDomain, browserLock)) {
      return duplicateResponse()
    }

    let lockId: string | null = null
    const lock = await createGenerationLock({ identity, companyName, websiteUrl, request })
    if (lock.status === "duplicate") {
      return duplicateResponse()
    }
    if (lock.status === "created") {
      lockId = lock.lockId
    }

    let scrape: ScrapeResult
    try {
      if (isDemoMockMode()) {
        scrape = {
          website: websiteUrl,
          pages: [],
          discoveredUrls: [],
          extractedSignals: emptySignals(),
          warnings: ["Mock mode is enabled. Website scraping was skipped."],
        }
      } else {
        try {
          scrape = await scrapeCompanyWebsite(websiteUrl)
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "We could not fully read the website, so a generic workflow was prepared."
          scrape = {
            website: websiteUrl,
            pages: [],
            discoveredUrls: [],
            extractedSignals: emptySignals(),
            warnings: [message, "Fallback demo profile was used."],
          }
        }
      }

      if (lock.status === "unavailable") {
        scrape.warnings.push("Persistent Supabase generation lock was unavailable.")
      }
      if (!existing.available) {
        scrape.warnings.push("Persistent Supabase duplicate lookup was unavailable.")
      }

      const profile = await buildGeminiCompanyProfile(companyName, scrape, workflowType)
      const voiceSystemPrompt = buildVoiceSystemPrompt(profile)
      const voiceProfile = toVoiceDemoProfile(profile)
      const demoContext = buildDemoContext(profile)
      const artifacts = buildProofArtifacts(profile)
      const leadId = await insertDemoLead(
        {
          company_name: profile.company_name,
          website_url: profile.website,
          generated_profile: profile,
          voice_profile: voiceProfile,
          confidence_score: profile.confidence_score,
          source_path: "/demo",
          notes: {
            normalized_domain: normalizedDomain,
            normalized_company_name: normalizedCompanyName,
            pages_read: readablePagesFrom(scrape.pages).length,
            discovered_urls: scrape.discoveredUrls,
            lock_id: lockId,
            workflow_type: workflowType,
          },
        },
        request,
        identity
      )
      await finalizeGenerationLock({ lockId, leadId, profile })

      const response: GenerateDemoResponse = {
        profile,
        voiceProfile,
        voiceSystemPrompt,
        demoContext,
        artifacts,
        lead_id: leadId,
        calendlyUrl: DEMO_LIMIT_CALENDLY_URL,
        scrape: {
          pagesRead: readablePagesFrom(scrape.pages).length,
          sourceUrls: scrape.discoveredUrls,
          warnings: scrape.warnings,
        },
      }

      const nextResponse = NextResponse.json(response)
      setBrowserLock(nextResponse, request, normalizedDomain, browserLock)
      return nextResponse
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An unexpected error occurred while preparing the demo."
      await markGenerationLockError(lockId, message)
      throw error
    }
  } catch (error) {
    console.error("Demo generation error:", error)
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "An unexpected error occurred while preparing the demo." },
      { status: 500 }
    )
  }
}

function emptySignals(): ScrapeResult["extractedSignals"] {
  return {
    phoneNumbers: [],
    services: [],
    equipmentMentions: [],
    emergencyServiceLines: [],
    afterHoursLines: [],
    callToActionText: [],
    locations: [],
  }
}

function duplicateResponse() {
  return NextResponse.json(
    {
      duplicate: true,
      duplicateMessage: DEMO_LIMIT_REACHED_MESSAGE,
      calendlyUrl: DEMO_LIMIT_CALENDLY_URL,
      scrape: { pagesRead: 0, sourceUrls: [], warnings: [] },
    },
    { status: 409 }
  )
}

type BrowserDemoCounts = Record<string, number>

function buildBrowserLock(identity: {
  accountId?: string
  normalizedDomain: string
  browserFingerprintHash?: string
  ipHash?: string
}) {
  return hashValue(
    [
      identity.accountId || "anonymous",
      identity.normalizedDomain,
      identity.browserFingerprintHash || identity.ipHash || "browser",
    ].join("|")
  ).slice(0, 48)
}

function readBrowserDemoCounts(request: Request): BrowserDemoCounts {
  const cookieHeader = request.headers.get("cookie") || ""
  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_LOCK_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=")

  if (!cookieValue) return {}

  try {
    const parsed = JSON.parse(decodeURIComponent(cookieValue)) as BrowserDemoCounts
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === "string" && typeof entry[1] === "number" && entry[1] > 0
      )
    )
  } catch {
    return {}
  }
}

function hasBrowserLock(request: Request, normalizedDomain: string, lock: string) {
  const counts = readBrowserDemoCounts(request)
  let domainCount = counts[normalizedDomain] || 0

  if (domainCount === 0) {
    const legacyLocks = readLegacyBrowserLocks(request)
    if (legacyLocks.has(lock)) {
      domainCount = 1
    }
  }

  return domainCount >= DEMO_LIMIT_PER_DOMAIN
}

function readLegacyBrowserLocks(request: Request) {
  const cookieHeader = request.headers.get("cookie") || ""
  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_LOCK_COOKIE}=`))
    ?.split("=")
    .slice(1)
    .join("=")

  if (!cookieValue || cookieValue.startsWith("{")) return new Set<string>()

  return new Set(
    decodeURIComponent(cookieValue)
      .split(".")
      .filter(Boolean)
  )
}

function setBrowserLock(
  response: NextResponse,
  request: Request,
  normalizedDomain: string,
  lock: string
) {
  const counts = readBrowserDemoCounts(request)
  let current = counts[normalizedDomain] || 0

  if (current === 0) {
    const legacyLocks = readLegacyBrowserLocks(request)
    if (legacyLocks.has(lock)) {
      current = 1
    }
  }

  counts[normalizedDomain] = current + 1

  response.cookies.set(DEMO_LOCK_COOKIE, encodeURIComponent(JSON.stringify(counts)), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  })
}
