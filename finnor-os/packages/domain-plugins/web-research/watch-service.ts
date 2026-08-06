// Injectable competitor monitoring pipeline. It deliberately owns no database
// tables: durable state, alert delivery, and the generic evidence corpus are ports
// so a background worker can supply its existing idempotent implementations.

import { createHash } from "node:crypto";
import type {
  FirecrawlAdapter,
  FirecrawlScrapeRequest,
  FirecrawlScrapeResult,
  TermsPolicy,
  WebCitation,
  WebSourceSnapshot,
} from "@finnor/tools";

export interface CompetitorWatchSource {
  id: string;
  url: string;
  competitorName?: string;
  allowedDomains?: readonly string[];
  termsApproved?: boolean;
  termsPolicy?: TermsPolicy;
}

export interface CompetitorWatchRequest {
  watchId: string;
  tenantId: string;
  sources: readonly CompetitorWatchSource[];
  maxChars?: number;
  requireTermsApproval?: boolean;
}

export interface CompetitorWatchStatePort {
  get(key: string): Promise<WebSourceSnapshot | null>;
  put(key: string, snapshot: WebSourceSnapshot): Promise<void>;
}

export interface EvidenceCorpusPort {
  /** Implementations should deduplicate this idempotency key durably. */
  record(input: {
    tenantId: string;
    idempotencyKey: string;
    content: string;
    citation: WebCitation;
    snapshot: WebSourceSnapshot;
  }): Promise<void>;
}

export interface CompetitorChangeAlert {
  type: "competitor_source_changed";
  alertId: string;
  idempotencyKey: string;
  tenantId: string;
  watchId: string;
  sourceId: string;
  competitorName?: string;
  url: string;
  previousChangeHash: string;
  nextChangeHash: string;
  observedAt: string;
  citation: WebCitation;
  /** Deliberately describes only the observed hash transition, not page claims. */
  reason: "source_snapshot_changed";
}

export interface CompetitorAlertPort {
  /** Implementations should deduplicate by alert.idempotencyKey. */
  emit(alert: CompetitorChangeAlert): Promise<void>;
}

export type CompetitorWatchObservation =
  | {
      status: "baseline" | "unchanged" | "changed";
      source: CompetitorWatchSource;
      snapshot: WebSourceSnapshot;
      citation: WebCitation;
      excerpt: string;
      alert?: CompetitorChangeAlert;
    }
  | {
      status: "unavailable";
      source: CompetitorWatchSource;
      error: string;
    };

export interface CompetitorWatchRun {
  watchId: string;
  tenantId: string;
  observations: CompetitorWatchObservation[];
  alerts: CompetitorChangeAlert[];
}

export class InMemoryCompetitorWatchState implements CompetitorWatchStatePort {
  private readonly snapshots = new Map<string, WebSourceSnapshot>();

  async get(key: string): Promise<WebSourceSnapshot | null> {
    return this.snapshots.get(key) ?? null;
  }

  async put(key: string, snapshot: WebSourceSnapshot): Promise<void> {
    this.snapshots.set(key, snapshot);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function watchStateKey(request: CompetitorWatchRequest, source: CompetitorWatchSource): string {
  return `competitor-watch:${request.tenantId}:${request.watchId}:${source.id}`;
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "source observation failed";
}

export class CompetitorWatchService {
  private readonly state: CompetitorWatchStatePort;
  private readonly alertSink?: CompetitorAlertPort;
  private readonly evidenceCorpus?: EvidenceCorpusPort;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly adapter: Pick<FirecrawlAdapter, "scrape">,
    options: {
      state?: CompetitorWatchStatePort;
      alertSink?: CompetitorAlertPort;
      evidenceCorpus?: EvidenceCorpusPort;
    } = {},
  ) {
    this.state = options.state ?? new InMemoryCompetitorWatchState();
    this.alertSink = options.alertSink;
    this.evidenceCorpus = options.evidenceCorpus;
  }

  async run(request: CompetitorWatchRequest): Promise<CompetitorWatchRun> {
    if (typeof request.tenantId !== "string" || !request.tenantId.trim()) throw new Error("competitor watch requires a tenantId");
    if (typeof request.watchId !== "string" || !request.watchId.trim()) throw new Error("competitor watch requires a watchId");
    if (!Array.isArray(request.sources)) throw new Error("competitor watch requires a sources array");
    if (request.sources.length === 0) return { watchId: request.watchId, tenantId: request.tenantId, observations: [], alerts: [] };
    const ids = new Set<string>();
    for (const source of request.sources) {
      if (typeof source.id !== "string" || !source.id.trim()) throw new Error("competitor watch sources require stable ids");
      if (ids.has(source.id)) throw new Error(`duplicate competitor watch source id: ${source.id}`);
      ids.add(source.id);
    }

    const observations: CompetitorWatchObservation[] = [];
    // Sequential source work is intentional: the adapter's per-domain limiter still
    // protects callers that run multiple services, while this keeps a background job
    // bounded and avoids a burst against a small competitor site.
    for (const source of request.sources) {
      observations.push(await this.runSource(request, source));
    }
    return {
      watchId: request.watchId,
      tenantId: request.tenantId,
      observations,
      alerts: observations.flatMap((observation) => observation.status === "changed" && observation.alert ? [observation.alert] : []),
    };
  }

  private async runSource(request: CompetitorWatchRequest, source: CompetitorWatchSource): Promise<CompetitorWatchObservation> {
    const key = watchStateKey(request, source);
    return this.withKeyLock(key, async () => {
      try {
        const scrapeRequest: FirecrawlScrapeRequest = {
          url: source.url,
          maxChars: request.maxChars,
          allowedDomains: source.allowedDomains,
          termsApproved: source.termsApproved,
          termsPolicy: source.termsPolicy,
          requireTermsApproval: request.requireTermsApproval,
        };
        const result = await this.adapter.scrape(scrapeRequest);
        const previous = await this.state.get(key);
        const firstObservation = !previous;
        const changed = Boolean(previous && previous.changeHash !== result.snapshot.changeHash);
        let alert: CompetitorChangeAlert | undefined;

        // The evidence port sees only provider-returned content and its citation. It
        // is never asked to synthesize a summary or a claim about what changed.
        if (this.evidenceCorpus && (firstObservation || changed)) {
          await this.evidenceCorpus.record({
            tenantId: request.tenantId,
            idempotencyKey: `competitor-evidence:${key}:${result.snapshot.changeHash}`,
            content: result.content,
            citation: result.citation,
            snapshot: result.snapshot,
          });
        }

        if (changed && previous) {
          const idempotencyKey = `competitor-alert:${key}:${result.snapshot.changeHash}`;
          alert = {
            type: "competitor_source_changed",
            alertId: `alert:${digest(idempotencyKey).slice(0, 24)}`,
            idempotencyKey,
            tenantId: request.tenantId,
            watchId: request.watchId,
            sourceId: source.id,
            ...(source.competitorName ? { competitorName: source.competitorName } : {}),
            url: result.snapshot.url,
            previousChangeHash: previous.changeHash,
            nextChangeHash: result.snapshot.changeHash,
            observedAt: result.snapshot.fetchedAt,
            citation: result.citation,
            reason: "source_snapshot_changed",
          };
          if (this.alertSink) await this.alertSink.emit(alert);
        }

        // Commit after evidence/alert delivery. If a process dies before this point,
        // the deterministic evidence/alert idempotency keys make a retry safe.
        await this.state.put(key, result.snapshot);
        return {
          status: firstObservation ? "baseline" : changed ? "changed" : "unchanged",
          source,
          snapshot: result.snapshot,
          citation: result.citation,
          excerpt: result.excerpt,
          ...(alert ? { alert } : {}),
        };
      } catch (error) {
        return { status: "unavailable", source, error: safeError(error) };
      }
    });
  }

  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}
