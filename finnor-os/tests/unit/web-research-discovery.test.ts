import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  type FirecrawlScrapeResult,
  type ToolCallResult,
} from "@finnor/tools";
import webResearchPlugin from "../../packages/domain-plugins/web-research/index";

class MockToolRegistry extends ToolRegistry {
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];

  constructor(private readonly respond: (name: string, input: Record<string, unknown>) => ToolCallResult) {
    super();
  }

  override async call(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    this.calls.push({ name, input });
    return this.respond(name, input);
  }
}

function firecrawlResult(url: string, title: string, excerpt: string): FirecrawlScrapeResult {
  const contentHash = "a".repeat(64);
  const changeHash = "b".repeat(64);
  const fetchedAt = "2026-08-04T00:00:00.000Z";
  const snapshot = {
    sourceId: `web:${url}`,
    url,
    title,
    contentHash,
    changeHash,
    fetchedAt,
    freshness: "fresh" as const,
    provider: "firecrawl" as const,
  };
  return {
    provider: "firecrawl",
    url,
    title,
    content: excerpt,
    excerpt,
    snapshot,
    citation: {
      citationId: `citation:${url}`,
      provider: "firecrawl",
      url,
      title,
      retrievedAt: fetchedAt,
      contentHash,
      changeHash,
      freshness: "fresh" as const,
    },
    truncated: false,
  };
}

function draft(query: string) {
  return {
    actionType: "search_web",
    summary: `Search the web: "${query}"`,
    payload: { query, numResults: 4 },
    requiresConfirmation: false,
  } as const;
}

describe("web-research discovery verification", () => {
  it("verifies only the bounded top URLs and speaks only from Firecrawl material", async () => {
    const candidates = [
      { title: "Candidate one", url: "https://one.example/page", snippet: "UNVERIFIED ONE CLAIM" },
      { title: "Candidate two", url: "https://two.example/page", snippet: "UNVERIFIED TWO CLAIM" },
      { title: "Candidate three", url: "https://three.example/page", snippet: "UNVERIFIED THREE CLAIM" },
      { title: "Candidate four", url: "https://four.example/page", snippet: "UNVERIFIED FOUR CLAIM" },
    ];
    const verified = firecrawlResult(candidates[0]!.url, "Verified source", "Verified source statement.");
    const tools = new MockToolRegistry((name, input) => {
      if (name === "web_search") return { ok: true, output: { results: candidates } };
      if (name === "firecrawl_scrape" && input.url === candidates[0]!.url) return { ok: true, output: { result: verified } };
      if (name === "firecrawl_scrape" && input.url === candidates[1]!.url) return { ok: false, output: {}, error: "[firecrawl] provider unavailable" };
      return { ok: true, output: { result: { malformed: true } } };
    });

    const result = await webResearchPlugin.execute(draft("water treatment pricing"), tools);
    const output = result.output as {
      results: Array<Record<string, unknown>>;
      citedResults: Array<Record<string, unknown>>;
      citations: unknown[];
      verifiedSnapshots: unknown[];
      unverifiedDiscovery: Array<Record<string, unknown>>;
      verification: { status: string; attempted: number; verified: number; unverified: number };
      spokenSummary: string;
    };

    expect(result.status).toBe("success");
    expect(tools.calls.filter((call) => call.name === "firecrawl_scrape").map((call) => call.input.url)).toEqual([
      candidates[0]!.url,
      candidates[1]!.url,
      candidates[2]!.url,
    ]);
    expect(output.verification).toEqual({ status: "partial", attempted: 3, verified: 1, unverified: 3, boundedAt: 3 });
    expect(output.citations).toEqual([verified.citation]);
    expect(output.verifiedSnapshots).toEqual([verified.snapshot]);
    expect(output.citedResults).toHaveLength(1);
    expect(output.results[0]?.verificationStatus).toBe("verified");
    expect(output.results[3]?.verificationStatus).toBe("unverified_discovery");
    expect(output.unverifiedDiscovery).toHaveLength(3);
    expect(output.spokenSummary).toContain("Verified source statement.");
    expect(output.spokenSummary).not.toContain("UNVERIFIED");
  });

  it("keeps Exa discovery useful but explicitly non-factual when Firecrawl is unavailable", async () => {
    const candidates = [
      { title: "Candidate one", url: "https://one.example/page", snippet: "UNVERIFIED CLAIM ONE" },
      { title: "Candidate two", url: "https://two.example/page", snippet: "UNVERIFIED CLAIM TWO" },
    ];
    const tools = new MockToolRegistry((name) => name === "web_search"
      ? { ok: true, output: { results: candidates } }
      : { ok: false, output: {}, error: "[firecrawl] provider unavailable" });

    const result = await webResearchPlugin.execute(draft("competitor reviews"), tools);
    const output = result.output as {
      citations: unknown[];
      unverifiedDiscovery: Array<Record<string, unknown>>;
      verification: { status: string; attempted: number; verified: number; unverified: number };
      spokenSummary: string;
    };

    expect(result.status).toBe("success");
    expect(output.citations).toEqual([]);
    expect(output.verification).toEqual({ status: "unavailable", attempted: 2, verified: 0, unverified: 2, boundedAt: 3 });
    expect(output.unverifiedDiscovery.every((item) => item.verificationStatus === "unverified_discovery")).toBe(true);
    expect(output.spokenSummary).toContain("could not verify");
    expect(output.spokenSummary).not.toContain("UNVERIFIED CLAIM");
  });
});

