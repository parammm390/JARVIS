// LLM provider abstraction (§9): Groq is the default, injected — never hardcoded at
// call sites. A stronger model can be swapped per action_type via domain_policies
// (model_provider column), a config change, not a code change.
//
// Lives in @finnor/tools (not @finnor/orchestration) specifically so domain-plugins
// can use it too — domain-plugins already depends on tools, and orchestration depends
// on domain-plugins, so a copy in orchestration would create a package cycle the
// moment a plugin needed an LLM call (the ops-overview grounded-QA action does).

import Groq from "groq-sdk";
import { initObservability, Sentry } from "./observability";

export interface LLMProvider {
  name: string;
  complete(opts: { system: string; user: string; json?: boolean }): Promise<string>;
}

/** Fetch with a hard timeout — Bedrock's runtime API has no client SDK dependency here,
 *  it's called directly over HTTPS with the account's Bedrock API key as a bearer token
 *  (AWS's simplified auth path for Bedrock, no SigV4 signing needed). */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Claude models on Bedrock — Anthropic Messages API shape, invoked via bearer-token auth. */
export class BedrockAnthropicProvider implements LLMProvider {
  name = "bedrock-anthropic";
  constructor(
    private modelId: string,
    private apiKey = process.env.AWS_BEDROCK_API_KEY,
    private region = process.env.AWS_BEDROCK_REGION ?? "us-east-1",
  ) {}

  async complete(opts: { system: string; user: string; json?: boolean }): Promise<string> {
    if (!this.apiKey) throw new Error("AWS_BEDROCK_API_KEY is not set");
    const res = await fetchWithTimeout(
      `https://bedrock-runtime.${this.region}.amazonaws.com/model/${this.modelId}/invoke`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 700,
          temperature: 0.1,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      },
      8_000,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bedrock (${this.modelId}) failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? "";
  }
}

/** DeepSeek (and any other OpenAI-chat-shaped model) on Bedrock — cheaper, used for
 *  lower-stakes text generation (e.g. narrating an execution result), not planning. */
export class BedrockOpenAICompatProvider implements LLMProvider {
  name = "bedrock-openai-compat";
  constructor(
    private modelId: string,
    private apiKey = process.env.AWS_BEDROCK_API_KEY,
    private region = process.env.AWS_BEDROCK_REGION ?? "us-east-1",
  ) {}

  async complete(opts: { system: string; user: string; json?: boolean }): Promise<string> {
    if (!this.apiKey) throw new Error("AWS_BEDROCK_API_KEY is not set");
    const res = await fetchWithTimeout(
      `https://bedrock-runtime.${this.region}.amazonaws.com/model/${this.modelId}/invoke`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 400,
          temperature: 0.2,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
      },
      8_000,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bedrock (${this.modelId}) failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

/** Tries each provider in order — different vendor, different failure modes (rate
 *  limit, outage, auth) don't correlate, so a chain is strictly more available than
 *  any single provider. */
export class CompositeProvider implements LLMProvider {
  name = "composite";
  constructor(private providers: LLMProvider[]) {}

  async complete(opts: { system: string; user: string; json?: boolean }): Promise<string> {
    let lastError: Error | null = null;
    for (const p of this.providers) {
      try {
        return await p.complete(opts);
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }
}

export class GroqProvider implements LLMProvider {
  name = "groq";
  private client: Groq;
  private models: string[];

  constructor(apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile") {
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    // No SDK-level retries: a throttled call fails in milliseconds and we fail over
    // to the next model, whose rate-limit bucket is separate — instead of sitting
    // out a 20-40s retry-after on the free tier.
    this.client = new Groq({ apiKey, timeout: 8_000, maxRetries: 0 });
    // 70B first: this model's whole job is precise structured-field extraction (which
    // action_type, which exact payload fields) — the 8B model is fast but was
    // regularly stuffing entire sentences into single fields and misrouting between
    // similarly-named actions. 8B stays as the fallback for when 70B is rate-limited,
    // not the default.
    const fallbacks = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    this.models = [model, ...fallbacks.filter((m) => m !== model)];
  }

  async complete(opts: { system: string; user: string; json?: boolean }): Promise<string> {
    let lastError: Error | null = null;
    for (const model of this.models) {
      try {
        const res = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: 0.1,
          max_tokens: 700,
          ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
        });
        return res.choices[0]?.message?.content ?? "";
      } catch (err) {
        lastError = err as Error;
        // 429 / 5xx / timeout → next model, next bucket. Hard auth errors don't retry.
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) break;
      }
    }
    throw lastError ?? new Error("All Groq models failed");
  }
}

/** Best available Sonnet-tier model on this Bedrock account, as of the last live check
 *  against ListFoundationModels — anthropic.claude-sonnet-5 itself isn't enabled on
 *  this account (403), claude-sonnet-4-6 is the newest one that is. */
const BEDROCK_SONNET_MODEL_ID = process.env.AWS_BEDROCK_SONNET_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6";
const BEDROCK_DEEPSEEK_MODEL_ID = process.env.AWS_BEDROCK_DEEPSEEK_MODEL_ID ?? "deepseek.v3.2";

/** Resolve the provider for an action type. Registry is config-extensible. */
const providers = new Map<string, () => LLMProvider>();
// Default chain: Bedrock Claude Sonnet first when a Bedrock API key is configured
// (best structured-extraction/tool-call accuracy — this is the planner's real job),
// Groq's 70B/8B chain as a same-request fallback if Bedrock errors or rate-limits.
// Without AWS_BEDROCK_API_KEY set (e.g. local dev, tests) this is just GroqProvider,
// unchanged from before — no new required secret for the existing test suite.
providers.set("groq", () =>
  process.env.AWS_BEDROCK_API_KEY
    ? new CompositeProvider([new BedrockAnthropicProvider(BEDROCK_SONNET_MODEL_ID), new GroqProvider()])
    : new GroqProvider(),
);
providers.set("bedrock-sonnet", () => new BedrockAnthropicProvider(BEDROCK_SONNET_MODEL_ID));
providers.set("bedrock-deepseek", () => new BedrockOpenAICompatProvider(BEDROCK_DEEPSEEK_MODEL_ID));

export function registerProvider(name: string, factory: () => LLMProvider): void {
  providers.set(name, factory);
}

/** Wraps a provider with a Sentry breadcrumb per complete() call (provider name,
 *  latency, ok/fail) — never the prompt/response text itself, which may carry
 *  redacted-but-still-sensitive business content (respects the same discipline
 *  ToolRegistry.call()'s tool breadcrumbs follow). No-ops harmlessly without
 *  SENTRY_DSN. */
function withObservability(provider: LLMProvider): LLMProvider {
  return {
    name: provider.name,
    async complete(opts) {
      initObservability();
      const start = Date.now();
      try {
        const text = await provider.complete(opts);
        Sentry.addBreadcrumb({ category: "llm", message: provider.name, data: { ok: true, ms: Date.now() - start } });
        return text;
      } catch (err) {
        Sentry.addBreadcrumb({ category: "llm", message: provider.name, data: { ok: false, ms: Date.now() - start } });
        Sentry.captureMessage(`llm_failed:${provider.name}`, { level: "warning" });
        throw err;
      }
    },
  };
}

export function resolveProvider(name?: string): LLMProvider {
  const factory = providers.get(name ?? "groq") ?? providers.get("groq")!;
  return withObservability(factory());
}
