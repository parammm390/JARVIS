import { afterEach, describe, expect, it } from "vitest";
import {
  FirecrawlAdapter,
  freshnessFor,
  normalizeWebUrl,
  type FirecrawlScrapeResult,
} from "@finnor/tools";
import {
  CompetitorWatchService,
  InMemoryCompetitorWatchState,
  type CompetitorChangeAlert,
  type CompetitorWatchRequest,
} from "../../packages/domain-plugins/web-research/watch-service";

const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
const runtimeKey = ["test", "runtime", "configured"].join("-");

afterEach(() => {
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
});

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

function fakeHostResolver(address = "93.184.216.34") {
  return async () => [address] as const;
}

function fakeFirecrawlFetch(markdown: () => string, calls: Array<{ url: string; init?: RequestInit }>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/robots.txt")) return response("User-agent: *\nAllow: /");
    return response({ success: true, data: { markdown: markdown(), metadata: { title: "Aqua Competitor" } } });
  };
}

describe("Firecrawl research adapter", () => {
  it("reads the provider key at request time and returns a cited, hashed snapshot", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new FirecrawlAdapter({
      fetch: fakeFirecrawlFetch(() => "Pricing\n\nWhole-house filtration plans.", calls),
      resolveHost: fakeHostResolver(),
      minDomainIntervalMs: 0,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });
    process.env.FIRECRAWL_API_KEY = runtimeKey;

    const result = await adapter.scrape({ url: "https://competitor.example/pricing", maxChars: 100 });
    const providerCall = calls.find((call) => call.url.endsWith("/scrape"));

    expect(providerCall?.init?.headers).toMatchObject({ authorization: `Bearer ${runtimeKey}` });
    expect(result.provider).toBe("firecrawl");
    expect(result.snapshot.contentHash).toHaveLength(64);
    expect(result.snapshot.changeHash).toHaveLength(64);
    expect(result.citation.contentHash).toBe(result.snapshot.contentHash);
    expect(result.citation.url).toBe("https://competitor.example/pricing");
    expect(result.snapshot.freshness).toBe("fresh");
    expect(result.truncated).toBe(false);
  });

  it("fails closed for private DNS answers, robots exclusions, and missing terms approval", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return response("User-agent: *\nDisallow: /private");
    };
    const privateDnsAdapter = new FirecrawlAdapter({ fetch: fetcher, resolveHost: fakeHostResolver("10.0.0.8"), minDomainIntervalMs: 0 });
    await expect(privateDnsAdapter.scrape({ url: "https://public.example/source" })).rejects.toThrow(/private or reserved network/i);

    const robotsAdapter = new FirecrawlAdapter({ fetch: fetcher, resolveHost: fakeHostResolver(), minDomainIntervalMs: 0 });
    await expect(robotsAdapter.scrape({ url: "https://public.example/private" })).rejects.toThrow(/robots\.txt/i);

    const termsAdapter = new FirecrawlAdapter({
      fetch: fetcher,
      resolveHost: fakeHostResolver(),
      minDomainIntervalMs: 0,
      requireTermsApproval: true,
    });
    await expect(termsAdapter.scrape({ url: "https://public.example/source" })).rejects.toThrow(/terms approval/i);
    expect(calls.every((call) => !String(call.init?.headers).includes("Bearer"))).toBe(true);
  });

  it("supports an explicit terms policy and deterministic freshness decisions", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new FirecrawlAdapter({
      fetch: fakeFirecrawlFetch(() => "Readable source content", calls),
      resolveHost: fakeHostResolver(),
      minDomainIntervalMs: 0,
      termsPolicy: () => ({ allowed: false, reason: "terms not approved" }),
    });
    await expect(adapter.scrape({ url: "https://public.example/source" })).rejects.toThrow(/terms policy/i);
    expect(freshnessFor("2026-08-03T00:00:00.000Z", new Date("2026-08-04T00:00:00.000Z"), 60_000)).toBe("stale");
    expect(freshnessFor(undefined)).toBe("unknown");
    expect(() => normalizeWebUrl("http://127.0.0.1:80/admin")).toThrow(/private|loopback|reserved/i);
  });
});

describe("competitor watch service", () => {
  it("rejects an unscoped watch instead of using a global namespace", async () => {
    const service = new CompetitorWatchService({ scrape: async () => { throw new Error("should not scrape"); } });
    await expect(service.run({ watchId: "unscoped", sources: [] } as unknown as CompetitorWatchRequest)).rejects.toThrow(/tenantId/i);
  });

  it("baselines silently and emits one changed-only alert with evidence ports", async () => {
    let markdown = "Initial pricing";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new FirecrawlAdapter({
      fetch: fakeFirecrawlFetch(() => markdown, calls),
      resolveHost: fakeHostResolver(),
      minDomainIntervalMs: 0,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });
    process.env.FIRECRAWL_API_KEY = runtimeKey;
    const alerts: CompetitorChangeAlert[] = [];
    const evidence: string[] = [];
    const service = new CompetitorWatchService(adapter, {
      state: new InMemoryCompetitorWatchState(),
      alertSink: { emit: async (alert) => { alerts.push(alert); } },
      evidenceCorpus: { record: async (entry) => { evidence.push(entry.idempotencyKey); } },
    });
    const request = {
      tenantId: "tenant-test",
      watchId: "weekly-watch",
      sources: [{ id: "aqua-pricing", url: "https://competitor.example/pricing", competitorName: "Aqua" }],
    } as const;

    const baseline = await service.run(request);
    const unchanged = await service.run(request);
    markdown = "Updated pricing";
    const changed = await service.run(request);
    const repeated = await service.run(request);

    expect(baseline.observations[0]?.status).toBe("baseline");
    expect(baseline.alerts).toEqual([]);
    expect(unchanged.observations[0]?.status).toBe("unchanged");
    expect(changed.observations[0]?.status).toBe("changed");
    expect(changed.alerts).toHaveLength(1);
    expect(changed.alerts[0]?.reason).toBe("source_snapshot_changed");
    expect(changed.alerts[0]?.previousChangeHash).not.toBe(changed.alerts[0]?.nextChangeHash);
    expect(repeated.observations[0]?.status).toBe("unchanged");
    expect(repeated.alerts).toEqual([]);
    expect(alerts).toHaveLength(1);
    expect(evidence).toHaveLength(2);
    expect(calls.filter((call) => call.url.endsWith("/scrape"))).toHaveLength(4);
  });

  it("does not invent a successful result when the provider returns no readable content", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new FirecrawlAdapter({
      fetch: fakeFirecrawlFetch(() => "", calls),
      resolveHost: fakeHostResolver(),
      minDomainIntervalMs: 0,
    });
    process.env.FIRECRAWL_API_KEY = runtimeKey;
    const run = await new CompetitorWatchService(adapter).run({
      tenantId: "tenant-test",
      watchId: "empty-source",
      sources: [{ id: "empty", url: "https://competitor.example/empty" }],
    });
    expect(run.observations[0]?.status).toBe("unavailable");
    expect(run.alerts).toEqual([]);
  });
});

// Keep this compile-time reference close to the mocked provider contract so a future
// response-shape change fails this focused test instead of becoming an untyped alert.
void (null as FirecrawlScrapeResult | null);
