import {
  appendEvidenceVersion,
  createEvidenceSource,
  type EvidenceSourceInput,
  type EvidenceVersionInput,
} from "./evidence";

export type FirecrawlFreshness = "fresh" | "stale" | "unknown" | "unavailable";

/** Structural copy of the web-research port. This package deliberately does not
 * import the domain plugin so the plugin can depend on memory without a cycle. */
export interface FirecrawlEvidenceCitation {
  citationId: string;
  provider: "firecrawl";
  url: string;
  title: string;
  retrievedAt: string;
  contentHash?: string;
  changeHash?: string;
  freshness: FirecrawlFreshness;
}

/** Structural copy of the Firecrawl snapshot returned to the watch worker. */
export interface FirecrawlEvidenceSnapshot {
  sourceId: string;
  url: string;
  title: string;
  contentHash: string;
  changeHash: string;
  fetchedAt: string;
  freshness: FirecrawlFreshness;
  provider: "firecrawl";
  sourceUpdatedAt?: string;
}

export interface FirecrawlEvidenceRecord {
  tenantId: string;
  idempotencyKey: string;
  content: string;
  citation: FirecrawlEvidenceCitation;
  snapshot: FirecrawlEvidenceSnapshot;
}

export interface FirecrawlEvidenceRecorderDependencies {
  createSource?: typeof createEvidenceSource;
  appendVersion?: typeof appendEvidenceVersion;
  now?: () => Date;
}

function canonicalUrl(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Firecrawl evidence requires a source URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Firecrawl evidence source URL must be absolute");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Firecrawl evidence source URL must use HTTP(S)");
  }
  if (url.username || url.password) throw new Error("Firecrawl evidence source URL cannot contain credentials");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function validDate(value: string | undefined): Date | undefined {
  if (!value || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function metadataFor(
  citation: FirecrawlEvidenceCitation,
  snapshot: FirecrawlEvidenceSnapshot,
): Record<string, unknown> {
  return {
    provider: "firecrawl",
    sourceId: snapshot.sourceId,
    citationId: citation.citationId,
    freshness: snapshot.freshness,
    fetchedAt: snapshot.fetchedAt,
    retrievedAt: citation.retrievedAt,
    ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
    ...(snapshot.changeHash ? { changeHash: snapshot.changeHash } : {}),
    ...(snapshot.sourceUpdatedAt ? { sourceUpdatedAt: snapshot.sourceUpdatedAt } : {}),
  };
}

function snapshotFor(
  input: FirecrawlEvidenceRecord,
  url: string,
  title: string,
): Record<string, unknown> {
  return {
    provider: "firecrawl",
    idempotencyKey: input.idempotencyKey,
    citation: {
      citationId: input.citation.citationId,
      provider: input.citation.provider,
      url,
      title: input.citation.title,
      retrievedAt: input.citation.retrievedAt,
      ...(input.citation.contentHash ? { contentHash: input.citation.contentHash } : {}),
      ...(input.citation.changeHash ? { changeHash: input.citation.changeHash } : {}),
      freshness: input.citation.freshness,
    },
    sourceSnapshot: {
      sourceId: input.snapshot.sourceId,
      provider: input.snapshot.provider,
      url,
      title,
      contentHash: input.snapshot.contentHash,
      changeHash: input.snapshot.changeHash,
      fetchedAt: input.snapshot.fetchedAt,
      freshness: input.snapshot.freshness,
      ...(input.snapshot.sourceUpdatedAt ? { sourceUpdatedAt: input.snapshot.sourceUpdatedAt } : {}),
    },
  };
}

function sourceInputFor(input: FirecrawlEvidenceRecord): EvidenceSourceInput {
  const url = canonicalUrl(input.snapshot.url);
  const citationUrl = canonicalUrl(input.citation.url);
  if (url !== citationUrl) throw new Error("Firecrawl citation and snapshot URLs must match");

  const title = nonEmpty(input.citation.title) ?? nonEmpty(input.snapshot.title) ?? url;
  return {
    // URL identity is stable across changing snapshots and citation IDs. The
    // tenant scope is explicit even though createEvidenceSource defaults to it.
    sourceKey: `firecrawl:${url}`,
    sourceType: "web",
    title,
    canonicalUrl: url,
    publisher: new URL(url).hostname,
    metadata: metadataFor(input.citation, input.snapshot),
    scope: "tenant",
  };
}

function datesFor(input: FirecrawlEvidenceRecord, now: () => Date): Pick<EvidenceVersionInput, "asOf" | "retrievedAt"> {
  const sourceUpdatedAt = validDate(input.snapshot.sourceUpdatedAt);
  const fetchedAt = validDate(input.snapshot.fetchedAt);
  const retrievedAt = validDate(input.citation.retrievedAt);
  const fallback = now();
  if (!Number.isFinite(fallback.getTime())) throw new Error("Evidence recorder clock returned an invalid date");
  return {
    asOf: sourceUpdatedAt ?? fetchedAt ?? retrievedAt ?? fallback,
    retrievedAt: retrievedAt ?? fetchedAt ?? fallback,
  };
}

/** Durable tenant-owned adapter for the web-research EvidenceCorpusPort. */
export class FirecrawlEvidenceRecorder {
  private readonly createSource: typeof createEvidenceSource;
  private readonly appendVersion: typeof appendEvidenceVersion;
  private readonly now: () => Date;

  constructor(dependencies: FirecrawlEvidenceRecorderDependencies = {}) {
    this.createSource = dependencies.createSource ?? createEvidenceSource;
    this.appendVersion = dependencies.appendVersion ?? appendEvidenceVersion;
    this.now = dependencies.now ?? (() => new Date());
  }

  async record(input: FirecrawlEvidenceRecord): Promise<void> {
    if (typeof input.tenantId !== "string" || !input.tenantId.trim()) {
      throw new Error("Firecrawl evidence requires a tenantId");
    }
    if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim()) {
      throw new Error("Firecrawl evidence requires an idempotencyKey");
    }
    if (typeof input.content !== "string" || !input.content.trim()) {
      throw new Error("Firecrawl evidence content cannot be empty");
    }
    if (input.citation.provider !== "firecrawl" || input.snapshot.provider !== "firecrawl") {
      throw new Error("Firecrawl evidence accepts only Firecrawl citations and snapshots");
    }

    const sourceInput = sourceInputFor(input);
    const source = await this.createSource(input.tenantId, sourceInput);
    if (source.scope !== "tenant") {
      throw new Error("Firecrawl evidence recorder refuses public evidence sources");
    }

    const dates = datesFor(input, this.now);
    await this.appendVersion(input.tenantId, source.id, {
      content: input.content,
      snapshot: snapshotFor(input, sourceInput.canonicalUrl!, sourceInput.title),
      ...dates,
    });
  }
}

export function createFirecrawlEvidenceRecorder(
  dependencies: FirecrawlEvidenceRecorderDependencies = {},
): FirecrawlEvidenceRecorder {
  return new FirecrawlEvidenceRecorder(dependencies);
}

/** Exposed for focused tests and callers that need to inspect the stable key. */
export function firecrawlEvidenceSourceKey(url: string): string {
  return `firecrawl:${canonicalUrl(url)}`;
}
