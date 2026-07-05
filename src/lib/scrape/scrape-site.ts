import dns from "node:dns/promises"
import net from "node:net"
import type { ScrapeResult, ScrapedPage } from "@/lib/demo/types"

const CANDIDATE_PATHS = [
  "/",
  "/about",
  "/services",
  "/water-treatment",
  "/water-filtration",
  "/water-softeners",
  "/water-testing",
  "/reverse-osmosis",
  "/drinking-water",
  "/whole-house-filtration",
  "/book",
  "/schedule",
  "/request-service",
  "/emergency-service",
  "/contact",
  "/well-pump-repair",
  "/water-well-service",
  "/pressure-tank-repair",
  "/service-area",
]

const FETCH_TIMEOUT_MS = 4500
const MAX_REDIRECTS = 4
const MAX_PAGE_TEXT_CHARS = 14000
const MAX_TOTAL_TEXT_CHARS = 72000
const MIN_READABLE_TEXT_CHARS = 250
const MAX_PATHS_TO_FETCH = 24

const RELEVANT_KEYWORDS = [
  "water treatment",
  "water softener",
  "water softeners",
  "water filtration",
  "whole house",
  "whole-house",
  "reverse osmosis",
  "drinking water",
  "water test",
  "water testing",
  "free water analysis",
  "hard water",
  "sulfur",
  "iron",
  "staining",
  "odor",
  "ro system",
  "lead recovery",
  "missed call",
  "missed calls",
  "after-hours",
  "after hours",
  "overflow call",
  "web lead",
  "web leads",
  "book",
  "booking",
  "appointment",
  "quote",
  "estimate",
  "well pump",
  "dispatch",
  "submersible pump",
  "jet pump",
  "pressure tank",
  "pressure switch",
  "bladder tank",
  "water line",
  "well drilling",
  "emergency service",
  "water well",
  "no water",
  "low pressure",
  "repair",
  "service",
  "contact",
  "call",
  "phone",
  "emergency",
  "24/7",
  "24 hours",
  "after hours",
  "schedule",
  "request service",
]

const DISCOVERY_KEYWORDS = [
  "water-treatment",
  "water treatment",
  "water-filtration",
  "water filtration",
  "water-softener",
  "softener",
  "filtration",
  "reverse-osmosis",
  "osmosis",
  "water-test",
  "water test",
  "whole-house",
  "drinking-water",
  "book",
  "schedule",
  "appointment",
  "quote",
  "missed-call",
  "after-hours",
  "overflow",
  "web-lead",
  "well pump",
  "water well",
  "pressure tank",
  "contact",
  "emergency service",
  "service area",
  "about",
  "service",
]

const SERVICE_TERMS = [
  "Water treatment",
  "Water softener",
  "Water softeners",
  "Water filtration",
  "Whole-house filtration",
  "Whole house filtration",
  "Reverse osmosis",
  "RO system",
  "Drinking water system",
  "Water testing",
  "Water test",
  "Free water analysis",
  "Hard water treatment",
  "Iron filtration",
  "Sulfur odor treatment",
  "Emergency service",
  "Well pump repair",
  "Water well service",
  "Pressure tank replacement",
  "Submersible pump repair",
  "Jet pump repair",
  "Pressure switch repair",
  "Water line repair",
  "Well drilling",
]

const EQUIPMENT_TERMS = [
  "Water softener",
  "Water filter",
  "Whole-house filter",
  "Whole house filter",
  "Reverse osmosis",
  "RO system",
  "Drinking water system",
  "Iron filter",
  "Sulfur filter",
  "Well pump",
  "Submersible pump",
  "Jet pump",
  "Pressure tank",
  "Pressure switch",
  "Bladder tank",
  "Water line",
]

export class UnsafeScrapeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeScrapeUrlError"
  }
}

export function normalizeWebsiteUrl(input: string) {
  const trimmed = input.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeScrapeUrlError("Website URL must use HTTP or HTTPS.")
  }

  if (url.username || url.password) {
    throw new UnsafeScrapeUrlError("Website URL cannot include credentials.")
  }

  if (url.port && !["80", "443"].includes(url.port)) {
    throw new UnsafeScrapeUrlError("Only standard web ports are supported.")
  }

  url.hash = ""
  return url
}

export async function scrapeCompanyWebsite(inputUrl: string): Promise<ScrapeResult> {
  const rootUrl = normalizeWebsiteUrl(inputUrl)
  await assertPublicHost(rootUrl.hostname)

  const warnings: string[] = []
  const pages: ScrapedPage[] = []
  let totalTextChars = 0
  let pathsToFetch = uniqueStrings([
    ...CANDIDATE_PATHS,
    ...(await discoverSitemapPaths(rootUrl, warnings)),
  ]).slice(0, MAX_PATHS_TO_FETCH)

  for (let index = 0; index < pathsToFetch.length; index += 1) {
    if (totalTextChars >= MAX_TOTAL_TEXT_CHARS) break

    const path = pathsToFetch[index]
    const target = new URL(path, rootUrl.origin)
    const page = await fetchPage(target.toString())
    pages.push(page)
    if (isReadablePage(page)) {
      totalTextChars += page.text.length
    }

    if (index === 0 && page.links.length) {
      pathsToFetch = uniqueStrings([
        ...pathsToFetch,
        ...page.links
          .map((link) => safeInternalPath(link, rootUrl.origin))
          .filter(Boolean)
          .filter((link) =>
            DISCOVERY_KEYWORDS.some((keyword) => link.toLowerCase().includes(keyword))
          )
          .slice(0, 8),
      ]).slice(0, MAX_PATHS_TO_FETCH)
    }

    if (page.warnings.length) {
      warnings.push(...page.warnings.map((warning) => `${target.pathname}: ${warning}`))
    }

    await wait(180)
  }

  const readablePages = pages.filter(isReadablePage)
  if (readablePages.length === 0) {
    warnings.push("No readable website pages were found.")
  }

  return {
    website: rootUrl.origin,
    pages,
    discoveredUrls: pages.map((page) => page.url),
    extractedSignals: extractSignals(readablePages),
    warnings: uniqueStrings(warnings).slice(0, 10),
  }
}

async function discoverSitemapPaths(rootUrl: URL, warnings: string[]) {
  const sitemapUrls = [
    new URL("/sitemap.xml", rootUrl.origin).toString(),
    new URL("/sitemap_index.xml", rootUrl.origin).toString(),
  ]
  const paths: string[] = []

  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await fetchWithSafeRedirects(sitemapUrl, AbortSignal.timeout(2500))
      if (!response.ok) continue
      const contentType = response.headers.get("content-type") || ""
      if (
        contentType &&
        !contentType.includes("xml") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("octet-stream")
      ) {
        continue
      }

      const xml = await response.text()
      const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi))
        .map((match) => decodeEntities(match[1]))
        .map((url) => safeInternalPath(url, rootUrl.origin))
        .filter(Boolean)
        .filter((path) =>
          DISCOVERY_KEYWORDS.some((keyword) => path.toLowerCase().includes(keyword))
        )

      paths.push(...urls)
    } catch {
      warnings.push("Sitemap discovery was unavailable.")
    }
  }

  return uniqueStrings(paths).slice(0, 12)
}

export function isReadablePage(page: Pick<ScrapedPage, "status" | "text">) {
  return page.status >= 200 && page.status < 300 && page.text.length > MIN_READABLE_TEXT_CHARS
}

export function readablePagesFrom(pages: ScrapedPage[]) {
  return pages.filter(isReadablePage)
}

async function fetchPage(url: string): Promise<ScrapedPage> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetchWithSafeRedirects(url, controller.signal)

    const contentType = response.headers.get("content-type") || ""
    if (!response.ok) {
      return {
        url: response.url || url,
        status: response.status,
        title: null,
        text: "",
        links: [],
        callToActionText: [],
        warnings: [`Received HTTP ${response.status}.`],
      }
    }

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        url,
        status: response.status,
        title: null,
        text: "",
        links: [],
        callToActionText: [],
        warnings: [`Skipped non-HTML response (${contentType || "unknown content type"}).`],
      }
    }

    const html = await response.text()
    const title = extractTitle(html)
    const links = extractLinks(html, response.url || url)
    const callToActionText = extractCallToActionText(html)
    const text = extractReadableText(html)

    return {
      url: response.url || url,
      status: response.status,
      title,
      text: prioritizeRelevantText(text).slice(0, MAX_PAGE_TEXT_CHARS),
      links,
      callToActionText,
      warnings: [],
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError"
    return {
      url,
      status: 0,
      title: null,
      text: "",
      links: [],
      callToActionText: [],
      warnings: [isAbort ? "Timed out while reading page." : "Could not read page."],
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchWithSafeRedirects(url: string, signal: AbortSignal, redirectCount = 0): Promise<Response> {
  const response = await fetch(url, {
    signal,
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "FINNOR demo generator (+https://finnorai.com) respectful dispatch-preview bot",
    },
  })

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return response
  }

  const location = response.headers.get("location")
  if (!location) return response
  if (redirectCount >= MAX_REDIRECTS) {
    throw new UnsafeScrapeUrlError("Website redirected too many times.")
  }

  const nextUrl = new URL(location, url)
  if (!["http:", "https:"].includes(nextUrl.protocol)) {
    throw new UnsafeScrapeUrlError("Website redirected to an unsupported URL.")
  }
  if (nextUrl.port && !["80", "443"].includes(nextUrl.port)) {
    throw new UnsafeScrapeUrlError("Website redirected to an unsupported port.")
  }

  await assertPublicHost(nextUrl.hostname)
  nextUrl.hash = ""
  return fetchWithSafeRedirects(nextUrl.toString(), signal, redirectCount + 1)
}

function extractLinks(html: string, baseUrl: string) {
  const links = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi))
    .map((match) => match[1])
    .map((href) => {
      try {
        const url = new URL(decodeEntities(href), baseUrl)
        url.hash = ""
        url.search = ""
        return url.toString()
      } catch {
        return ""
      }
    })
    .filter(Boolean)

  return uniqueStrings(links).slice(0, 40)
}

function extractCallToActionText(html: string) {
  const matches = Array.from(html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    .map((match) => normalizeWhitespace(decodeEntities(match[2].replace(/<[^>]+>/g, " "))))
    .filter((text) => text.length >= 3 && text.length <= 90)
    .filter((text) => !/[?]$/.test(text))
    .filter((text) =>
      /(call|emergency|repair|request service|get help|contact|schedule|dispatch|book|appointment|quote|estimate|water test)/i.test(
        text
      )
    )

  return uniqueStrings(matches).slice(0, 12)
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeEntities(normalizeWhitespace(match[1])).slice(0, 140) : null
}

function extractReadableText(html: string) {
  const metaDescription = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  )?.[1]

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|p|div|section|article|li|h[1-6]|tr|td|th|header|footer|nav)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")

  return normalizeLines(`${metaDescription ? `${metaDescription}\n` : ""}${decodeEntities(stripped)}`)
}

function prioritizeRelevantText(text: string) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 30)

  const seen = new Set<string>()
  const uniqueLines = lines.filter((line) => {
    const key = line.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const scored = uniqueLines.map((line, index) => ({
    line,
    index,
    score: RELEVANT_KEYWORDS.reduce((score, keyword) => {
      return score + (line.toLowerCase().includes(keyword) ? 1 : 0)
    }, 0),
  }))

  const highSignal = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.line)

  const context = scored
    .filter((item) => item.score === 0)
    .slice(0, 40)
    .map((item) => item.line)

  return [...highSignal, ...context].join("\n")
}

function extractSignals(pages: ScrapedPage[]): ScrapeResult["extractedSignals"] {
  const lines = pages
    .flatMap((page) => page.text.split("\n"))
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 25)
  const allText = lines.join("\n")

  return {
    phoneNumbers: uniqueStrings(
      Array.from(
        allText.matchAll(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g)
      ).map((match) => match[0])
    ).slice(0, 5),
    services: collectTerms(lines, SERVICE_TERMS),
    equipmentMentions: collectTerms(lines, EQUIPMENT_TERMS),
    emergencyServiceLines: collectLines(lines, [
      "emergency",
      "24/7",
      "after hours",
      "dispatch",
      "repair",
      "request service",
      "book",
      "schedule",
      "appointment",
      "quote",
      "water test",
      "water testing",
      "call",
    ]),
    afterHoursLines: collectLines(lines, ["24/7", "24 hours", "after hours", "always available"]),
    callToActionText: uniqueStrings(pages.flatMap((page) => page.callToActionText)).slice(0, 12),
    locations: collectLines(lines, [
      "address",
      "located",
      "location",
      "serving",
      "service area",
      "areas served",
      "california",
      "florida",
      "texas",
      "new york",
    ]).slice(0, 6),
  }
}

function collectTerms(lines: string[], terms: string[]) {
  const lowerText = lines.join("\n").toLowerCase()
  return terms.filter((term) => lowerText.includes(term.toLowerCase())).slice(0, 12)
}

function collectLines(lines: string[], terms: string[]) {
  return uniqueStrings(
    lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term))).slice(0, 8)
  )
}

function safeInternalPath(link: string, origin: string) {
  try {
    const url = new URL(link)
    if (url.origin !== origin) return ""
    return url.pathname
  } catch {
    return ""
  }
}

async function assertPublicHost(hostname: string) {
  const lowerHost = hostname.toLowerCase()
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".localhost") ||
    lowerHost.endsWith(".local")
  ) {
    throw new UnsafeScrapeUrlError("Local network URLs are not supported.")
  }

  if (isPrivateAddress(lowerHost)) {
    throw new UnsafeScrapeUrlError("Private network URLs are not supported.")
  }

  const records = await dns.lookup(lowerHost, { all: true, verbatim: false })
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new UnsafeScrapeUrlError("Website host could not be verified as public.")
  }
}

function isPrivateAddress(value: string) {
  const ipVersion = net.isIP(value)
  if (!ipVersion) return false

  if (ipVersion === 6) {
    const normalized = value.toLowerCase()
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    )
  }

  const [a, b] = value.split(".").map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function normalizeLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
