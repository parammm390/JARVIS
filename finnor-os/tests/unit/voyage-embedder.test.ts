// §5.1 (JARVIS 95% MAESTRO PACK): the real Voyage AI embedder, and the fail-closed
// guard that replaces the old silent DeterministicLocalEmbedder fallback — "the silent
// fallback... is a security-grade bug" (§5's decision). Same stub-fetch convention as
// tests/unit/stripe.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";

function stubFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("defaultEmbedder — fail-closed outside NODE_ENV=test", () => {
  beforeEach(() => {
    delete process.env.EMBEDDINGS_API_KEY;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns FailClosedEmbedder when unconfigured and NODE_ENV is not 'test'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { defaultEmbedder, FailClosedEmbedder } = await import("@finnor/memory");
    expect(defaultEmbedder()).toBeInstanceOf(FailClosedEmbedder);
  });

  it("FailClosedEmbedder.embed() throws a clear error naming EMBEDDINGS_API_KEY, with no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { FailClosedEmbedder } = await import("@finnor/memory");
    await expect(new FailClosedEmbedder().embed()).rejects.toThrow(/EMBEDDINGS_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to DeterministicLocalEmbedder when NODE_ENV=test (this suite's own env)", async () => {
    const { defaultEmbedder, DeterministicLocalEmbedder } = await import("@finnor/memory");
    expect(defaultEmbedder()).toBeInstanceOf(DeterministicLocalEmbedder);
  });

  it("prefers VoyageEmbedder once a real key is configured, in any environment", async () => {
    process.env.EMBEDDINGS_API_KEY = "voyage-test-key";
    const { defaultEmbedder, VoyageEmbedder } = await import("@finnor/memory");
    expect(defaultEmbedder()).toBeInstanceOf(VoyageEmbedder);
  });

  it("embeddingsProviderStatus reports configured:false with no network call when unset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { embeddingsProviderStatus } = await import("@finnor/memory");
    expect(embeddingsProviderStatus()).toEqual({ configured: false, provider: "voyage-3.5", healthy: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("VoyageEmbedder — stub-fetch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws immediately, no network call, when constructed with no key", async () => {
    delete process.env.EMBEDDINGS_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { VoyageEmbedder } = await import("@finnor/memory");
    expect(() => new VoyageEmbedder()).toThrow(/EMBEDDINGS_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("embed() posts to Voyage's API and returns the embedding for a single text", async () => {
    stubFetchOnce({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }) });
    const { VoyageEmbedder } = await import("@finnor/memory");
    const vec = await new VoyageEmbedder("real-key").embed("hard water at 14 gpg");
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it("sends the model name, output_dimension, and bearer auth header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [1], index: 0 }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const { VoyageEmbedder, EMBEDDING_DIMENSIONS } = await import("@finnor/memory");
    await new VoyageEmbedder("real-key").embed("some text");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer real-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("voyage-3.5");
    expect(body.output_dimension).toBe(EMBEDDING_DIMENSIONS);
  });

  it("embedBatch re-sorts the response by index, so out-of-order API responses stay correct", async () => {
    stubFetchOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [2], index: 1 },
          { embedding: [1], index: 0 },
        ],
      }),
    });
    const { VoyageEmbedder } = await import("@finnor/memory");
    const vecs = await new VoyageEmbedder("real-key").embedBatch(["first", "second"]);
    expect(vecs).toEqual([[1], [2]]);
  });

  it("retries on a 429, then succeeds", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [9], index: 0 }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const { VoyageEmbedder } = await import("@finnor/memory");
    const vec = await new VoyageEmbedder("real-key").embed("retry me");
    expect(vec).toEqual([9]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a 401 is not retried — surfaces immediately as an error", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" });
    vi.stubGlobal("fetch", fetchSpy);
    const { VoyageEmbedder } = await import("@finnor/memory");
    await expect(new VoyageEmbedder("bad-key").embed("x")).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("batches more than 128 texts into multiple requests", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      return { ok: true, json: async () => ({ data: body.input.map((_, i) => ({ embedding: [i], index: i })) }) };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { VoyageEmbedder } = await import("@finnor/memory");
    const texts = Array.from({ length: 200 }, (_, i) => `chunk ${i}`);
    const vecs = await new VoyageEmbedder("real-key").embedBatch(texts);
    expect(vecs).toHaveLength(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 128 + 72
  });
});
