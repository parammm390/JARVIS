import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FirecrawlEvidenceRecorder,
  type EvidenceSourceInput,
  type EvidenceVersionInput,
  type EvidenceVersionResult,
} from "@finnor/memory";

describe("Firecrawl evidence recorder", () => {
  it("uses a stable tenant source and delegates content-hash retries idempotently", async () => {
    const sources = new Map<string, { id: string; scope: "tenant" }>();
    const versions = new Map<string, EvidenceVersionResult>();
    const sourceInputs: EvidenceSourceInput[] = [];
    const versionInputs: Array<{ tenantId: string; sourceId: string; input: EvidenceVersionInput }> = [];
    const recorder = new FirecrawlEvidenceRecorder({
      now: () => new Date("2026-08-04T01:00:00.000Z"),
      createSource: async (tenantId, input) => {
        sourceInputs.push(input);
        const key = `${tenantId}:${input.sourceKey}`;
        const existing = sources.get(key);
        if (existing) return existing;
        const source = { id: `source-${sources.size + 1}`, scope: "tenant" as const };
        sources.set(key, source);
        return source;
      },
      appendVersion: async (tenantId, sourceId, input) => {
        versionInputs.push({ tenantId, sourceId, input });
        const contentHash = createHash("sha256").update(input.content.trim()).digest("hex");
        const key = `${sourceId}:${contentHash}`;
        const existing = versions.get(key);
        if (existing) return existing;
        const result: EvidenceVersionResult = {
          sourceId,
          versionId: `version-${versions.size + 1}`,
          versionNumber: versions.size + 1,
          chunks: 1,
          contentHash,
        };
        versions.set(key, result);
        return result;
      },
    });

    const input = {
      tenantId: "tenant-a",
      idempotencyKey: "competitor-evidence:watch:change-1",
      content: "A durable source snapshot.",
      citation: {
        citationId: "citation-1",
        provider: "firecrawl" as const,
        url: "HTTPS://Competitor.Example/pricing?b=2&a=1#section",
        title: "Competitor pricing",
        retrievedAt: "2026-08-04T00:00:00.000Z",
        contentHash: "provider-content-hash",
        changeHash: "provider-change-hash",
        freshness: "fresh" as const,
      },
      snapshot: {
        sourceId: "web:source-1",
        provider: "firecrawl" as const,
        url: "https://competitor.example/pricing?a=1&b=2",
        title: "Competitor pricing",
        contentHash: "provider-content-hash",
        changeHash: "provider-change-hash",
        fetchedAt: "2026-08-04T00:00:00.000Z",
        freshness: "fresh" as const,
        sourceUpdatedAt: "2026-08-03T23:30:00.000Z",
      },
    };

    await recorder.record(input);
    await recorder.record({ ...input, idempotencyKey: "competitor-evidence:watch:retry" });

    expect(sourceInputs).toHaveLength(2);
    expect(sourceInputs[0]?.scope).toBe("tenant");
    expect(sourceInputs[0]?.sourceKey).toBe("firecrawl:https://competitor.example/pricing?a=1&b=2");
    expect(sourceInputs[0]?.metadata).toMatchObject({
      provider: "firecrawl",
      sourceId: "web:source-1",
      citationId: "citation-1",
      changeHash: "provider-change-hash",
    });
    expect(versionInputs).toHaveLength(2);
    expect(versionInputs[0]?.sourceId).toBe(versionInputs[1]?.sourceId);
    expect(versionInputs[0]?.input.content).toBe(versionInputs[1]?.input.content);
    expect(versionInputs[0]?.input.asOf).toEqual(new Date("2026-08-03T23:30:00.000Z"));
    expect(versionInputs[0]?.input.retrievedAt).toEqual(new Date("2026-08-04T00:00:00.000Z"));
    expect(versions.size).toBe(1);
  });

  it("refuses a public source returned by an unsafe source implementation", async () => {
    let appended = false;
    const recorder = new FirecrawlEvidenceRecorder({
      createSource: async () => ({ id: "public-source", scope: "public" }),
      appendVersion: async () => {
        appended = true;
        throw new Error("must not append");
      },
    });

    await expect(recorder.record({
      tenantId: "tenant-a",
      idempotencyKey: "retry-1",
      content: "content",
      citation: {
        citationId: "citation-1",
        provider: "firecrawl",
        url: "https://competitor.example/source",
        title: "Source",
        retrievedAt: "2026-08-04T00:00:00.000Z",
        freshness: "fresh",
      },
      snapshot: {
        sourceId: "web:source-1",
        provider: "firecrawl",
        url: "https://competitor.example/source",
        title: "Source",
        contentHash: "content-hash",
        changeHash: "change-hash",
        fetchedAt: "2026-08-04T00:00:00.000Z",
        freshness: "fresh",
      },
    })).rejects.toThrow(/refuses public evidence sources/i);
    expect(appended).toBe(false);
  });
});
