// Web research domain plugin — REAL via Exa: competitor scans, review lookups, and
// open web research. Read-only against the outside world, so it defaults ungated
// (seeded policy) — but still flows through the same audit pipeline as everything else.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import type { FirecrawlScrapeResult, WebCitation } from "@finnor/tools";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);
const MAX_DISCOVERY_VERIFICATIONS = 3;

type DiscoveryResult = { title: string; url: string; snippet: string };
type VerifiedDiscovery = { discovery: DiscoveryResult; firecrawl: FirecrawlScrapeResult };

function typedFirecrawlResult(output: Record<string, unknown>): FirecrawlScrapeResult | undefined {
  const candidate = output.result;
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as Partial<FirecrawlScrapeResult>;
  const snapshot = value.snapshot;
  const citation = value.citation;
  if (
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    typeof value.excerpt !== "string" ||
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.changeHash !== "string" ||
    !citation ||
    typeof citation !== "object" ||
    typeof citation.citationId !== "string"
  ) return undefined;
  return value as FirecrawlScrapeResult;
}

async function verifyDiscoveredResults(results: DiscoveryResult[], tools: ToolRegistry) {
  const candidateUrls: string[] = [];
  const seenUrls = new Set<string>();
  for (const result of results) {
    if (!result.url || seenUrls.has(result.url) || candidateUrls.length >= MAX_DISCOVERY_VERIFICATIONS) continue;
    seenUrls.add(result.url);
    candidateUrls.push(result.url);
  }

  const attempts = new Map<string, { result?: FirecrawlScrapeResult; error?: string }>();
  for (const url of candidateUrls) {
    const response = await tools.call("firecrawl_scrape", { url });
    const verified = response.ok ? typedFirecrawlResult(response.output) : undefined;
    attempts.set(url, verified
      ? { result: verified }
      : { error: response.error ?? "Firecrawl verification returned no typed source" });
  }

  const verified: VerifiedDiscovery[] = [];
  const labeledResults = results.map((discovery) => {
    const attempt = attempts.get(discovery.url);
    if (attempt?.result) {
      verified.push({ discovery, firecrawl: attempt.result });
      return {
        ...discovery,
        provider: "firecrawl" as const,
        verificationStatus: "verified" as const,
        citation: attempt.result.citation,
        snapshot: attempt.result.snapshot,
      };
    }
    return {
      ...discovery,
      provider: "exa" as const,
      verificationStatus: "unverified_discovery" as const,
      verificationReason: attempt?.error ?? "not_attempted_bounded_verification",
    };
  });

  const unverifiedCount = labeledResults.filter((result) => result.verificationStatus === "unverified_discovery").length;
  const verificationStatus = verified.length === 0
    ? results.length === 0 ? "not_attempted" : "unavailable"
    : unverifiedCount === 0 ? "verified" : "partial";
  const citedResults = verified.map(({ discovery, firecrawl }) => ({
    provider: firecrawl.provider,
    title: firecrawl.title,
    url: firecrawl.url,
    excerpt: firecrawl.excerpt,
    citation: firecrawl.citation,
    snapshot: firecrawl.snapshot,
    discoveredFrom: discovery.url,
  }));
  const citations = verified.map(({ firecrawl }) => firecrawl.citation);
  const spokenSummary = results.length === 0
    ? "The web search came back empty."
    : verified.length === 0
      ? `Search found ${results.length} candidate source${results.length === 1 ? "" : "s"}, but Firecrawl could not verify their contents. I won't summarize unverified discovery as fact.`
      : `Verified ${verified.length} source${verified.length === 1 ? "" : "s"} via Firecrawl. Top verified source: ${verified[0]!.firecrawl.title}. ${verified[0]!.firecrawl.excerpt.slice(0, 200)}${unverifiedCount > 0 ? ` ${unverifiedCount} discovery candidate${unverifiedCount === 1 ? " remains" : "s remain"} unverified and is not included as fact.` : ""}`;

  return {
    labeledResults,
    citedResults,
    citations,
    verifiedSnapshots: verified.map(({ firecrawl }) => firecrawl.snapshot),
    unverifiedDiscovery: labeledResults.filter((result) => result.verificationStatus === "unverified_discovery"),
    verification: {
      status: verificationStatus,
      attempted: candidateUrls.length,
      verified: verified.length,
      unverified: unverifiedCount,
      boundedAt: MAX_DISCOVERY_VERIFICATIONS,
    },
    spokenSummary,
  };
}

export const WebSearchSchema = z.object({
  query: z.string().min(2).max(400),
  numResults: opt(z.number().int().min(1).max(10)),
});
export const CompetitorScanSchema = z.object({
  area: z.string().min(2).max(200), // "Cedar Falls Iowa"
  focus: opt(z.string().max(200)), // e.g. "pricing", "PFAS treatment"
  // Explicit source URLs opt this scan into Firecrawl snapshots. Discovery still
  // uses Exa below; monitoring never guesses URLs from a search snippet.
  sources: opt(z.array(z.string().url().max(2048)).max(5)),
});
export const ReviewScanSchema = z.object({
  businessName: z.string().min(2).max(200),
  area: opt(z.string().max(200)),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  search_web: WebSearchSchema,
  scan_competitors: CompetitorScanSchema,
  check_business_reviews: ReviewScanSchema,
};

export const webResearchPlugin: DomainEnginePlugin = {
  name: "web-research",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const summaries: Record<string, string> = {
      search_web: `Search the web: "${p.query}"`,
      scan_competitors: `Scan water treatment competitors around ${p.area}${p.focus ? ` (focus: ${p.focus})` : ""}.`,
      check_business_reviews: `Look up recent reviews of ${p.businessName}${p.area ? ` in ${p.area}` : ""}.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const p = draft.payload;
    const query =
      draft.actionType === "search_web"
        ? String(p.query)
        : draft.actionType === "scan_competitors"
          ? `water treatment softener filtration companies near ${p.area}${p.focus ? ` ${p.focus}` : ""}`
        : `${p.businessName}${p.area ? ` ${p.area}` : ""} customer reviews complaints ratings`;

    const sourceUrls = draft.actionType === "scan_competitors" && Array.isArray(p.sources)
      ? p.sources.filter((value): value is string => typeof value === "string")
      : [];
    if (sourceUrls.length > 0) {
      const scraped: FirecrawlScrapeResult[] = [];
      const failedSources: Array<{ url: string; error: string }> = [];
      for (const url of sourceUrls) {
        const result = await tools.call("firecrawl_scrape", { url });
        if (!result.ok) failedSources.push({ url, error: result.error ?? "source unavailable" });
        else {
          const value = result.output.result as FirecrawlScrapeResult | undefined;
          if (value?.snapshot && value.citation && typeof value.content === "string") scraped.push(value);
          else failedSources.push({ url, error: "source returned no typed citation" });
        }
      }
      if (scraped.length === 0) {
        return {
          status: "integration_unavailable",
          output: { query, results: [], citations: [], failedSources },
          error: "No competitor source could be read; no claims were generated.",
          errorKind: "provider_down",
        };
      }
      const citations: WebCitation[] = scraped.map((result) => result.citation);
      return {
        status: "success",
        output: {
          query,
          results: scraped.map((result) => ({ title: result.title, url: result.url, snippet: result.excerpt })),
          citedResults: scraped.map((result) => ({
            provider: result.provider,
            title: result.title,
            url: result.url,
            excerpt: result.excerpt,
            citation: result.citation,
            snapshot: result.snapshot,
          })),
          citations,
          failedSources,
          spokenSummary: `Read ${scraped.length} competitor source snapshot${scraped.length === 1 ? "" : "s"}; review the cited pages for exact details.`,
        },
        expected: { answered: true, sourceSnapshots: scraped.length, partial: failedSources.length > 0 },
      };
    }

    const r = await tools.call("web_search", { query, numResults: Number(p.numResults ?? 5) });
    if (!r.ok) {
      return {
        status: r.integrationUnavailable ? "integration_unavailable" : "failure",
        output: {},
        error: `Web search failed: ${r.error}`,
      };
    }
    const results = (r.output.results ?? []) as DiscoveryResult[];
    const verification = await verifyDiscoveredResults(results, tools);
    return {
      status: "success",
      output: {
        query,
        results: verification.labeledResults,
        citedResults: verification.citedResults,
        citations: verification.citations,
        verifiedSnapshots: verification.verifiedSnapshots,
        unverifiedDiscovery: verification.unverifiedDiscovery,
        verification: verification.verification,
        spokenSummary: verification.spokenSummary,
      },
      expected: { answered: true, verifiedSources: verification.verification.verified },
    };
  },
};

export default webResearchPlugin;

export * from "./watch-service";
