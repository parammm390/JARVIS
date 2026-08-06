import { describe, expect, it } from "vitest";
import { chunkEvidenceText, excerptForEvidence, fuseEvidenceCandidates, type EvidenceCandidate } from "@finnor/memory";

const candidate = (chunkId: string, content: string): EvidenceCandidate => ({
  chunkId,
  sourceId: "source-1",
  sourceKey: "https://example.test/source",
  sourceTitle: "Example source",
  sourceUrl: "https://example.test/source",
  versionId: "version-1",
  versionNumber: 1,
  asOf: "2026-08-04T00:00:00.000Z",
  scope: "tenant",
  ordinal: 1,
  content,
  entityRefs: [],
  timeRefs: [],
});

describe("evidence corpus primitives", () => {
  it("keeps chunks bounded and merges a short tail", () => {
    const text = Array.from({ length: 505 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkEvidenceText(text, { minTokens: 20, maxTokens: 100 });
    expect(chunks).toHaveLength(6);
    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 100)).toBe(true);
    expect(chunks.join(" ").split(/\s+/)).toHaveLength(505);
  });

  it("fuses lexical and vector rankings by chunk identity", () => {
    const lexical = [candidate("lexical", "lexical match"), candidate("both", "shared match")].map((row, index) => ({
      ...row,
      lexicalScore: 1 - index / 10,
    }));
    const vector = [candidate("both", "shared match"), candidate("vector", "vector match")].map((row, index) => ({
      ...row,
      vectorScore: 1 - index / 10,
    }));

    const fused = fuseEvidenceCandidates(lexical, vector, { limit: 3 });
    expect(fused).toHaveLength(3);
    expect(fused[0]!.chunkId).toBe("both");
    expect(fused.find((row) => row.chunkId === "both")?.lexicalScore).toBeCloseTo(0.9);
    expect(fused.find((row) => row.chunkId === "both")?.vectorScore).toBeCloseTo(1);
  });

  it("produces bounded citation excerpts", () => {
    const excerpt = excerptForEvidence("one   two three four five", 12);
    expect(excerpt).toBe("one two thr…");
    expect(excerpt.length).toBeLessThanOrEqual(12);
  });
});
