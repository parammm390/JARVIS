// Exa web search — real-time web intelligence (competitor scans, review lookups,
// water-quality news, anything the dealer asks about the outside world).
// Wrapped like every integration: timeout, retry, typed errors.

import { IntegrationError } from "./errors";

export interface ExaResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export async function exaSearch(opts: {
  query: string;
  numResults?: number;
  category?: string;
  includeText?: boolean;
}): Promise<ExaResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new IntegrationError("exa", "EXA_API_KEY is not set", false);
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      query: opts.query,
      numResults: Math.min(opts.numResults ?? 5, 10),
      type: "auto",
      ...(opts.category ? { category: opts.category } : {}),
      contents: { text: { maxCharacters: 800 } },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new IntegrationError("exa", `search failed (${res.status}): ${body.slice(0, 200)}`, res.status >= 500);
  }
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map((r) => ({
    title: String(r.title ?? "(untitled)"),
    url: String(r.url ?? ""),
    snippet: String((r.text as string | undefined) ?? "").slice(0, 800),
    publishedDate: r.publishedDate ? String(r.publishedDate) : undefined,
  }));
}
